import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { resolveQueueEligibles, isFunctionRole } from '../src/lib/queue';
import { createRequestTasks, isStepComplete } from '../src/services/workflow';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria um SectorMember (com User) num setor por nome, criando o setor se preciso.
async function addMember(sectorName: string, userId: string, level: string) {
  const sector =
    (await prisma.sector.findFirst({ where: { name: sectorName } })) ??
    (await prisma.sector.create({ data: { name: sectorName } }));
  return prisma.sectorMember.create({
    data: { sectorId: sector.id, userId, role: 'PROTETOR', level },
  });
}

describe('filas de função — resolução por hierarquia (Passo 6)', () => {
  beforeEach(resetDb);

  // U1 — identificação de etapa de função
  it('U1: isFunctionRole distingue funções de papéis legados', () => {
    expect(isFunctionRole('TI')).toBe(true);
    expect(isFunctionRole('DIRETORIA')).toBe(true);
    expect(isFunctionRole('MANAGER')).toBe(false);
    expect(isFunctionRole('USER')).toBe(false);
    expect(isFunctionRole(null)).toBe(false);
  });

  // U2 — resolve MEMBRO quando existe membro
  it('U2: resolve apenas MEMBROS quando há membro no setor', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    const lider = await makeUser('USER', 'rh-l1');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    await addMember('RH', lider.id, 'LIDER_1');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'RH' }, initiator.id);
    const ids = eligibles.map(e => e.id).sort();
    expect(ids).toEqual([m1.id, m2.id].sort());
    expect(ids).not.toContain(lider.id);
  });

  // U2b — PRECISÃO POR FUNÇÃO em setor multifunção (TI/DADOS/SISTEMAS no mesmo setor):
  // a fila da função vai a quem EXERCE a função (user.role), não a todo o setor.
  it('U2b: setor multifunção — fila da função TI só inclui quem tem papel TI', async () => {
    const initiator = await makeUser('USER', 'init');
    const ti = await makeUser('TI', 'tech-ti');
    const dados = await makeUser('DADOS', 'tech-dados');
    const sis = await makeUser('SISTEMAS', 'tech-sis');
    await addMember('TI, Dados e Infra', ti.id, 'MEMBRO');
    await addMember('TI, Dados e Infra', dados.id, 'MEMBRO');
    await addMember('TI, Dados e Infra', sis.id, 'MEMBRO');

    expect((await resolveQueueEligibles(prisma, { requiredRole: 'TI' }, initiator.id)).map(e => e.id)).toEqual([ti.id]);
    expect((await resolveQueueEligibles(prisma, { requiredRole: 'DADOS' }, initiator.id)).map(e => e.id)).toEqual([dados.id]);
    expect((await resolveQueueEligibles(prisma, { requiredRole: 'SISTEMAS' }, initiator.id)).map(e => e.id)).toEqual([sis.id]);
  });

  // U2d — PRECISÃO POR FUNÇÃO PRIORITÁRIA SOBRE O NÍVEL: o especialista da função
  // num nível ACIMA de membros genéricos deve receber a fila (não os genéricos).
  // (Regressão do bloqueador: preferência de função não podia ficar presa ao nível.)
  it('U2d: especialista de função em LIDER_2 + genéricos em MEMBRO → fila só o especialista', async () => {
    const initiator = await makeUser('USER', 'init');
    const tiLider = await makeUser('TI', 'ti-lider2');
    const gen1 = await makeUser('USER', 'gen-membro-1');
    const gen2 = await makeUser('USER', 'gen-membro-2');
    await addMember('TI, Dados e Infra', tiLider.id, 'LIDER_2');
    await addMember('TI, Dados e Infra', gen1.id, 'MEMBRO');
    await addMember('TI, Dados e Infra', gen2.id, 'MEMBRO');

    const ids = (await resolveQueueEligibles(prisma, { requiredRole: 'TI' }, initiator.id)).map(e => e.id);
    expect(ids).toEqual([tiLider.id]); // só quem exerce TI, mesmo estando acima dos genéricos
  });

  // U2c — fallback preservado: se NINGUÉM no setor exerce a função (papéis genéricos),
  // a fila recai sobre todos os membros do nível (comportamento original do Passo 6).
  it('U2c: sem ninguém exercendo a função → fallback para todos os membros do setor', async () => {
    const initiator = await makeUser('USER', 'init');
    const a = await makeUser('USER', 'ti-generico-a');
    const b = await makeUser('USER', 'ti-generico-b');
    await addMember('TI, Dados e Infra', a.id, 'MEMBRO');
    await addMember('TI, Dados e Infra', b.id, 'MEMBRO');

    const ids = (await resolveQueueEligibles(prisma, { requiredRole: 'TI' }, initiator.id)).map(e => e.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  // U3 — fallback MEMBRO → LÍDER II
  it('U3: cai para LÍDER II quando não há membro', async () => {
    const initiator = await makeUser('USER', 'init');
    const l2 = await makeUser('USER', 'fin-l2');
    const l1 = await makeUser('USER', 'fin-l1');
    await addMember('Financeiro', l2.id, 'LIDER_2');
    await addMember('Financeiro', l1.id, 'LIDER_1');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'FINANCEIRO' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([l2.id]);
  });

  // U4 — fallback LÍDER II → LÍDER I
  it('U4: cai para LÍDER I quando não há membro nem líder II', async () => {
    const initiator = await makeUser('USER', 'init');
    const l1 = await makeUser('USER', 'adm-l1');
    await addMember('Administrativo', l1.id, 'LIDER_1');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'ADMINISTRATIVO' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([l1.id]);
  });

  // U5 — SoD: iniciador excluído mesmo sendo membro
  it('U5: exclui o iniciador da fila (SoD) quando há outro elegível', async () => {
    const initiator = await makeUser('USER', 'init-membro');
    const other = await makeUser('USER', 'outro-membro');
    await addMember('RH', initiator.id, 'MEMBRO');
    await addMember('RH', other.id, 'MEMBRO');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'RH' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([other.id]);
  });

  // U6 — fallback final ao iniciador quando ninguém elegível
  it('U6: recai sobre o iniciador quando não há elegíveis', async () => {
    const initiator = await makeUser('USER', 'sozinho');
    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'TI' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([initiator.id]);
  });

  // U7 — múltiplas funções no mesmo setor (TI/DADOS/SISTEMAS) resolvem do mesmo setor
  it('U7: funções do setor de tecnologia (TI/DADOS/SISTEMAS) resolvem do mesmo setor', async () => {
    const initiator = await makeUser('USER', 'init');
    const m = await makeUser('USER', 'tech-membro');
    await addMember('TI, Dados e Infra', m.id, 'MEMBRO');

    for (const role of ['TI', 'DADOS', 'SISTEMAS']) {
      const eligibles = await resolveQueueEligibles(prisma, { requiredRole: role }, initiator.id);
      expect(eligibles.map(e => e.id)).toEqual([m.id]);
    }
  });

  // U8 — DIRETORIA: qualquer membro do setor (qualquer nível)
  it('U8: DIRETORIA aceita qualquer membro do setor Diretoria (qualquer nível)', async () => {
    const initiator = await makeUser('USER', 'init');
    const d1 = await makeUser('USER', 'dir-membro');
    const d2 = await makeUser('USER', 'dir-lider');
    await addMember('Diretoria', d1.id, 'MEMBRO');
    await addMember('Diretoria', d2.id, 'LIDER_1');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'DIRETORIA' }, initiator.id);
    expect(eligibles.map(e => e.id).sort()).toEqual([d1.id, d2.id].sort());
  });

  // U9 — DIRETORIA: fallback a User.role='DIRETORIA' se o setor não existir
  it('U9: DIRETORIA cai para usuários com papel DIRETORIA se não há setor', async () => {
    const initiator = await makeUser('USER', 'init');
    const dir = await makeUser('DIRETORIA', 'diretor-papel');
    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'DIRETORIA' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([dir.id]);
  });

  // U-extra — ignora membros inativos
  it('ignora membros inativos na fila', async () => {
    const initiator = await makeUser('USER', 'init');
    const ativo = await makeUser('USER', 'ativo');
    const inativo = await makeUser('USER', 'inativo');
    await prisma.user.update({ where: { id: inativo.id }, data: { isActive: false } });
    await addMember('RH', ativo.id, 'MEMBRO');
    await addMember('RH', inativo.id, 'MEMBRO');

    const eligibles = await resolveQueueEligibles(prisma, { requiredRole: 'RH' }, initiator.id);
    expect(eligibles.map(e => e.id)).toEqual([ativo.id]);
  });
});

describe('filas de função — fan-out e conclusão (Passo 6)', () => {
  beforeEach(resetDb);

  // I1 — fan-out cria uma tarefa por elegível
  it('I1: createRequestTasks faz fan-out (uma tarefa PENDING por membro)', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);
    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.status === 'PENDING')).toBe(true);
    expect(tasks.map(t => t.assigneeId).sort()).toEqual([m1.id, m2.id].sort());
  });

  // I-compat — caminho legado por papel intacto
  it('I-compat: papel legado (MANAGER) segue o caminho por User.role', async () => {
    const initiator = await makeUser('USER', 'init');
    const a = await makeUser('MANAGER', 'mgr-a');
    const b = await makeUser('MANAGER', 'mgr-b');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    await createRequestTasks(req.id, flow.id, 0);
    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks.map(t => t.assigneeId).sort()).toEqual([a.id, b.id].sort());
  });

  // I2 — claim na própria linha; inelegível (linha de outro) → 403
  it('I2: assumir tarefa de OUTRO usuário retorna 403', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const taskM1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    // m2 tenta assumir a linha de m1
    const res = await request(app).post(`/api/tasks/${taskM1.id}/claim`).set(auth(tokenFor(m2.id)));
    expect(res.status).toBe(403);
  });

  // I3 — claim assume e cancela as irmãs
  it('I3: assumir vira IN_PROGRESS e cancela irmãs PENDING', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const taskM1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    const res = await request(app).post(`/api/tasks/${taskM1.id}/claim`).set(auth(tokenFor(m1.id)));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');

    const mine = await prisma.requestTask.findUniqueOrThrow({ where: { id: taskM1.id } });
    expect(mine.status).toBe('IN_PROGRESS');
    const sibling = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m2.id } });
    expect(sibling.status).toBe('CANCELLED');
    // assigneeId NÃO muda (claim na própria linha)
    expect(mine.assigneeId).toBe(m1.id);

    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'TASK_CLAIMED' } });
    expect(audit).not.toBeNull();
  });

  // I4 — segundo claim concorrente → 409
  it('I4: segundo claim numa tarefa já assumida retorna 409', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    await addMember('RH', m1.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    const first = await request(app).post(`/api/tasks/${t.id}/claim`).set(auth(tokenFor(m1.id)));
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/tasks/${t.id}/claim`).set(auth(tokenFor(m1.id)));
    expect(second.status).toBe(409);
  });

  // I5 — claim de tarefa inexistente → 404
  it('I5: claim de tarefa inexistente retorna 404', async () => {
    const u = await makeUser('USER', 'u');
    const res = await request(app).post('/api/tasks/inexistente/claim').set(auth(tokenFor(u.id)));
    expect(res.status).toBe(404);
  });

  // I6 — fluxo completo: assumir → concluir fecha a etapa
  it('I6: assumir e depois concluir avança/conclui a solicitação', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    await request(app).post(`/api/tasks/${t.id}/claim`).set(auth(tokenFor(m1.id)));
    const comp = await request(app).post(`/api/tasks/${t.id}/complete`).set(auth(tokenFor(m1.id)));
    expect(comp.status).toBe(200);

    const reqAfter = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(reqAfter.status).toBe('COMPLETED');
  });

  // I7 — REF.2: concluir-direto (sem claim) cancela irmãs e fecha a etapa
  it('I7: concluir direto (sem assumir) cancela irmãs e conclui', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    const comp = await request(app).post(`/api/tasks/${t.id}/complete`).set(auth(tokenFor(m1.id)));
    expect(comp.status).toBe(200);

    const sibling = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m2.id } });
    expect(sibling.status).toBe('CANCELLED');
    const reqAfter = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(reqAfter.status).toBe('COMPLETED');
  });

  // Dono único: assumir falha se uma irmã já está IN_PROGRESS (fila tomada).
  it('dono único: assumir retorna 409 se a fila já foi assumida por outro', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });
    const t2 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m2.id } });
    // simula irmã já assumida (estado de corrida)
    await prisma.requestTask.update({ where: { id: t1.id }, data: { status: 'IN_PROGRESS' } });

    const res = await request(app).post(`/api/tasks/${t2.id}/claim`).set(auth(tokenFor(m2.id)));
    expect(res.status).toBe(409);
  });

  // Finalização: concluir cancela também irmã IN_PROGRESS (não deixa órfã).
  it('conclusão finaliza: concluir cancela irmã IN_PROGRESS, sem deixar tarefa presa', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });
    const t2 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m2.id } });
    // m2 já assumida em paralelo (IN_PROGRESS); m1 conclui direto a sua linha
    await prisma.requestTask.update({ where: { id: t2.id }, data: { status: 'IN_PROGRESS' } });

    const comp = await request(app).post(`/api/tasks/${t1.id}/complete`).set(auth(tokenFor(m1.id)));
    expect(comp.status).toBe(200);
    const sib = await prisma.requestTask.findUniqueOrThrow({ where: { id: t2.id } });
    expect(sib.status).toBe('CANCELLED'); // não ficou órfã IN_PROGRESS
  });

  // I8 — isStepComplete ignora CANCELLED
  it('I8: isStepComplete só considera tarefas não-canceladas', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });
    const t2 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m2.id } });

    // ainda PENDING → não completa
    expect(await isStepComplete(req.id, 0)).toBe(false);
    // cancela uma e conclui a outra → completa
    await prisma.requestTask.update({ where: { id: t2.id }, data: { status: 'CANCELLED' } });
    await prisma.requestTask.update({ where: { id: t1.id }, data: { status: 'COMPLETED' } });
    expect(await isStepComplete(req.id, 0)).toBe(true);
  });

  // I9 — complete de etapa legada NÃO cancela irmãs (não regride)
  it('I9: complete de etapa legada (MANAGER) não cancela tarefas irmãs', async () => {
    const initiator = await makeUser('USER', 'init');
    const a = await makeUser('MANAGER', 'mgr-a');
    const b = await makeUser('MANAGER', 'mgr-b');
    const flow = await makeFlow('PAYMENT', [{ order: 0, requiredRole: 'MANAGER' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const ta = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: a.id } });

    const comp = await request(app).post(`/api/tasks/${ta.id}/complete`).set(auth(tokenFor(a.id)));
    expect(comp.status).toBe(200);

    // a irmã de 'b' continua PENDING (comportamento legado preservado)
    const tb = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: b.id } });
    expect(tb.status).toBe('PENDING');
  });

  // I-my — GET /tasks/my não retorna tarefas CANCELLED
  it('I-my: GET /tasks/my omite tarefas canceladas', async () => {
    const initiator = await makeUser('USER', 'init');
    const m1 = await makeUser('USER', 'rh-m1');
    const m2 = await makeUser('USER', 'rh-m2');
    await addMember('RH', m1.id, 'MEMBRO');
    await addMember('RH', m2.id, 'MEMBRO');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: 'RH' }]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);
    const t1 = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id, assigneeId: m1.id } });

    await request(app).post(`/api/tasks/${t1.id}/claim`).set(auth(tokenFor(m1.id)));
    // m2 perdeu a fila → não deve ver a tarefa cancelada
    const res = await request(app).get('/api/tasks/my').set(auth(tokenFor(m2.id)));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
