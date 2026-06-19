import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

// Aceita tanto o cliente normal quanto um cliente de transação, permitindo que as
// funções de workflow sejam compostas dentro de uma transação atômica.
type Db = Prisma.TransactionClient | typeof prisma;

interface BranchCondition {
  field: 'vacancyType' | 'amount' | 'always';
  op: 'EQUALS' | 'GT' | 'LT' | 'GTE' | 'LTE' | 'ALWAYS';
  value: string | null;
  targetOrder: number;
}

function parseConditions(json: string | null | undefined): BranchCondition[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function evaluateNextOrder(
  steps: Array<{ order: number; conditions: string | null }>,
  request: { vacancyType?: string | null; amountCents?: number | null }
): number | null {
  const conditions: BranchCondition[] = steps.flatMap(s => parseConditions(s.conditions));
  for (const cond of conditions) {
    if (cond.field === 'always' || cond.op === 'ALWAYS') return cond.targetOrder;
    if (cond.field === 'vacancyType' && cond.op === 'EQUALS' && request.vacancyType === cond.value) return cond.targetOrder;
    if (cond.field === 'amount' && request.amountCents != null) {
      const n = request.amountCents;
      // O valor da condição é informado em reais; converte para centavos.
      const v = Math.round(parseFloat(cond.value ?? '0') * 100);
      if (cond.op === 'GT' && n > v) return cond.targetOrder;
      if (cond.op === 'LT' && n < v) return cond.targetOrder;
      if (cond.op === 'GTE' && n >= v) return cond.targetOrder;
      if (cond.op === 'LTE' && n <= v) return cond.targetOrder;
      if (cond.op === 'EQUALS' && n === v) return cond.targetOrder;
    }
  }
  return null;
}

export async function createRequestTasks(requestId: string, flowId: string, stepOrder: number = 0, db: Db = prisma) {
  const [flow, resources, request] = await Promise.all([
    db.flowTemplate.findUnique({
      where: { id: flowId },
      include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
    }),
    db.requestResource.findMany({ where: { requestId }, include: { resourceItem: true } }),
    db.request.findUnique({ where: { id: requestId } }),
  ]);

  if (!flow || !request) throw new Error('Fluxo ou solicitação não encontrado');

  const steps = flow.steps.filter(s => s.order === stepOrder);
  if (steps.length === 0) return;

  let tasksCreated = 0;

  for (const step of steps) {
    // Activation condition: skip if request lacks resources from required sector
    if (step.activateOnSectorId) {
      const hasResource = resources.some(r => r.resourceItem.sectorId === step.activateOnSectorId);
      if (!hasResource) continue;
    }

    let assignees: { id: string; name: string }[] = [];
    if (step.requiredRole) {
      assignees = await db.user.findMany({
        where: { role: step.requiredRole, isActive: true, id: { not: request.initiatorId } },
        select: { id: true, name: true },
      });
    }
    if (assignees.length === 0) {
      const initiator = await db.user.findUnique({ where: { id: request.initiatorId }, select: { id: true, name: true } });
      if (initiator) assignees = [initiator];
    }

    const dueDate = step.deadlineHours ? new Date(Date.now() + step.deadlineHours * 60 * 60 * 1000) : null;

    for (const assignee of assignees) {
      await db.requestTask.create({
        data: {
          requestId,
          stepId: step.id,
          assigneeId: assignee.id,
          title: step.name,
          description: step.description,
          status: 'PENDING',
          dueDate,
        },
      });
      tasksCreated++;
    }
  }

  await db.auditLog.create({
    data: {
      requestId,
      userId: request.initiatorId,
      userName: 'Sistema',
      action: 'STEP_STARTED',
      details: `Etapa ${stepOrder} iniciada (${tasksCreated} tarefa(s) criada(s))`,
    },
  });
}

export async function processSlaExpiries(): Promise<number> {
  const now = new Date();
  const expiredTasks = await prisma.requestTask.findMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: now },
      slaEscalated: false,
    },
    include: {
      step: {
        include: {
          handlingSector: {
            include: {
              members: { where: { role: 'LIDER' }, include: { user: { select: { id: true, name: true } } } },
            },
          },
        },
      },
      request: { include: { initiator: { select: { id: true, name: true } } } },
      assignee: { select: { id: true, name: true } },
    },
  });

  for (const task of expiredTasks) {
    const expiry = task.step.slaExpiry;

    if (expiry === 'RETURN_TO_REQUESTER') {
      await prisma.requestTask.update({
        where: { id: task.id },
        data: { status: 'REJECTED', slaEscalated: true, notes: (task.notes ? task.notes + ' | ' : '') + 'SLA expirado — devolvido ao solicitante' },
      });
      await prisma.request.update({ where: { id: task.requestId }, data: { status: 'RETURNED' } });
      await prisma.auditLog.create({
        data: {
          requestId: task.requestId, userId: 'system', userName: 'Sistema',
          action: 'SLA_RETURNED',
          details: `SLA expirado. Tarefa "${task.title}" devolvida ao solicitante ${task.request.initiator.name}`,
        },
      });
    } else if (expiry === 'TRANSFER_TO_LEADER') {
      const leader = task.step.handlingSector?.members[0];
      await prisma.requestTask.update({
        where: { id: task.id },
        data: { assigneeId: leader ? leader.userId : task.assigneeId, slaEscalated: true },
      });
      await prisma.auditLog.create({
        data: {
          requestId: task.requestId, userId: 'system', userName: 'Sistema',
          action: 'SLA_ESCALATED',
          details: leader
            ? `SLA expirado. Tarefa "${task.title}" transferida ao líder ${leader.user.name}`
            : `SLA expirado. Tarefa "${task.title}" mantida (sem líder no setor)`,
        },
      });
    } else {
      await prisma.requestTask.update({ where: { id: task.id }, data: { slaEscalated: true } });
      await prisma.auditLog.create({
        data: {
          requestId: task.requestId, userId: 'system', userName: 'Sistema',
          action: 'SLA_EXPIRED',
          details: `SLA expirado. Tarefa "${task.title}" mantida com ${task.assignee.name}`,
        },
      });
    }
  }

  return expiredTasks.length;
}

// Avança a solicitação para a próxima etapa (ou conclui) de forma atômica.
// Toda a leitura de completude e a mutação correm dentro de uma única transação,
// e a atualização usa o currentStep atual como guarda otimista — se outra
// execução concorrente já avançou a etapa, esta sai sem efeito (evita avanço/
// duplicação de tarefas em cliques simultâneos).
export async function advanceRequest(requestId: string) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      include: { flow: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });
    if (!request) return;
    if (['COMPLETED', 'REJECTED', 'CANCELLED'].includes(request.status)) return;

    const complete = await isStepComplete(requestId, request.currentStep, tx);
    if (!complete) return;

    // Determine next order via branching conditions or sequential default
    const currentSteps = request.flow.steps.filter(s => s.order === request.currentStep);
    const conditionNextOrder = evaluateNextOrder(currentSteps, request);

    let nextStepOrder: number | null = conditionNextOrder;
    if (nextStepOrder === null) {
      const allOrders = [...new Set(request.flow.steps.map(s => s.order))].sort((a, b) => a - b);
      const currentIdx = allOrders.indexOf(request.currentStep);
      nextStepOrder = currentIdx < allOrders.length - 1 ? allOrders[currentIdx + 1] : null;
    }

    const hasNextStep = nextStepOrder !== null && request.flow.steps.some(s => s.order === nextStepOrder);

    if (hasNextStep) {
      const upd = await tx.request.updateMany({
        where: { id: requestId, currentStep: request.currentStep },
        data: { currentStep: nextStepOrder!, status: 'IN_PROGRESS' },
      });
      if (upd.count === 0) return; // outra execução já avançou esta etapa
      await createRequestTasks(requestId, request.flowId, nextStepOrder!, tx);
    } else {
      const upd = await tx.request.updateMany({
        where: { id: requestId, currentStep: request.currentStep, status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELLED'] } },
        data: { status: 'COMPLETED' },
      });
      if (upd.count === 0) return;
      await tx.auditLog.create({
        data: {
          requestId,
          userId: request.initiatorId,
          userName: 'Sistema',
          action: 'COMPLETED',
          details: 'Solicitação concluída com sucesso',
        },
      });
    }
  });
}

export async function isStepComplete(requestId: string, stepOrder: number, db: Db = prisma): Promise<boolean> {
  const [request, resources] = await Promise.all([
    db.request.findUnique({
      where: { id: requestId },
      include: {
        flow: { include: { steps: { where: { order: stepOrder }, include: { authLevels: true } } } },
        tasks: { where: { step: { order: stepOrder } } },
        approvals: { where: { stepOrder } },
      },
    }),
    db.requestResource.findMany({ where: { requestId }, include: { resourceItem: true } }),
  ]);

  if (!request) return false;

  for (const step of request.flow.steps) {
    // Step was conditionally skipped — count as complete
    if (step.activateOnSectorId) {
      const hasResource = resources.some(r => r.resourceItem.sectorId === step.activateOnSectorId);
      if (!hasResource) continue;
    }

    const stepTasks = request.tasks.filter(t => t.stepId === step.id);
    if (stepTasks.length === 0) return false;
    if (!stepTasks.every(t => t.status === 'COMPLETED')) return false;

    if (step.authLevels.length > 0) {
      const amount = request.amountCents ?? 0;
      let required = 1;
      for (const lvl of step.authLevels) {
        const min = lvl.minValueCents ?? 0;
        const max = lvl.maxValueCents ?? Infinity;
        if (amount >= min && amount <= max) { required = lvl.requiredApprovers; break; }
      }
      const approved = new Set(
        request.approvals.filter(a => a.decision === 'APPROVED').map(a => a.approverId)
      ).size;
      if (approved < required) return false;
    }
  }

  return true;
}

export async function checkAuthorizationLevel(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { flow: { include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } } } },
  });
  if (!request) return null;
  const currentStep = request.flow.steps.find(s => s.order === request.currentStep);
  if (!currentStep || currentStep.authLevels.length === 0) return null;
  const amount = request.amountCents ?? 0;
  for (const level of currentStep.authLevels) {
    const min = level.minValueCents ?? 0;
    const max = level.maxValueCents ?? Infinity;
    if (amount >= min && amount <= max) return level;
  }
  return currentStep.authLevels[currentStep.authLevels.length - 1];
}
