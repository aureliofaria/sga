import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { processEscalations, processSlaExpiries } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const DIA_MS = 24 * 60 * 60 * 1000;

// Cria um setor com um Líder I (level LIDER_1 — hierarquia Fase 0).
async function makeSectorWithLeader(name: string) {
  const sector = await prisma.sector.create({ data: { name } });
  const leaderUser = await makeUser('USER', `${name}-lider1`);
  await prisma.sectorMember.create({
    data: { sectorId: sector.id, userId: leaderUser.id, role: 'LIDER', level: 'LIDER_1' },
  });
  return { sector, leaderUser };
}

// Cria uma solicitação + tarefa PENDING na etapa 0 do fluxo informado.
async function makeTaskOnStep(opts: {
  flowId: string;
  stepId: string;
  initiatorId: string;
  assigneeId: string;
}) {
  const req = await prisma.request.create({
    data: { flowId: opts.flowId, initiatorId: opts.initiatorId, title: 'Pedido teste', status: 'IN_PROGRESS' },
  });
  const task = await prisma.requestTask.create({
    data: {
      requestId: req.id,
      stepId: opts.stepId,
      assigneeId: opts.assigneeId,
      title: 'Tarefa teste',
      status: 'PENDING',
    },
  });
  return { req, task };
}

// futureNow determinístico: createdAt da tarefa + N dias + 1s (REF.2).
function nowPlusDays(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + days * DIA_MS + 1000);
}

describe('escalonamento temporal (Fase 0 · Passo 11)', () => {
  beforeEach(resetDb);

  it('estágio 1: lembra o responsável e marca escalonamento (≥2 dias)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    const processed = await processEscalations(nowPlusDays(task.createdAt, 2));
    expect(processed).toBe(1);

    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.escalationStage).toBe(1);

    const notif = await prisma.notification.findFirst({ where: { userId: assignee.id, type: 'TASK_DELAY_REMINDER' } });
    expect(notif).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_1' } });
    expect(audit).toBeTruthy();
  });

  it('estágio 1: idempotente — segunda chamada não re-dispara', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    const now = nowPlusDays(task.createdAt, 2);
    expect(await processEscalations(now)).toBe(1);
    // Segunda chamada na MESMA janela (ainda <3 dias) não deve disparar de novo.
    expect(await processEscalations(now)).toBe(0);

    const audits = await prisma.auditLog.count({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_1' } });
    expect(audits).toBe(1);
  });

  it('estágio 2: aciona o Líder I + responsável e inclui justificativa no corpo (≥3 dias)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const { sector, leaderUser } = await makeSectorWithLeader('Setor2');
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });
    await prisma.requestTask.update({ where: { id: task.id }, data: { delayJustification: 'aguardando fornecedor' } });

    const processed = await processEscalations(nowPlusDays(task.createdAt, 3));
    expect(processed).toBe(1);

    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.escalationStage).toBe(2);

    const leaderNotif = await prisma.notification.findFirst({ where: { userId: leaderUser.id, type: 'TASK_ESCALATED_TO_LEADER' } });
    expect(leaderNotif).toBeTruthy();
    expect(leaderNotif?.body).toContain('aguardando fornecedor');

    const respNotif = await prisma.notification.findFirst({ where: { userId: assignee.id, type: 'TASK_DELAY_REMINDER' } });
    expect(respNotif?.body).toContain('aguardando fornecedor');

    const audit = await prisma.auditLog.findFirst({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_2' } });
    expect(audit).toBeTruthy();
  });

  it('estágio 1: inclui justificativa no corpo da notificação', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });
    await prisma.requestTask.update({ where: { id: task.id }, data: { delayJustification: 'dependência externa' } });

    await processEscalations(nowPlusDays(task.createdAt, 2));
    const notif = await prisma.notification.findFirst({ where: { userId: assignee.id, type: 'TASK_DELAY_REMINDER' } });
    expect(notif?.body).toContain('dependência externa');
  });

  it('estágio 3: transfere ao Líder I, marca slaEscalated e notifica (≥7 dias)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const { sector, leaderUser } = await makeSectorWithLeader('Setor3');
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    const processed = await processEscalations(nowPlusDays(task.createdAt, 7));
    expect(processed).toBe(1);

    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.escalationStage).toBe(3);
    expect(updated.slaEscalated).toBe(true);
    expect(updated.assigneeId).toBe(leaderUser.id);

    // Notifica responsável anterior, líder e iniciador.
    for (const uid of [assignee.id, leaderUser.id, initiator.id]) {
      const n = await prisma.notification.findFirst({ where: { userId: uid, type: 'TASK_ESCALATED_TO_LEADER' } });
      expect(n, `notificação para ${uid}`).toBeTruthy();
    }

    const audit = await prisma.auditLog.findFirst({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_3' } });
    expect(audit).toBeTruthy();
  });

  it('estágio 3: idempotente — slaEscalated impede re-disparo e a query o exclui', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const { sector } = await makeSectorWithLeader('Setor3b');
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    const now = nowPlusDays(task.createdAt, 7);
    expect(await processEscalations(now)).toBe(1);
    // slaEscalated=true agora exclui a tarefa da própria query.
    expect(await processEscalations(now)).toBe(0);

    const audits = await prisma.auditLog.count({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_3' } });
    expect(audits).toBe(1);
  });

  it('estágio 3 sem líder no setor: mantém o responsável', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const sector = await prisma.sector.create({ data: { name: 'SetorSemLider' } });
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    expect(await processEscalations(nowPlusDays(task.createdAt, 7))).toBe(1);
    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.assigneeId).toBe(assignee.id);
    expect(updated.escalationStage).toBe(3);
    expect(updated.slaEscalated).toBe(true);
  });

  it('estágio 3 quando o Líder I é o próprio iniciador: NÃO transfere (SoD), mantém o responsável', async () => {
    const initiator = await makeUser('USER', 'init-lider');
    const assignee = await makeUser('USER', 'resp');
    // Setor cujo Líder I é o PRÓPRIO iniciador.
    const sector = await prisma.sector.create({ data: { name: 'SetorLiderIniciador' } });
    await prisma.sectorMember.create({
      data: { sectorId: sector.id, userId: initiator.id, role: 'LIDER', level: 'LIDER_1' },
    });
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    expect(await processEscalations(nowPlusDays(task.createdAt, 7))).toBe(1);
    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    // Segregação de funções: a tarefa NÃO é transferida ao iniciador.
    expect(updated.assigneeId).toBe(assignee.id);
    expect(updated.escalationStage).toBe(3);
    expect(updated.slaEscalated).toBe(true);
  });

  it('dispara o estágio mais severo elegível (pula direto ao 3 com 7 dias)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const { sector } = await makeSectorWithLeader('SetorSalto');
    const flow = await makeFlow('GENERIC', [{ order: 0, handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    await processEscalations(nowPlusDays(task.createdAt, 7));
    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.escalationStage).toBe(3);
    // Não criou auditoria dos estágios 1/2.
    expect(await prisma.auditLog.count({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_1' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: task.requestId, action: 'ESCALATION_STAGE_2' } })).toBe(0);
  });

  it('respeita overrides de cadência da etapa (escalationDay1)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0, escalationDay1: 5 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    // Com override day1=5, 2 dias não dispara.
    expect(await processEscalations(nowPlusDays(task.createdAt, 2))).toBe(0);
    // 5 dias dispara o estágio 1.
    expect(await processEscalations(nowPlusDays(task.createdAt, 5))).toBe(1);
  });

  it('tarefas COMPLETED/CANCELLED não entram no escalonamento', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task: t1 } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });
    const { task: t2 } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });
    await prisma.requestTask.update({ where: { id: t1.id }, data: { status: 'COMPLETED' } });
    await prisma.requestTask.update({ where: { id: t2.id }, data: { status: 'CANCELLED' } });

    expect(await processEscalations(nowPlusDays(t1.createdAt, 7))).toBe(0);
  });
});

describe('justificativa de atraso — POST /api/tasks/:id/justify-delay (Passo 11)', () => {
  beforeEach(resetDb);

  async function setup() {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0 }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const { task } = await makeTaskOnStep({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });
    return { initiator, assignee, task };
  }

  it('responsável: 200 e grava justificativa + AuditLog', async () => {
    const { assignee, task } = await setup();
    const res = await request(app)
      .post(`/api/tasks/${task.id}/justify-delay`)
      .set(auth(tokenFor(assignee.id)))
      .send({ justification: 'aguardando documento' });
    expect(res.status).toBe(200);

    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.delayJustification).toBe('aguardando documento');
    expect(updated.delayJustifiedById).toBe(assignee.id);
    expect(updated.delayJustifiedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { requestId: task.requestId, action: 'DELAY_JUSTIFIED' } });
    expect(audit).toBeTruthy();
  });

  it('ADMIN: 200', async () => {
    const { task } = await setup();
    const admin = await makeUser('ADMIN', 'admin');
    const res = await request(app)
      .post(`/api/tasks/${task.id}/justify-delay`)
      .set(auth(tokenFor(admin.id)))
      .send({ justification: 'intervenção administrativa' });
    expect(res.status).toBe(200);
  });

  it('terceiro: 403', async () => {
    const { task } = await setup();
    const outro = await makeUser('USER', 'outro');
    const res = await request(app)
      .post(`/api/tasks/${task.id}/justify-delay`)
      .set(auth(tokenFor(outro.id)))
      .send({ justification: 'tentativa' });
    expect(res.status).toBe(403);
  });

  it('justificativa vazia: 400', async () => {
    const { assignee, task } = await setup();
    const res = await request(app)
      .post(`/api/tasks/${task.id}/justify-delay`)
      .set(auth(tokenFor(assignee.id)))
      .send({ justification: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('não-regressão de processSlaExpiries com Líder I (level LIDER_1)', () => {
  beforeEach(resetDb);

  // dueDate no passado para forçar o vencimento; createdAt irrelevante aqui.
  async function makeExpiredTask(opts: { flowId: string; stepId: string; initiatorId: string; assigneeId: string }) {
    const req = await prisma.request.create({
      data: { flowId: opts.flowId, initiatorId: opts.initiatorId, title: 'Pedido SLA', status: 'IN_PROGRESS' },
    });
    return prisma.requestTask.create({
      data: {
        requestId: req.id,
        stepId: opts.stepId,
        assigneeId: opts.assigneeId,
        title: 'Tarefa SLA',
        status: 'PENDING',
        dueDate: new Date(Date.now() - DIA_MS),
      },
    });
  }

  it('KEEP_WITH_RESPONSIBLE: mantém o responsável e marca slaEscalated', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0, slaExpiry: 'KEEP_WITH_RESPONSIBLE' }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const task = await makeExpiredTask({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    expect(await processSlaExpiries()).toBe(1);
    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.slaEscalated).toBe(true);
    expect(updated.assigneeId).toBe(assignee.id);
  });

  it('RETURN_TO_REQUESTER: devolve a solicitação ao solicitante', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const flow = await makeFlow('GENERIC', [{ order: 0, slaExpiry: 'RETURN_TO_REQUESTER' }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const task = await makeExpiredTask({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    expect(await processSlaExpiries()).toBe(1);
    const updatedTask = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe('REJECTED');
    const updatedReq = await prisma.request.findUniqueOrThrow({ where: { id: task.requestId } });
    expect(updatedReq.status).toBe('RETURNED');
  });

  it('TRANSFER_TO_LEADER: transfere ao Líder I (level LIDER_1)', async () => {
    const initiator = await makeUser('USER', 'init');
    const assignee = await makeUser('USER', 'resp');
    const { sector, leaderUser } = await makeSectorWithLeader('SetorSLA');
    const flow = await makeFlow('GENERIC', [{ order: 0, slaExpiry: 'TRANSFER_TO_LEADER', handlingSectorId: sector.id }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const task = await makeExpiredTask({ flowId: flow.id, stepId: step.id, initiatorId: initiator.id, assigneeId: assignee.id });

    expect(await processSlaExpiries()).toBe(1);
    const updated = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.slaEscalated).toBe(true);
    expect(updated.assigneeId).toBe(leaderUser.id);
  });
});
