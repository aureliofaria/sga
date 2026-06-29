// Passo 8 — subtarefas/checklist por etapa (condicional + gating)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';
import {
  parseCondition,
  evaluateApplicabilityInMemory,
  validateConditionPayload,
} from '../src/lib/checklist';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flowWithStep() {
  const flow = await makeFlow('PAYMENT', [{ order: 0 }]);
  const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id } });
  return { flow, step };
}

async function requestWithTask(flowId: string, stepId: string, initiatorId: string, assigneeId: string) {
  const req = await prisma.request.create({
    data: { flowId, initiatorId, title: 'req-checklist', status: 'IN_PROGRESS', currentStep: 0 },
  });
  await prisma.requestTask.create({
    data: { requestId: req.id, stepId, assigneeId, title: 'tarefa', status: 'PENDING' },
  });
  return req;
}

async function createItem(
  adminToken: string,
  flowId: string,
  stepId: string,
  body: object
) {
  return request(app)
    .post(`/api/flows/${flowId}/steps/${stepId}/checklist`)
    .set(auth(adminToken))
    .send(body);
}

// ---------------------------------------------------------------------------
// Testes unitários da biblioteca
// ---------------------------------------------------------------------------

describe('checklist lib — parseCondition', () => {
  it('retorna null para null/undefined/string vazia', () => {
    expect(parseCondition(null)).toBeNull();
    expect(parseCondition(undefined)).toBeNull();
    expect(parseCondition('')).toBeNull();
  });

  it('retorna null para JSON inválido', () => {
    expect(parseCondition('nao-e-json')).toBeNull();
  });

  it('retorna null para tipo desconhecido (fail-safe)', () => {
    expect(parseCondition(JSON.stringify({ type: 'unknown', foo: 'bar' }))).toBeNull();
  });

  it('parseia resourceItem', () => {
    const c = parseCondition(JSON.stringify({ type: 'resourceItem', resourceItemId: 'rid1' }));
    expect(c).toEqual({ type: 'resourceItem', resourceItemId: 'rid1' });
  });

  it('parseia fieldValue', () => {
    const c = parseCondition(JSON.stringify({ type: 'fieldValue', fieldKey: 'status', equals: 'ativo' }));
    expect(c).toEqual({ type: 'fieldValue', fieldKey: 'status', equals: 'ativo' });
  });
});

describe('checklist lib — evaluateApplicabilityInMemory', () => {
  // fieldValues: Map<key, Set<value>> (exists/any) — uma key pode ter vários
  // valores entre etapas distintas.
  const ctx = {
    resourceItemIds: new Set(['r1', 'r2']),
    fieldValues: new Map<string, Set<string>>([
      ['status', new Set(['ativo'])],
      ['tipo', new Set(['pessoa_fisica'])],
    ]),
  };

  it('fieldValue casa quando a key tem o valor entre VÁRIOS (key duplicada entre etapas)', () => {
    // Simula a mesma key 'status' preenchida em 2 etapas: 'nao' e 'sim'.
    const multi = {
      resourceItemIds: new Set<string>(),
      fieldValues: new Map<string, Set<string>>([['status', new Set(['nao', 'sim'])]]),
    };
    const item = [{ id: 'i1', condition: JSON.stringify({ type: 'fieldValue', fieldKey: 'status', equals: 'sim' }) }];
    // exists/any: aplicável porque ALGUM valor da key é 'sim' (casa com o gate).
    expect(evaluateApplicabilityInMemory(item, multi)[0].applicable).toBe(true);
  });

  it('sem condição → applicable=true', () => {
    const items = [{ id: 'i1', condition: null }];
    const res = evaluateApplicabilityInMemory(items, ctx);
    expect(res[0].applicable).toBe(true);
  });

  it('resourceItem presente → applicable=true', () => {
    const items = [{ id: 'i1', condition: JSON.stringify({ type: 'resourceItem', resourceItemId: 'r1' }) }];
    expect(evaluateApplicabilityInMemory(items, ctx)[0].applicable).toBe(true);
  });

  it('resourceItem ausente → applicable=false', () => {
    const items = [{ id: 'i1', condition: JSON.stringify({ type: 'resourceItem', resourceItemId: 'r99' }) }];
    expect(evaluateApplicabilityInMemory(items, ctx)[0].applicable).toBe(false);
  });

  it('fieldValue casando → applicable=true', () => {
    const items = [{ id: 'i1', condition: JSON.stringify({ type: 'fieldValue', fieldKey: 'status', equals: 'ativo' }) }];
    expect(evaluateApplicabilityInMemory(items, ctx)[0].applicable).toBe(true);
  });

  it('fieldValue diferente → applicable=false', () => {
    const items = [{ id: 'i1', condition: JSON.stringify({ type: 'fieldValue', fieldKey: 'status', equals: 'inativo' }) }];
    expect(evaluateApplicabilityInMemory(items, ctx)[0].applicable).toBe(false);
  });

  it('tipo desconhecido na condição → applicable=true (fail-safe permissivo)', () => {
    const items = [{ id: 'i1', condition: JSON.stringify({ type: 'xpto', foo: 'bar' }) }];
    expect(evaluateApplicabilityInMemory(items, ctx)[0].applicable).toBe(true);
  });
});

describe('checklist lib — validateConditionPayload', () => {
  it('null → ok (sem condição)', () => {
    const r = validateConditionPayload(null);
    expect(r.ok).toBe(true);
  });

  it('resourceItem válido → ok', () => {
    const r = validateConditionPayload({ type: 'resourceItem', resourceItemId: 'abc' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.json)).toMatchObject({ type: 'resourceItem' });
  });

  it('fieldValue válido → ok', () => {
    const r = validateConditionPayload({ type: 'fieldValue', fieldKey: 'k', equals: 'v' });
    expect(r.ok).toBe(true);
  });

  it('tipo inválido → error', () => {
    const r = validateConditionPayload({ type: 'banana' });
    expect(r.ok).toBe(false);
  });

  it('resourceItem sem resourceItemId → error', () => {
    const r = validateConditionPayload({ type: 'resourceItem' });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CRUD de definição (ADMIN)
// ---------------------------------------------------------------------------

describe('Passo 8 — CRUD de ChecklistItem', () => {
  beforeEach(resetDb);

  it('ADMIN cria item sem condição (201)', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'Assinar documento' });
    expect(r.status).toBe(201);
    expect(r.body.label).toBe('Assinar documento');
    expect(r.body.required).toBe(true);
  });

  it('ADMIN cria item com condição resourceItem (201)', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(admin.id), flow.id, step.id, {
      label: 'Verificar item',
      condition: { type: 'resourceItem', resourceItemId: 'res1' },
    });
    expect(r.status).toBe(201);
    expect(r.body.condition).toContain('resourceItem');
  });

  it('ADMIN cria item com condição fieldValue (201)', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(admin.id), flow.id, step.id, {
      label: 'Campo condicional',
      condition: { type: 'fieldValue', fieldKey: 'tipo', equals: 'pj' },
    });
    expect(r.status).toBe(201);
  });

  it('condition inválida retorna 400', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(admin.id), flow.id, step.id, {
      label: 'X',
      condition: { type: 'invalido' },
    });
    expect(r.status).toBe(400);
  });

  it('label ausente retorna 400', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(admin.id), flow.id, step.id, { required: true });
    expect(r.status).toBe(400);
  });

  it('não-ADMIN não cria item (403)', async () => {
    const user = await makeUser('USER');
    const { flow, step } = await flowWithStep();
    const r = await createItem(tokenFor(user.id), flow.id, step.id, { label: 'X' });
    expect(r.status).toBe(403);
  });

  it('ADMIN atualiza item (200)', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const created = await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'Original' });
    expect(created.status).toBe(201);
    const r = await request(app)
      .put(`/api/flows/${flow.id}/steps/${step.id}/checklist/${created.body.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ label: 'Atualizado', required: false });
    expect(r.status).toBe(200);
    expect(r.body.label).toBe('Atualizado');
    expect(r.body.required).toBe(false);
  });

  it('PUT com condition inválida retorna 400', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const created = await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'X' });
    const r = await request(app)
      .put(`/api/flows/${flow.id}/steps/${step.id}/checklist/${created.body.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ condition: { type: 'invalido' } });
    expect(r.status).toBe(400);
  });

  it('ADMIN deleta item (200)', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const created = await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'X' });
    const r = await request(app)
      .delete(`/api/flows/${flow.id}/steps/${step.id}/checklist/${created.body.id}`)
      .set(auth(tokenFor(admin.id)));
    expect(r.status).toBe(200);
  });

  it('não-ADMIN não deleta item (403)', async () => {
    const admin = await makeUser('ADMIN');
    const user = await makeUser('USER');
    const { flow, step } = await flowWithStep();
    const created = await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'X' });
    const r = await request(app)
      .delete(`/api/flows/${flow.id}/steps/${step.id}/checklist/${created.body.id}`)
      .set(auth(tokenFor(user.id)));
    expect(r.status).toBe(403);
  });

  it('GET /:id de fluxo inclui checklistItems', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'Item A', order: 1 });
    await createItem(tokenFor(admin.id), flow.id, step.id, { label: 'Item B', order: 2 });
    const r = await request(app).get(`/api/flows/${flow.id}`).set(auth(tokenFor(admin.id)));
    expect(r.status).toBe(200);
    const stepData = r.body.steps[0];
    expect(stepData.checklistItems).toHaveLength(2);
    expect(stepData.checklistItems[0].label).toBe('Item A');
  });
});

// ---------------------------------------------------------------------------
// Marcar / desmarcar
// ---------------------------------------------------------------------------

describe('Passo 8 — marcar/desmarcar checklist', () => {
  beforeEach(resetDb);

  async function setup() {
    const admin = await makeUser('ADMIN');
    const assignee = await makeUser('MANAGER');
    const { flow, step } = await flowWithStep();
    const item = await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Item 1', required: true },
    });
    const req = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    return { admin, assignee, flow, step, item, req };
  }

  it('assignee marca item (200, persiste, auditLog)', async () => {
    const { assignee, req, item } = await setup();
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.checked).toBe(true);
    expect(r.body.itemId).toBe(item.id);

    const state = await prisma.requestChecklistItem.findUnique({
      where: { requestId_itemId: { requestId: req.id, itemId: item.id } },
    });
    expect(state?.checked).toBe(true);
    expect(state?.checkedById).toBe(assignee.id);
    expect(state?.checkedAt).toBeTruthy();

    const log = await prisma.auditLog.findFirst({
      where: { requestId: req.id, action: 'CHECKLIST_ITEM_CHECKED' },
    });
    expect(log).toBeTruthy();
    expect(log?.details).toContain(item.id);
  });

  it('desmarcar item idempotente (200, checked=false, checkedById=null)', async () => {
    const { assignee, req, item } = await setup();
    // Marca
    await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    // Desmarca
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: false });
    expect(r.status).toBe(200);
    expect(r.body.checked).toBe(false);

    const state = await prisma.requestChecklistItem.findUnique({
      where: { requestId_itemId: { requestId: req.id, itemId: item.id } },
    });
    expect(state?.checked).toBe(false);
    expect(state?.checkedById).toBeNull();
    expect(state?.checkedAt).toBeNull();
  });

  it('item de outro fluxo retorna 400', async () => {
    const { assignee, req } = await setup();
    // Cria item em outro fluxo
    const flow2 = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const step2 = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow2.id } });
    const otherItem = await prisma.checklistItem.create({
      data: { flowStepId: step2.id, label: 'Outro', required: true },
    });
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${otherItem.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('fluxo');
  });

  it('item não aplicável retorna 400', async () => {
    const { admin, assignee, flow, step } = await setup();
    // Item condicional em resource que NÃO existe na solicitação.
    const condItem = await prisma.checklistItem.create({
      data: {
        flowStepId: step.id,
        label: 'Condicional',
        required: true,
        condition: JSON.stringify({ type: 'resourceItem', resourceItemId: 'rid-inexistente' }),
      },
    });
    const req2 = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    const r = await request(app)
      .post(`/api/requests/${req2.id}/checklist/${condItem.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('não se aplica');
  });

  it('usuário sem tarefa aberta retorna 403', async () => {
    const { req, item } = await setup();
    const intruder = await makeUser('MANAGER');
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(intruder.id)))
      .send({ checked: true });
    expect(r.status).toBe(403);
  });

  it('ADMIN sem tarefa pode marcar (200)', async () => {
    const { admin, req, item } = await setup();
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ checked: true });
    expect(r.status).toBe(200);
  });

  it('checked ausente retorna 400', async () => {
    const { assignee, req, item } = await setup();
    const r = await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({});
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Gating de conclusão de tarefa
// ---------------------------------------------------------------------------

describe('Passo 8 — gating de conclusão', () => {
  beforeEach(resetDb);

  async function setupGating() {
    const admin = await makeUser('ADMIN');
    const assignee = await makeUser('MANAGER');
    const { flow, step } = await flowWithStep();
    const item = await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Assinar contrato', required: true },
    });
    const req = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id } });
    return { admin, assignee, flow, step, item, req, task };
  }

  it('required+aplicável+unchecked → 400 com pending', async () => {
    const { assignee, task, item } = await setupGating();
    const r = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .set(auth(tokenFor(assignee.id)))
      .send({ notes: 'ok' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('checklist');
    expect(r.body.pending).toContain(item.label);
  });

  it('item checked → completa com 200', async () => {
    const { assignee, req, task, item } = await setupGating();
    // Marca o item.
    await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    const r = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .set(auth(tokenFor(assignee.id)))
      .send({ notes: 'ok' });
    expect(r.status).toBe(200);
  });

  it('item não aplicável → não bloqueia conclusão', async () => {
    const admin = await makeUser('ADMIN');
    const assignee = await makeUser('MANAGER');
    const { flow, step } = await flowWithStep();
    // Item condicional: resourceItem que NÃO existe.
    await prisma.checklistItem.create({
      data: {
        flowStepId: step.id,
        label: 'Condicional',
        required: true,
        condition: JSON.stringify({ type: 'resourceItem', resourceItemId: 'rid-nao-existe' }),
      },
    });
    const req = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id } });
    const r = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .set(auth(tokenFor(assignee.id)))
      .send({ notes: 'ok' });
    expect(r.status).toBe(200);
  });

  it('required=false → não bloqueia conclusão', async () => {
    const admin = await makeUser('ADMIN');
    const assignee = await makeUser('MANAGER');
    const { flow, step } = await flowWithStep();
    await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Opcional', required: false },
    });
    const req = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id } });
    const r = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .set(auth(tokenFor(assignee.id)))
      .send({ notes: 'ok' });
    expect(r.status).toBe(200);
  });

  it('batch-complete → skipped quando checklist incompleto', async () => {
    const { assignee, task } = await setupGating();
    const r = await request(app)
      .post('/api/tasks/batch-complete')
      .set(auth(tokenFor(assignee.id)))
      .send({ taskIds: [task.id] });
    expect(r.status).toBe(200);
    const skipped = r.body.skipped as { id: string; reason: string }[];
    const s = skipped.find((x) => x.id === task.id);
    expect(s).toBeTruthy();
    expect(s?.reason).toBe('checklist incompleto');
  });

  it('batch-complete → conclui após checklist marcado', async () => {
    const { assignee, req, task, item } = await setupGating();
    await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(assignee.id)))
      .send({ checked: true });
    const r = await request(app)
      .post('/api/tasks/batch-complete')
      .set(auth(tokenFor(assignee.id)))
      .send({ taskIds: [task.id] });
    expect(r.status).toBe(200);
    expect(r.body.completed).toBe(1);
  });

  it('regressão — etapa sem checklist conclui normal', async () => {
    const admin = await makeUser('ADMIN');
    const assignee = await makeUser('MANAGER');
    const { flow, step } = await flowWithStep();
    // Sem itens de checklist.
    const req = await requestWithTask(flow.id, step.id, admin.id, assignee.id);
    const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: req.id } });
    const r = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .set(auth(tokenFor(assignee.id)))
      .send({ notes: 'ok' });
    expect(r.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /:id expõe checklistItems com applicable e checked
// ---------------------------------------------------------------------------

describe('Passo 8 — GET /requests/:id com applicable', () => {
  beforeEach(resetDb);

  it('expõe checklistItems por etapa com applicable e checked', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Sem condição', required: true },
    });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: admin.id, title: 'req', status: 'IN_PROGRESS', currentStep: 0 },
    });
    const r = await request(app)
      .get(`/api/requests/${req.id}`)
      .set(auth(tokenFor(admin.id)));
    expect(r.status).toBe(200);
    const steps = r.body.flow.steps as any[];
    const items = steps[0].checklistItems as any[];
    expect(items).toHaveLength(1);
    expect(items[0].applicable).toBe(true);  // sem condição → sempre aplicável
    expect(items[0].checked).toBe(false);    // não marcado ainda
  });

  it('item com condição resourceItem não presente → applicable=false', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    await prisma.checklistItem.create({
      data: {
        flowStepId: step.id,
        label: 'Condicional',
        required: true,
        condition: JSON.stringify({ type: 'resourceItem', resourceItemId: 'rid-ausente' }),
      },
    });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: admin.id, title: 'req', status: 'IN_PROGRESS', currentStep: 0 },
    });
    const r = await request(app)
      .get(`/api/requests/${req.id}`)
      .set(auth(tokenFor(admin.id)));
    expect(r.status).toBe(200);
    const steps = r.body.flow.steps as any[];
    const items = steps[0].checklistItems as any[];
    expect(items[0].applicable).toBe(false);
  });

  it('item marcado → checked=true no GET', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();
    const item = await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Item check', required: true },
    });
    const req = await requestWithTask(flow.id, step.id, admin.id, admin.id);
    // Marca
    await request(app)
      .post(`/api/requests/${req.id}/checklist/${item.id}`)
      .set(auth(tokenFor(admin.id)))
      .send({ checked: true });
    const r = await request(app)
      .get(`/api/requests/${req.id}`)
      .set(auth(tokenFor(admin.id)));
    expect(r.status).toBe(200);
    const steps = r.body.flow.steps as any[];
    const ci = steps[0].checklistItems.find((i: any) => i.id === item.id);
    expect(ci.checked).toBe(true);
    expect(ci.applicable).toBe(true);
  });

  it('item condicional por fieldValue — applicable avaliado em memória', async () => {
    const admin = await makeUser('ADMIN');
    const { flow, step } = await flowWithStep();

    // Cria campo dinâmico na etapa
    const field = await prisma.formField.create({
      data: { flowStepId: step.id, key: 'tipo_contrato', label: 'Tipo', type: 'SELECT', order: 0 },
    });
    // Item de checklist condicional ao campo
    await prisma.checklistItem.create({
      data: {
        flowStepId: step.id,
        label: 'PJ deve enviar contrato social',
        required: true,
        condition: JSON.stringify({ type: 'fieldValue', fieldKey: 'tipo_contrato', equals: 'PJ' }),
      },
    });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: admin.id, title: 'req', status: 'IN_PROGRESS', currentStep: 0 },
    });
    // Preenche o campo com 'PF' → item NÃO aplicável.
    await prisma.requestFieldValue.create({
      data: { requestId: req.id, fieldId: field.id, value: 'PF' },
    });

    const r1 = await request(app).get(`/api/requests/${req.id}`).set(auth(tokenFor(admin.id)));
    expect(r1.status).toBe(200);
    const items1 = r1.body.flow.steps[0].checklistItems as any[];
    expect(items1[0].applicable).toBe(false);

    // Atualiza o campo para 'PJ' → item PASSA a ser aplicável.
    await prisma.requestFieldValue.update({
      where: { requestId_fieldId: { requestId: req.id, fieldId: field.id } },
      data: { value: 'PJ' },
    });
    const r2 = await request(app).get(`/api/requests/${req.id}`).set(auth(tokenFor(admin.id)));
    const items2 = r2.body.flow.steps[0].checklistItems as any[];
    expect(items2[0].applicable).toBe(true);
  });
});
