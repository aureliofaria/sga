import prisma from '../lib/prisma';
import { createRequestTasks } from './workflow';

// Avança uma data conforme a periodicidade da recorrência.
function computeNextRun(from: Date, unit: string, count: number): Date {
  const next = new Date(from);
  const step = count > 0 ? count : 1;
  if (unit === 'WEEK') {
    next.setDate(next.getDate() + 7 * step);
  } else {
    // MONTH (default)
    next.setMonth(next.getMonth() + step);
  }
  return next;
}

// Gera as solicitações de pagamento das recorrências vencidas (nextRunAt <= now).
// Idempotente sob concorrência: a marcação do próximo run usa guarda otimista
// (updateMany com nextRunAt atual) — se outra execução já processou, esta sai
// sem criar o pedido duplicado. Retorna o nº de pedidos criados.
export async function generateDueRecurrences(now: Date = new Date()): Promise<number> {
  const due = await prisma.paymentRecurrence.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
  });

  let created = 0;
  for (const rec of due) {
    const nextRunAt = computeNextRun(rec.nextRunAt, rec.intervalUnit, rec.intervalCount);

    // Guarda otimista: só avança se nextRunAt ainda for o valor que lemos.
    // Isso "reivindica" a janela atual de forma atômica antes de criar o pedido.
    const claimed = await prisma.paymentRecurrence.updateMany({
      where: { id: rec.id, nextRunAt: rec.nextRunAt, isActive: true },
      data: { nextRunAt, lastRunAt: now },
    });
    if (claimed.count === 0) continue; // outra execução já tratou esta janela

    const request = await prisma.request.create({
      data: {
        flowId: rec.flowId,
        initiatorId: rec.initiatorId,
        title: rec.title,
        status: 'IN_PROGRESS',
        currentStep: 0,
        amountCents: rec.amountCents,
        supplier: rec.supplier,
        costCenter: rec.costCenter,
        justification: rec.justification,
        paymentCategory: rec.paymentCategory,
        recurrenceId: rec.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        requestId: request.id,
        userId: rec.initiatorId,
        userName: 'Sistema (recorrência)',
        action: 'CREATED',
        details: `Solicitação gerada por recorrência: ${rec.title}`,
      },
    });
    await createRequestTasks(request.id, rec.flowId, 0);
    created++;
  }
  return created;
}

export { computeNextRun };
