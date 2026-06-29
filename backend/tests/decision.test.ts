import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { advanceRequest, isStepComplete } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria uma solicitação IN_PROGRESS na etapa 0 com as tarefas da etapa criadas.
async function newRequest(flowId: string, initiatorId: string, amountCents?: number) {
  const req = await prisma.request.create({
    data: { flowId, initiatorId, title: 't', status: 'IN_PROGRESS', currentStep: 0, amountCents: amountCents ?? null },
  });
  return req;
}

// Helper: cria approval direto (para cenários de unidade de isStepComplete/round).
async function approvalRow(requestId: string, approverId: string, opts: { decision?: string; round?: number; stepOrder?: number } = {}) {
  return prisma.approval.create({
    data: {
      requestId, approverId,
      stepOrder: opts.stepOrder ?? 0,
      decision: opts.decision ?? 'APPROVED',
      round: opts.round ?? 0,
    },
  });
}

describe('isStepComplete com rodadas (round)', () => {
  beforeEach(resetDb);

  it('aprovação de rodada anterior não conta na rodada ativa', async () => {
    const initiator = await makeUser('USER');
    const m1 = await makeUser('MANAGER');
    const m2 = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'MANAGER' }] },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    await prisma.requestTask.create({ data: { requestId: req.id, stepId: step.id, assigneeId: initiator.id, title: 't', status: 'COMPLETED', completedAt: new Date() } });

    // Rodada 0: m1 aprova; m2 solicita correção (fecha a rodada). Rodada ativa → 1.
    await approvalRow(req.id, m1.id, { decision: 'APPROVED', round: 0 });
    await approvalRow(req.id, m2.id, { decision: 'CORRECTION_REQUESTED', round: 0 });
    // A aprovação da rodada 0 não conta para a rodada ativa (1) → etapa incompleta.
    expect(await isStepComplete(req.id, 0)).toBe(false);
  });

  it('INFO_REQUESTED não afeta a contagem (não há Approval mesmo)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'MANAGER' }] },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    await prisma.requestTask.create({ data: { requestId: req.id, stepId: step.id, assigneeId: initiator.id, title: 't', status: 'COMPLETED', completedAt: new Date() } });

    expect(await isStepComplete(req.id, 0)).toBe(false);
    await approvalRow(req.id, manager.id, { decision: 'APPROVED', round: 0 });
    expect(await isStepComplete(req.id, 0)).toBe(true);
  });
});

describe('advanceRequest não avança AWAITING_CORRECTION', () => {
  beforeEach(resetDb);

  it('mantém a etapa quando o pedido está aguardando correção', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'AWAITING_CORRECTION', currentStep: 0, correctionReturnStep: 0 },
    });
    await advanceRequest(req.id);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.currentStep).toBe(0);
    expect(fresh.status).toBe('AWAITING_CORRECTION');
  });
});

describe('POST /:id/decision — DEFER', () => {
  beforeEach(resetDb);

  it('DEFER avança a etapa (regressão do antigo /approve)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id); // a tarefa da etapa 0 vai ao iniciador

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });

  it('alias /approve continua funcionando', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);

    const res = await request(app).post(`/api/requests/${req.id}/approve`).set(auth(tokenFor(manager.id))).send({});
    expect(res.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });

  it('DEFER com requiredApprovers=2: o segundo aprovador conclui a etapa', async () => {
    const initiator = await makeUser('USER');
    const f1 = await makeUser('FINANCE');
    const f2 = await makeUser('FINANCE');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'B', minValueCents: 0, maxValueCents: null, requiredApprovers: 2, approverRole: 'FINANCE' }] },
      { order: 1 },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    await prisma.requestTask.create({ data: { requestId: req.id, stepId: step.id, assigneeId: initiator.id, title: 't', status: 'COMPLETED', completedAt: new Date() } });

    const r1 = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f1.id))).send({ action: 'DEFER' });
    expect(r1.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(0); // ainda falta 1

    const r2 = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f2.id))).send({ action: 'DEFER' });
    expect(r2.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });
});

describe('POST /:id/decision — REJECT', () => {
  beforeEach(resetDb);

  it('REJECT sem motivo → 400', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REJECT' });
    expect(res.status).toBe(400);
  });

  it('REJECT com motivo → REJECTED + tarefas canceladas + Approval', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REJECT', reason: 'fora de padrão' });
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('REJECTED');
    const openTasks = await prisma.requestTask.count({ where: { requestId: req.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
    expect(openTasks).toBe(0);
    const appr = await prisma.approval.findFirst({ where: { requestId: req.id, decision: 'REJECTED' } });
    expect(appr).not.toBeNull();
  });
});

describe('POST /:id/decision — REQUEST_CORRECTION', () => {
  beforeEach(resetDb);

  it('devolve ao solicitante: AWAITING_CORRECTION + tarefas CANCELLED + Comment + Approval', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }, { order: 1 }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REQUEST_CORRECTION', reason: 'falta anexo' });
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('AWAITING_CORRECTION');
    expect(fresh.correctionReturnStep).toBe(0);
    const openTasks = await prisma.requestTask.count({ where: { requestId: req.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
    expect(openTasks).toBe(0);
    const comment = await prisma.comment.findFirst({ where: { requestId: req.id, body: 'falta anexo' } });
    expect(comment).not.toBeNull();
    const appr = await prisma.approval.findFirst({ where: { requestId: req.id, decision: 'CORRECTION_REQUESTED' } });
    expect(appr).not.toBeNull();
  });

  it('sem motivo → 400', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REQUEST_CORRECTION' });
    expect(res.status).toBe(400);
  });
});

describe('POST /:id/decision — REQUEST_INFO', () => {
  beforeEach(resetDb);

  it('não altera status/tarefas, gera AuditLog e NÃO cria Approval', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REQUEST_INFO', reason: 'qual o centro de custo?' });
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('IN_PROGRESS');
    const openTasks = await prisma.requestTask.count({ where: { requestId: req.id, status: 'PENDING' } });
    expect(openTasks).toBeGreaterThan(0);
    const appr = await prisma.approval.count({ where: { requestId: req.id } });
    expect(appr).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'INFO_REQUESTED' } });
    expect(audit).not.toBeNull();
  });
});

describe('POST /:id/decision — FORWARD', () => {
  beforeEach(resetDb);

  it('sem destino → 400', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'FORWARD', reason: 'escalar' });
    expect(res.status).toBe(400);
  });

  it('encaminhar para o iniciador → 403', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'FORWARD', reason: 'x', forwardToUserId: initiator.id });
    expect(res.status).toBe(403);
  });

  it('encaminhar para si mesmo → 400', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'FORWARD', reason: 'x', forwardToUserId: manager.id });
    expect(res.status).toBe(400);
  });

  it('destino válido: nova tarefa direcionada + tarefa original CANCELLED', async () => {
    const initiator = await makeUser('USER');
    const lider = await makeUser('MANAGER'); // Líder I Financeiro (aprovador da etapa)
    const diretoria = await makeUser('FINANCE'); // instância superior
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(lider.id))).send({ action: 'FORWARD', reason: 'acima da minha alçada', forwardToUserId: diretoria.id });
    expect(res.status).toBe(200);

    const liderTask = await prisma.requestTask.findFirst({ where: { requestId: req.id, assigneeId: lider.id } });
    expect(liderTask?.status).toBe('CANCELLED');
    const destTask = await prisma.requestTask.findFirst({ where: { requestId: req.id, assigneeId: diretoria.id } });
    expect(destTask).not.toBeNull();
    expect(destTask?.status).toBe('PENDING');

    // REFINAMENTO 2: o destino pode decidir mesmo sem alçada própria pela faixa.
    const def = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(diretoria.id))).send({ action: 'DEFER' });
    expect(def.status).toBe(200);
  });

  it('destino que já APROVOU nesta etapa+rodada → 400', async () => {
    const initiator = await makeUser('USER');
    const m1 = await makeUser('MANAGER');
    const m2 = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    // m2 já registrou uma aprovação na rodada 0.
    await prisma.approval.create({ data: { requestId: req.id, approverId: m2.id, stepOrder: 0, decision: 'APPROVED', round: 0 } });

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(m1.id))).send({ action: 'FORWARD', reason: 'x', forwardToUserId: m2.id });
    expect(res.status).toBe(400);
  });

  it('encaminhar por papel (fila): cria tarefa para cada usuário ativo do papel', async () => {
    const initiator = await makeUser('USER');
    const lider = await makeUser('MANAGER');
    const d1 = await makeUser('FINANCE');
    const d2 = await makeUser('FINANCE');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(lider.id))).send({ action: 'FORWARD', reason: 'fila diretoria', forwardToRole: 'FINANCE' });
    expect(res.status).toBe(200);
    const destTasks = await prisma.requestTask.count({ where: { requestId: req.id, assigneeId: { in: [d1.id, d2.id] }, status: 'PENDING' } });
    expect(destTasks).toBe(2);
  });

  it('encaminhar a papel SEM alçada na etapa (com authLevels) → 403 (fecha bypass de alçada)', async () => {
    const initiator = await makeUser('USER');
    const finance = await makeUser('FINANCE'); // aprovador legítimo da faixa
    const hr = await makeUser('HR'); // papel sem alçada nesta etapa
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'FINANCE' }] },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    // por usuário HR → 403
    const r1 = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(finance.id))).send({ action: 'FORWARD', reason: 'x', forwardToUserId: hr.id });
    expect(r1.status).toBe(403);
    // por papel HR → 403
    const r2 = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(finance.id))).send({ action: 'FORWARD', reason: 'x', forwardToRole: 'HR' });
    expect(r2.status).toBe(403);
  });

  it('encaminhar à Diretoria (escalonamento p/ cima) → 200 e o diretor decide', async () => {
    const initiator = await makeUser('USER');
    const finance = await makeUser('FINANCE');
    const diretor = await makeUser('DIRETORIA');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'FINANCE' }] },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    const fwd = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(finance.id))).send({ action: 'FORWARD', reason: 'acima da alçada', forwardToRole: 'DIRETORIA' });
    expect(fwd.status).toBe(200);
    // O diretor (destino do encaminhamento) decide, mesmo sem alçada própria na faixa.
    const def = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(diretor.id))).send({ action: 'DEFER' });
    expect(def.status).toBe(200);
  });
});

describe('aprovador não age em pedido AWAITING_CORRECTION', () => {
  beforeEach(resetDb);

  it('decisão em pedido devolvido → 409', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'AWAITING_CORRECTION', currentStep: 0, correctionReturnStep: 0 },
    });
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(409);
  });
});

describe('POST /:id/resubmit', () => {
  beforeEach(resetDb);

  it('reenvio em pedido IN_PROGRESS → 409', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/resubmit`).set(auth(tokenFor(initiator.id))).send({});
    expect(res.status).toBe(409);
  });

  it('reenvio por terceiro (não iniciador/ADMIN) → 403', async () => {
    const initiator = await makeUser('USER');
    const other = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'AWAITING_CORRECTION', currentStep: 0, correctionReturnStep: 0 },
    });
    const res = await request(app).post(`/api/requests/${req.id}/resubmit`).set(auth(tokenFor(other.id))).send({});
    expect(res.status).toBe(403);
  });

  it('iniciador reenvia: volta a IN_PROGRESS e recria as tarefas da etapa', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }, { order: 1 }]);
    const req = await newRequest(flow.id, initiator.id);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    // Manager solicita correção.
    await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'REQUEST_CORRECTION', reason: 'corrigir' });

    const res = await request(app).post(`/api/requests/${req.id}/resubmit`).set(auth(tokenFor(initiator.id))).send({});
    expect(res.status).toBe(200);
    const fresh = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe('IN_PROGRESS');
    expect(fresh.currentStep).toBe(0);
    expect(fresh.correctionReturnStep).toBeNull();
    const openTasks = await prisma.requestTask.count({ where: { requestId: req.id, step: { order: 0 }, status: 'PENDING' } });
    expect(openTasks).toBeGreaterThan(0);

    // Após o reenvio, o MESMO aprovador anterior pode deferir (nova rodada).
    await completeCurrentStepTasks(req.id);
    const def = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(manager.id))).send({ action: 'DEFER' });
    expect(def.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });

  it('requiredApprovers=2: 1 aprovação da rodada anterior não conta após reenvio', async () => {
    const initiator = await makeUser('USER');
    const f1 = await makeUser('FINANCE');
    const f2 = await makeUser('FINANCE');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, requiredRole: 'FINANCE', authLevels: [{ name: 'B', minValueCents: 0, maxValueCents: null, requiredApprovers: 2, approverRole: 'FINANCE' }] },
      { order: 1 },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const { createRequestTasks } = await import('../src/services/workflow');
    await createRequestTasks(req.id, flow.id, 0);

    // Rodada 0: f1 defere, f2 solicita correção.
    await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f1.id))).send({ action: 'DEFER' });
    await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f2.id))).send({ action: 'REQUEST_CORRECTION', reason: 'ajustar' });

    // Reenvio abre rodada 1.
    await request(app).post(`/api/requests/${req.id}/resubmit`).set(auth(tokenFor(initiator.id))).send({});
    await completeCurrentStepTasks(req.id);

    // f1 defere de novo na rodada 1 → ainda falta o 2º (a aprovação da rodada 0 não conta).
    await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f1.id))).send({ action: 'DEFER' });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(0);

    // f2 defere → conclui a rodada 1, avança.
    await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(f2.id))).send({ action: 'DEFER' });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });
});

describe('regressões SoD / alçada / ADMIN', () => {
  beforeEach(resetDb);

  it('o iniciador não pode decidir a própria solicitação (SoD) → 403', async () => {
    const initiator = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
    const req = await newRequest(flow.id, initiator.id);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(initiator.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(403);
  });

  it('papel sem alçada na faixa → 403', async () => {
    const initiator = await makeUser('USER');
    const hr = await makeUser('HR');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'FINANCE' }] },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(hr.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(403);
  });

  it('ADMIN sempre pode decidir', async () => {
    const initiator = await makeUser('USER');
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, authLevels: [{ name: 'A', minValueCents: 0, maxValueCents: null, requiredApprovers: 1, approverRole: 'FINANCE' }] },
      { order: 1 },
    ]);
    const req = await newRequest(flow.id, initiator.id, 1000);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    await prisma.requestTask.create({ data: { requestId: req.id, stepId: step.id, assigneeId: initiator.id, title: 't', status: 'COMPLETED', completedAt: new Date() } });
    const res = await request(app).post(`/api/requests/${req.id}/decision`).set(auth(tokenFor(admin.id))).send({ action: 'DEFER' });
    expect(res.status).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(1);
  });
});
