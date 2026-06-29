import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../src/lib/prisma';
import { resetDb, makeUser } from './factory';
import { createRequestTasks } from '../src/services/workflow';

// Wiring do Passo 12: uma etapa de fluxo PAYMENT com handlingSector = 'Financeiro'
// roteia por orçamento (decidePaymentRouting) — fila do Financeiro (Membro) quando
// dentro do teto e com saldo; Líder I do Financeiro caso contrário. Audita o motivo.

async function financeSectorWithPeople() {
  const fin = await prisma.sector.create({ data: { name: 'Financeiro' } });
  const lider = await makeUser('FINANCE', 'Líder Financeiro');
  const membro = await makeUser('FINANCEIRO', 'Membro Financeiro');
  await prisma.sectorMember.create({ data: { sectorId: fin.id, userId: lider.id, role: 'LIDER', level: 'LIDER_1' } });
  await prisma.sectorMember.create({ data: { sectorId: fin.id, userId: membro.id, role: 'MEMBRO', level: 'MEMBRO' } });
  return { fin, lider, membro };
}

async function paymentFlowRoutedTo(finSectorId: string) {
  const flow = await prisma.flowTemplate.create({ data: { name: 'PAY', type: 'PAYMENT', isActive: true } });
  await prisma.flowStep.create({
    data: { flowTemplateId: flow.id, order: 0, name: 'Processamento Financeiro', requiredRole: 'FINANCE', handlingSectorId: finSectorId },
  });
  return flow;
}

describe('roteamento financeiro de pagamento (decidePaymentRouting ligado)', () => {
  beforeEach(resetDb);

  it('dentro do teto e com saldo → fila do Financeiro (Membro)', async () => {
    const { membro, lider } = await financeSectorWithPeople();
    const reqSector = await prisma.sector.create({ data: { name: 'Comercial Interno' } });
    const initiator = await makeUser('USER');
    const now = new Date();
    const admin = await makeUser('ADMIN');
    await prisma.financeParam.create({
      data: { sectorId: reqSector.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, ceilingCents: 1000000, updatedById: admin.id },
    });
    const flow = await paymentFlowRoutedTo((await prisma.sector.findFirstOrThrow({ where: { name: 'Financeiro' } })).id);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, sectorId: reqSector.id, title: 'pag', status: 'IN_PROGRESS', currentStep: 0, amountCents: 50000 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks.some(t => t.assigneeId === membro.id)).toBe(true);
    expect(tasks.some(t => t.assigneeId === lider.id)).toBe(false); // há membro → não vai ao líder
    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'PAYMENT_ROUTED' } });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.details!).target).toBe('FINANCE_MEMBER');
  });

  it('sem teto cadastrado → Líder I do Financeiro', async () => {
    const { lider, membro } = await financeSectorWithPeople();
    const reqSector = await prisma.sector.create({ data: { name: 'Comercial Interno' } });
    const initiator = await makeUser('USER');
    const flow = await paymentFlowRoutedTo((await prisma.sector.findFirstOrThrow({ where: { name: 'Financeiro' } })).id);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, sectorId: reqSector.id, title: 'pag', status: 'IN_PROGRESS', currentStep: 0, amountCents: 50000 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks.length).toBe(1);
    expect(tasks[0].assigneeId).toBe(lider.id);
    expect(tasks.some(t => t.assigneeId === membro.id)).toBe(false);
    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'PAYMENT_ROUTED' } });
    expect(JSON.parse(audit!.details!).target).toBe('FINANCE_LEADER');
  });

  it('valor acima do teto → Líder I do Financeiro', async () => {
    const { lider } = await financeSectorWithPeople();
    const reqSector = await prisma.sector.create({ data: { name: 'Comercial Interno' } });
    const initiator = await makeUser('USER');
    const now = new Date();
    const admin = await makeUser('ADMIN');
    await prisma.financeParam.create({
      data: { sectorId: reqSector.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, ceilingCents: 100000, updatedById: admin.id },
    });
    const flow = await paymentFlowRoutedTo((await prisma.sector.findFirstOrThrow({ where: { name: 'Financeiro' } })).id);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, sectorId: reqSector.id, title: 'caro', status: 'IN_PROGRESS', currentStep: 0, amountCents: 999999 },
    });

    await createRequestTasks(req.id, flow.id, 0);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id } });
    expect(tasks[0].assigneeId).toBe(lider.id);
    const audit = await prisma.auditLog.findFirst({ where: { requestId: req.id, action: 'PAYMENT_ROUTED' } });
    expect(JSON.parse(audit!.details!).target).toBe('FINANCE_LEADER');
  });
});
