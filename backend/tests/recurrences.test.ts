import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeUser, resetDb, tokenFor } from './factory';
import { generateDueRecurrences, computeNextRun } from '../src/services/recurrences';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makePaymentFlow() {
  const flow = await prisma.flowTemplate.create({ data: { name: 'PAY', type: 'PAYMENT', isActive: true } });
  await prisma.flowStep.create({ data: { flowTemplateId: flow.id, order: 0, name: 'Solicitação', requiredRole: 'USER', requiresAttachment: true } });
  return flow;
}

describe('recorrências de pagamento', () => {
  beforeEach(resetDb);

  it('computeNextRun avança mês e semana corretamente', () => {
    expect(computeNextRun(new Date('2026-01-31T00:00:00Z'), 'MONTH', 1).getUTCMonth()).toBe(2); // jan->fev (rolagem)
    expect(computeNextRun(new Date('2026-01-01T00:00:00Z'), 'WEEK', 2).getUTCDate()).toBe(15);
  });

  it('FINANCE cria recorrência (201)', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/payments/recurrences').set(auth(tokenFor(fin.id))).send({
      flowId: flow.id, title: 'Aluguel', paymentCategory: 'RECORRENCIA', amountCents: 500000,
      supplier: 'Imobiliária', costCenter: 'ADM-1', justification: 'aluguel mensal', intervalUnit: 'MONTH', intervalCount: 1,
    });
    expect(res.status).toBe(201);
  });

  it('USER comum não cria recorrência (403)', async () => {
    const user = await makeUser('USER');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/payments/recurrences').set(auth(tokenFor(user.id))).send({
      flowId: flow.id, title: 'X', paymentCategory: 'RECORRENCIA', amountCents: 1000, costCenter: 'C', justification: 'j',
    });
    expect(res.status).toBe(403);
  });

  it('recorrência rejeita valor inválido (400)', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    const res = await request(app).post('/api/payments/recurrences').set(auth(tokenFor(fin.id))).send({
      flowId: flow.id, title: 'X', paymentCategory: 'RECORRENCIA', amountCents: 0, costCenter: 'C', justification: 'j',
    });
    expect(res.status).toBe(400);
  });

  it('gera o pedido quando vencida e avança nextRunAt; não duplica na 2ª execução', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rec = await prisma.paymentRecurrence.create({
      data: { flowId: flow.id, initiatorId: fin.id, title: 'Aluguel', paymentCategory: 'RECORRENCIA', amountCents: 500000, costCenter: 'ADM-1', justification: 'j', intervalUnit: 'MONTH', intervalCount: 1, nextRunAt: past },
    });

    const created1 = await generateDueRecurrences();
    expect(created1).toBe(1);
    const reqs = await prisma.request.findMany({ where: { recurrenceId: rec.id } });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].paymentCategory).toBe('RECORRENCIA');
    expect(reqs[0].amountCents).toBe(500000);

    // 2ª execução: nextRunAt já foi avançado para o futuro, nada a gerar.
    const created2 = await generateDueRecurrences();
    expect(created2).toBe(0);
    expect(await prisma.request.count({ where: { recurrenceId: rec.id } })).toBe(1);
  });

  it('recorrência inativa não gera pedido', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    await prisma.paymentRecurrence.create({
      data: { flowId: flow.id, initiatorId: fin.id, title: 'X', paymentCategory: 'RECORRENCIA', amountCents: 1000, costCenter: 'C', justification: 'j', nextRunAt: new Date(Date.now() - 1000), isActive: false },
    });
    expect(await generateDueRecurrences()).toBe(0);
  });

  it('o pedido gerado segue o fluxo de aprovação (não pula alçada) — status IN_PROGRESS na etapa 0', async () => {
    const fin = await makeUser('FINANCE');
    const flow = await makePaymentFlow();
    const rec = await prisma.paymentRecurrence.create({
      data: { flowId: flow.id, initiatorId: fin.id, title: 'Aluguel', paymentCategory: 'RECORRENCIA', amountCents: 500000, costCenter: 'ADM-1', justification: 'j', nextRunAt: new Date(Date.now() - 1000) },
    });
    await generateDueRecurrences();
    const req = await prisma.request.findFirstOrThrow({ where: { recurrenceId: rec.id } });
    expect(req.status).toBe('IN_PROGRESS');
    expect(req.currentStep).toBe(0);
  });
});
