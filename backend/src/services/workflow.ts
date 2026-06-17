import prisma from '../lib/prisma';

export async function createRequestTasks(requestId: string, flowId: string, stepOrder: number = 0) {
  const flow = await prisma.flowTemplate.findUnique({
    where: { id: flowId },
    include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
  });
  if (!flow) throw new Error('Fluxo não encontrado');

  const step = flow.steps.find((s) => s.order === stepOrder);
  if (!step) return;

  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Solicitação não encontrada');

  // Find users with the required role for this step
  let assignees: { id: string; name: string }[] = [];
  if (step.requiredRole) {
    assignees = await prisma.user.findMany({
      where: { role: step.requiredRole, isActive: true },
      select: { id: true, name: true },
    });
  }

  // Fallback: assign to the initiator if no role-based assignees
  if (assignees.length === 0) {
    const initiator = await prisma.user.findUnique({ where: { id: request.initiatorId }, select: { id: true, name: true } });
    if (initiator) assignees = [initiator];
  }

  const dueDate = step.deadlineHours
    ? new Date(Date.now() + step.deadlineHours * 60 * 60 * 1000)
    : null;

  for (const assignee of assignees) {
    await prisma.requestTask.create({
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
  }

  await prisma.auditLog.create({
    data: {
      requestId,
      userId: request.initiatorId,
      userName: 'Sistema',
      action: 'STEP_STARTED',
      details: `Etapa iniciada: ${step.name}`,
    },
  });
}

export async function advanceRequest(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { flow: { include: { steps: { orderBy: { order: 'asc' } } } } },
  });
  if (!request) throw new Error('Solicitação não encontrada');

  const complete = await isStepComplete(requestId, request.currentStep);
  if (!complete) return;

  const nextStepOrder = request.currentStep + 1;
  const nextStep = request.flow.steps.find((s) => s.order === nextStepOrder);

  if (nextStep) {
    await prisma.request.update({
      where: { id: requestId },
      data: { currentStep: nextStepOrder, status: 'IN_PROGRESS' },
    });
    await createRequestTasks(requestId, request.flowId, nextStepOrder);
  } else {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: 'COMPLETED' },
    });
    await prisma.auditLog.create({
      data: {
        requestId,
        userId: request.initiatorId,
        userName: 'Sistema',
        action: 'COMPLETED',
        details: 'Solicitação concluída com sucesso',
      },
    });
  }
}

export async function checkAuthorizationLevel(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      flow: {
        include: {
          steps: { orderBy: { order: 'asc' }, include: { authLevels: true } },
        },
      },
    },
  });
  if (!request) return null;

  const currentStep = request.flow.steps.find((s) => s.order === request.currentStep);
  if (!currentStep || currentStep.authLevels.length === 0) return null;

  const amount = request.amount || 0;
  for (const level of currentStep.authLevels) {
    const min = level.minValue ?? 0;
    const max = level.maxValue ?? Infinity;
    if (amount >= min && amount <= max) {
      return level;
    }
  }
  return currentStep.authLevels[currentStep.authLevels.length - 1];
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
              members: {
                where: { role: 'LIDER' },
                include: { user: { select: { id: true, name: true } } },
              },
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
          requestId: task.requestId,
          userId: 'system',
          userName: 'Sistema',
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
          requestId: task.requestId,
          userId: 'system',
          userName: 'Sistema',
          action: 'SLA_ESCALATED',
          details: leader
            ? `SLA expirado. Tarefa "${task.title}" transferida ao líder ${leader.user.name}`
            : `SLA expirado. Tarefa "${task.title}" mantida (sem líder no setor)`,
        },
      });
    } else {
      // KEEP_WITH_RESPONSIBLE — just flag it
      await prisma.requestTask.update({ where: { id: task.id }, data: { slaEscalated: true } });
      await prisma.auditLog.create({
        data: {
          requestId: task.requestId,
          userId: 'system',
          userName: 'Sistema',
          action: 'SLA_EXPIRED',
          details: `SLA expirado. Tarefa "${task.title}" mantida com responsável ${task.assignee.name}`,
        },
      });
    }
  }

  return expiredTasks.length;
}

export async function isStepComplete(requestId: string, stepOrder: number): Promise<boolean> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      flow: {
        include: {
          steps: { where: { order: stepOrder }, include: { authLevels: true } },
        },
      },
      tasks: { where: { step: { order: stepOrder } } },
      approvals: { where: { stepOrder } },
    },
  });
  if (!request) return false;

  const step = request.flow.steps[0];
  if (!step) return false;

  // All tasks must be completed
  const allTasksDone = request.tasks.every((t) => t.status === 'COMPLETED');
  if (!allTasksDone) return false;

  // Check auth levels if any
  if (step.authLevels.length > 0) {
    const amount = request.amount || 0;
    let requiredApprovers = 1;
    for (const level of step.authLevels) {
      const min = level.minValue ?? 0;
      const max = level.maxValue ?? Infinity;
      if (amount >= min && amount <= max) {
        requiredApprovers = level.requiredApprovers;
        break;
      }
    }
    const approvedCount = request.approvals.filter((a) => a.decision === 'APPROVED').length;
    if (approvedCount < requiredApprovers) return false;
  }

  return true;
}
