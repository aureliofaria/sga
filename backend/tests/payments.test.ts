import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria um fluxo PAYMENT realista: etapa 0 (Solicitação, USER, exige anexo),
// etapa 1 (Aprovação por alçada) e etapa 2 (Processamento Financeiro).
async function makePaymentFlow() {
  const flow = await prisma.flowTemplate.create({ data: { name: 'PAY', type: 'PAYMENT', isActive: true } });
  await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 0, name: 'Solicitação', requiredRole: 'USER', requiresAttachment: true } });
  const approval = await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 1, name: 'Aprovação', requiredRole: 'MANAGER' } });
  await prisma.authorizationLevel.createMany({
    data: [
      { flowStepId: approval.id, name: 'A', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER' },
      { flowStepId: approval.id, name: 'B', minValueCents: 500001, maxValueCents: 5000000, requiredApprovers: 1, approverRole: 'FINANCE' },
      { flowStepId: approval.id, name: 'C', minValueCents: 5000001, maxValueCents: null, requiredApprovers: 2, approverRole: 'ADMIN' },
    ],
  });
  await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 2, name: 'Financeiro', requiredRole: 'FINANCE', requiresAttachment: true } });
  return flow;
}

const validPayment = (flowId: string, over: Record<string, unknown> = {}) => ({
  flowId, title: 'Pagamento X', paymentCategory: 'COMPRA', amountCents: 100000,
  supplier: 'Fornecedor Ltda', costCenter: 'CC-1', justification: 'necessário', ...over,
});

describe('pagamentos — validação de categoria e campos', () => {
  beforeEach(resetDb);

  it('cria pagamento válido (201) e persiste a categoria', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id));
    expect(res.status).toBe(201);
    expect(res.body.paymentCategory).toBe('COMPRA');
  });

  it('rejeita categoria ausente/inválida (400)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { paymentCategory: undefined }))).status).toBe(400);
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { paymentCategory: 'XPTO' }))).status).toBe(400);
  });

  it('COMPRA exige fornecedor (400 sem supplier)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { supplier: '' }));
    expect(res.status).toBe(400);
  });

  it('exige centro de custo e justificativa (400)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { costCenter: '' }))).status).toBe(400);
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { justification: '  ' }))).status).toBe(400);
  });

  it('REEMBOLSO não exige fornecedor', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { paymentCategory: 'REEMBOLSO', supplier: undefined }));
    expect(res.status).toBe(201);
  });
});

describe('pagamentos — validação de valor (centavos)', () => {
  beforeEach(resetDb);

  it('rejeita valor zero, negativo e não-numérico (400)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const t = tokenFor(user.id);
    expect((await request(app).post('/api/requests').set(auth(t)).send(validPayment(flow.id, { amountCents: 0 }))).status).toBe(400);
    expect((await request(app).post('/api/requests').set(auth(t)).send(validPayment(flow.id, { amountCents: -100 }))).status).toBe(400);
    expect((await request(app).post('/api/requests').set(auth(t)).send(validPayment(flow.id, { amountCents: 'abc' }))).status).toBe(400);
  });

  it('rejeita overflow acima do teto sanitário (400)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { amountCents: 10_000_000_001 }));
    expect(res.status).toBe(400);
  });

  it('arredonda valor fracionário para centavos inteiros (sem float)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { amountCents: 100050.7 }));
    expect(res.status).toBe(201);
    expect(Number.isInteger(res.body.amountCents)).toBe(true);
    expect(res.body.amountCents).toBe(100051);
  });
});

describe('pagamentos — segregação de funções e autorização', () => {
  beforeEach(resetDb);

  async function createPaymentAs(userId: string, flowId: string, amountCents = 100000) {
    return request(app).post('/api/requests').set(auth(tokenFor(userId))).send(validPayment(flowId, { amountCents }));
  }

  it('iniciador NÃO aprova o próprio pagamento (403)', async () => {
    const initiator = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    const created = await createPaymentAs(initiator.id, flow.id);
    // avança para etapa de aprovação concluindo a etapa 0
    const reqId = created.body.id;
    await prisma.requestTask.updateMany({ where: { requestId: reqId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });
    const res = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(initiator.id))).send({});
    expect(res.status).toBe(403);
  });

  it('USER comum não tem alçada para aprovar (403)', async () => {
    const initiator = await makeUser('USER');
    const intruso = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await createPaymentAs(initiator.id, flow.id);
    const reqId = created.body.id;
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });
    const res = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(intruso.id))).send({});
    expect(res.status).toBe(403);
  });

  it('aprovador da alçada errada (faixa B exige FINANCE) é barrado (403)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    // 6.000,00 -> faixa B (FINANCE), MANAGER não tem alçada
    const created = await createPaymentAs(initiator.id, flow.id, 600000);
    const reqId = created.body.id;
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });
    const res = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({});
    expect(res.status).toBe(403);
  });

  it('aprovador da alçada correta aprova (200)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    const created = await createPaymentAs(initiator.id, flow.id, 100000);
    const reqId = created.body.id;
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });
    const res = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({});
    expect(res.status).toBe(200);
  });

  it('etapa de alçada NUNCA atribui tarefa ao iniciador (mesmo sendo único do papel)', async () => {
    const initiator = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    const created = await createPaymentAs(initiator.id, flow.id);
    const reqId = created.body.id;
    // conclui etapa 0; advanceRequest cria as tarefas da etapa 1 (alçada)
    await prisma.requestTask.updateMany({ where: { requestId: reqId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const { advanceRequest } = await import('../src/services/workflow');
    await advanceRequest(reqId);
    const approvalTasks = await prisma.requestTask.findMany({ where: { requestId: reqId, step: { order: 1 } } });
    // Sem outro MANAGER/FINANCE/ADMIN no banco, NÃO deve haver tarefa (nunca o iniciador).
    expect(approvalTasks.every(t => t.assigneeId !== initiator.id)).toBe(true);
  });
});

describe('pagamentos — dupla decisão / replay', () => {
  beforeEach(resetDb);

  it('o mesmo aprovador não decide duas vezes a mesma etapa (409)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id, { amountCents: 100000 }));
    const reqId = created.body.id;
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });
    const first = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({});
    expect(first.status).toBe(200);
    // segunda decisão do mesmo aprovador na mesma etapa
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1, status: 'IN_PROGRESS' } });
    const second = await request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({});
    expect(second.status).toBe(409);
  });
});

describe('pagamentos — IDOR', () => {
  beforeEach(resetDb);

  it('USER não envolvido não lê pagamento alheio (403)', async () => {
    const initiator = await makeUser('USER');
    const intruso = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id));
    const reqId = created.body.id;
    expect((await request(app).get(`/api/requests/${reqId}`).set(auth(tokenFor(intruso.id)))).status).toBe(403);
    expect((await request(app).get(`/api/requests/${reqId}/attachments`).set(auth(tokenFor(intruso.id)))).status).toBe(403);
    expect((await request(app).get(`/api/requests/${reqId}/audit`).set(auth(tokenFor(intruso.id)))).status).toBe(403);
  });

  it('o iniciador lê a própria solicitação (200)', async () => {
    const initiator = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id));
    expect((await request(app).get(`/api/requests/${created.body.id}`).set(auth(tokenFor(initiator.id)))).status).toBe(200);
  });

  it('FINANCE (papel de visão ampla) lê qualquer pagamento (200)', async () => {
    const initiator = await makeUser('USER');
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id));
    expect((await request(app).get(`/api/requests/${created.body.id}`).set(auth(tokenFor(fin.id)))).status).toBe(200);
  });

  it('USER não envolvido não anexa em pagamento alheio (403)', async () => {
    const initiator = await makeUser('USER');
    const intruso = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id));
    const res = await request(app)
      .post(`/api/requests/${created.body.id}/attachments`)
      .set(auth(tokenFor(intruso.id)))
      .attach('files', Buffer.from('x'), 'doc.txt');
    expect(res.status).toBe(403);
  });
});

describe('pagamentos — autenticação obrigatória', () => {
  beforeEach(resetDb);

  it('sem token: rotas de pagamento retornam 401', async () => {
    const flow = await makePaymentFlow();
    expect((await request(app).post('/api/requests').send(validPayment(flow.id))).status).toBe(401);
    expect((await request(app).get('/api/payments/recurrences')).status).toBe(401);
  });

  it('token forjado (assinatura inválida) é rejeitado (401)', async () => {
    const bad = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.invalidsignature';
    expect((await request(app).get('/api/payments/recurrences').set(auth(bad))).status).toBe(401);
  });
});
