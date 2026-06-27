import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { config } from '../src/config';
import { makeUser, resetDb, tokenFor } from './factory';
import { validatePaymentAmount, validatePaymentRequest } from '../src/lib/payments';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makePaymentFlow() {
  const flow = await prisma.flowTemplate.create({ data: { name: 'PAY', type: 'PAYMENT', isActive: true } });
  await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 0, name: 'Solicitação', requiredRole: 'USER', requiresAttachment: true } });
  const approval = await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 1, name: 'Aprovação', requiredRole: 'MANAGER' } });
  await prisma.authorizationLevel.create({ data: { flowStepId: approval.id, name: 'A', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER' } });
  return flow;
}

const validPayment = (flowId: string, over: Record<string, unknown> = {}) => ({
  flowId, title: 'Pagamento X', paymentCategory: 'COMPRA', amountCents: 100000,
  supplier: 'Fornecedor', costCenter: 'CC-1', justification: 'necessário', ...over,
});

describe('SEGURANÇA — valor / alçada (centavos inteiros, sem float)', () => {
  it('validatePaymentAmount rejeita zero, negativo, não-inteiro e overflow', () => {
    expect(validatePaymentAmount(0)).not.toBeNull();
    expect(validatePaymentAmount(-1)).not.toBeNull();
    expect(validatePaymentAmount(1.5)).not.toBeNull();
    expect(validatePaymentAmount(10_000_000_001)).not.toBeNull();
    expect(validatePaymentAmount(null)).not.toBeNull();
    expect(validatePaymentAmount(1)).toBeNull();
    expect(validatePaymentAmount(10_000_000_000)).toBeNull();
  });

  it('validatePaymentRequest exige categoria, valor>0, centro de custo e justificativa', () => {
    expect(validatePaymentRequest({ paymentCategory: 'XPTO', amountCents: 100, costCenter: 'c', justification: 'j', supplier: 's' })).not.toBeNull();
    expect(validatePaymentRequest({ paymentCategory: 'COMPRA', amountCents: 100, costCenter: '', justification: 'j', supplier: 's' })).not.toBeNull();
    expect(validatePaymentRequest({ paymentCategory: 'COMPRA', amountCents: 100, costCenter: 'c', justification: '', supplier: 's' })).not.toBeNull();
    expect(validatePaymentRequest({ paymentCategory: 'COMPRA', amountCents: 100, costCenter: 'c', justification: 'j', supplier: '' })).not.toBeNull();
    expect(validatePaymentRequest({ paymentCategory: 'COMPRA', amountCents: 100, costCenter: 'c', justification: 'j', supplier: 's' })).toBeNull();
    // REEMBOLSO não exige supplier
    expect(validatePaymentRequest({ paymentCategory: 'REEMBOLSO', amountCents: 100, costCenter: 'c', justification: 'j' })).toBeNull();
  });
});

describe('SEGURANÇA — JWT / sessão', () => {
  beforeEach(resetDb);

  it('rota de pagamento sem token: 401', async () => {
    expect((await request(app).get('/api/payments/recurrences')).status).toBe(401);
  });

  it('token expirado: 401', async () => {
    const user = await makeUser('FINANCE');
    const expired = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: -10 });
    expect((await request(app).get('/api/payments/recurrences').set(auth(expired))).status).toBe(401);
  });

  it('token assinado com segredo errado (forjado): 401', async () => {
    const user = await makeUser('FINANCE');
    const forged = jwt.sign({ userId: user.id }, 'segredo-do-atacante');
    expect((await request(app).get('/api/payments/recurrences').set(auth(forged))).status).toBe(401);
  });

  it('token de usuário inativo: 401', async () => {
    const user = await makeUser('FINANCE');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await request(app).get('/api/payments/recurrences').set(auth(tokenFor(user.id)))).status).toBe(401);
  });
});

describe('SEGURANÇA — injeção e payloads malformados', () => {
  beforeEach(resetDb);

  it('campos de texto com aspas/; (SQL-injection-like) são tratados como dados literais', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const evil = "Robert'); DROP TABLE \"Request\";--";
    const res = await request(app).post('/api/requests').set(auth(tokenFor(user.id)))
      .send(validPayment(flow.id, { title: evil, justification: evil, supplier: evil }));
    expect(res.status).toBe(201);
    expect(res.body.title).toBe(evil); // armazenado como texto, não executado
    // a tabela continua existindo e consultável
    expect(await prisma.request.count()).toBe(1);
  });

  it('amountCents como objeto/array é rejeitado (400), não derruba o servidor', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { amountCents: { $gt: 0 } }))).status).toBe(400);
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id, { amountCents: [1, 2] }))).status).toBe(400);
  });

  it('flowId inexistente: 404 (não 500)', async () => {
    const user = await makeUser('USER');
    expect((await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment('nao-existe'))).status).toBe(404);
  });
});

describe('SEGURANÇA — anexos', () => {
  beforeEach(resetDb);

  async function ownPayment() {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id));
    return { user, reqId: created.body.id as string };
  }

  it('content-type perigoso (.exe / octet-stream) é recusado (400)', async () => {
    const { user, reqId } = await ownPayment();
    const res = await request(app).post(`/api/requests/${reqId}/attachments`).set(auth(tokenFor(user.id)))
      .attach('files', Buffer.from('MZ...'), { filename: 'malware.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
  });

  it('HTML/SVG (XSS armazenado) é recusado (400)', async () => {
    const { user, reqId } = await ownPayment();
    const res = await request(app).post(`/api/requests/${reqId}/attachments`).set(auth(tokenFor(user.id)))
      .attach('files', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
  });

  it('nome com path traversal: o arquivo salvo NÃO escapa o diretório (nome gerado)', async () => {
    const { user, reqId } = await ownPayment();
    const res = await request(app).post(`/api/requests/${reqId}/attachments`).set(auth(tokenFor(user.id)))
      .attach('files', Buffer.from('texto'), { filename: '../../../../etc/passwd.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    const att = res.body[0];
    // fileName (nome físico) é gerado e não contém separadores de caminho.
    expect(att.fileName).not.toContain('/');
    expect(att.fileName).not.toContain('..');
    // storagePath aponta para dentro de /uploads (não escapou)
    expect(att.storagePath).toContain('uploads');
  });

  it('anexo válido (pdf/txt) é aceito (201)', async () => {
    const { user, reqId } = await ownPayment();
    const res = await request(app).post(`/api/requests/${reqId}/attachments`).set(auth(tokenFor(user.id)))
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'nota.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
  });
});

describe('SEGURANÇA — etapa obrigatória de anexo (erro claro, sem estado inconsistente)', () => {
  beforeEach(resetDb);

  it('concluir a etapa de solicitação SEM anexo obrigatório é barrado (400) e a etapa não avança', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(user.id))).send(validPayment(flow.id));
    const reqId = created.body.id;
    const task = await prisma.requestTask.findFirstOrThrow({ where: { requestId: reqId } });
    const res = await request(app).post(`/api/tasks/${task.id}/complete`).set(auth(tokenFor(user.id))).send({});
    expect(res.status).toBe(400);
    // estado preservado: tarefa segue PENDENTE e a solicitação na etapa 0
    const after = await prisma.request.findUniqueOrThrow({ where: { id: reqId } });
    expect(after.currentStep).toBe(0);
    const t2 = await prisma.requestTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(t2.status).toBe('PENDING');
  });
});

describe('SEGURANÇA — replay / corrida de aprovação concorrente', () => {
  beforeEach(resetDb);

  it('duas aprovações concorrentes do MESMO aprovador: só uma vence (constraint única)', async () => {
    const initiator = await makeUser('USER');
    const manager = await makeUser('MANAGER');
    const flow = await makePaymentFlow();
    const created = await request(app).post('/api/requests').set(auth(tokenFor(initiator.id))).send(validPayment(flow.id, { amountCents: 100000 }));
    const reqId = created.body.id;
    await prisma.request.update({ where: { id: reqId }, data: { currentStep: 1 } });

    // dispara duas aprovações em paralelo
    const [a, b] = await Promise.all([
      request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({}),
      request(app).post(`/api/requests/${reqId}/approve`).set(auth(tokenFor(manager.id))).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    // uma 200 (ou ambas tratadas), mas NUNCA duas decisões persistidas
    const approvals = await prisma.approval.count({ where: { requestId: reqId, approverId: manager.id, stepOrder: 1 } });
    expect(approvals).toBe(1);
    // ao menos uma resposta foi sucesso e nenhuma foi 500
    expect(statuses.every((s) => s !== 500)).toBe(true);
  });
});
