import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

type Tx = Prisma.TransactionClient;

type StepWithLevels = Prisma.FlowStepGetPayload<{ include: { authLevels: true } }>;

export interface StepAssignment {
  /** Role that should receive tasks for this step. */
  approverRole: string | null;
  /** Number of distinct approvals required to clear the step. */
  requiredApprovers: number;
  /** Deadline applied to created tasks. */
  deadlineHours: number | null;
}

/**
 * Resolves which authorization level applies to a step for a given amount.
 * Returns null when the step has no value-based levels.
 */
export function getApplicableLevel(step: StepWithLevels, amountCents: number) {
  if (!step.authLevels || step.authLevels.length === 0) return null;
  for (const level of step.authLevels) {
    const min = level.minValueCents ?? 0;
    const max = level.maxValueCents ?? Number.MAX_SAFE_INTEGER;
    if (amountCents >= min && amountCents <= max) return level;
  }
  // No band matched — fall back to the highest band as a safe default.
  return step.authLevels[step.authLevels.length - 1];
}

/**
 * Determines who must act on a step and how many approvals are required.
 *
 * Audit finding A1: when a step defines value-based authorization levels,
 * the matching level's `approverRole` and `requiredApprovers` drive the
 * assignment — not the step's static `requiredRole`.
 */
export function resolveStepAssignment(step: StepWithLevels, amountCents: number): StepAssignment {
  const level = getApplicableLevel(step, amountCents);
  if (level) {
    return {
      approverRole: level.approverRole,
      requiredApprovers: Math.max(1, level.requiredApprovers),
      deadlineHours: level.deadlineHours ?? step.deadlineHours ?? null,
    };
  }
  return {
    approverRole: step.requiredRole ?? null,
    requiredApprovers: Math.max(1, step.requiredApprovers),
    deadlineHours: step.deadlineHours ?? null,
  };
}

/**
 * Creates the tasks for a given step.
 *
 * Audit findings A1 / A2 / C3:
 *  - assignment follows the resolved authorization level's role (A1);
 *  - candidates are all holders of that role; the step clears with the
 *    required number of approvals (not "everyone must act") — see
 *    `isStepComplete` (A2);
 *  - the request initiator is NEVER assigned as an approver of their own
 *    request, enforcing four-eyes segregation of duties (C3).
 */
export async function createRequestTasks(
  tx: Tx,
  requestId: string,
  flowId: string,
  stepOrder: number
): Promise<void> {
  const flow = await tx.flowTemplate.findUnique({
    where: { id: flowId },
    include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
  });
  if (!flow) throw new Error('Fluxo não encontrado');

  const step = flow.steps.find((s) => s.order === stepOrder);
  if (!step) return;

  const request = await tx.request.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Solicitação não encontrada');

  const assignment = resolveStepAssignment(step, request.amountCents ?? 0);

  let assignees: { id: string; name: string }[] = [];
  if (assignment.approverRole) {
    assignees = await tx.user.findMany({
      where: {
        role: assignment.approverRole,
        isActive: true,
        id: { not: request.initiatorId }, // four-eyes: never the initiator
      },
      select: { id: true, name: true },
    });
  }

  // Fallback when no holder of the target role exists: route to ADMINs
  // (still excluding the initiator). We deliberately do NOT fall back to the
  // initiator, which would allow self-approval (audit finding C3).
  if (assignees.length === 0) {
    assignees = await tx.user.findMany({
      where: { role: 'ADMIN', isActive: true, id: { not: request.initiatorId } },
      select: { id: true, name: true },
    });
  }

  if (assignees.length === 0) {
    throw new Error(
      `Nenhum aprovador disponível para a etapa "${step.name}". ` +
        'Verifique a configuração de papéis do fluxo.'
    );
  }

  const dueDate = assignment.deadlineHours
    ? new Date(Date.now() + assignment.deadlineHours * 60 * 60 * 1000)
    : null;

  for (const assignee of assignees) {
    await tx.requestTask.create({
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

  await tx.auditLog.create({
    data: {
      requestId,
      userId: request.initiatorId,
      userName: 'Sistema',
      action: 'STEP_STARTED',
      details: `Etapa iniciada: ${step.name} (aprovadores necessários: ${assignment.requiredApprovers})`,
    },
  });
}

/**
 * A step is complete once the required number of distinct APPROVED decisions
 * has been recorded for it (audit finding A2 — "any N of M", not "all of N").
 * The `@@unique([requestId, approverId, stepOrder])` constraint guarantees one
 * approver cannot be counted twice (audit finding C4).
 */
export async function isStepComplete(
  tx: Tx,
  requestId: string,
  stepOrder: number
): Promise<boolean> {
  const request = await tx.request.findUnique({
    where: { id: requestId },
    include: {
      flow: {
        include: { steps: { where: { order: stepOrder }, include: { authLevels: true } } },
      },
    },
  });
  if (!request) return false;
  const step = request.flow.steps[0];
  if (!step) return false;

  const { requiredApprovers } = resolveStepAssignment(step, request.amountCents ?? 0);

  const approvedCount = await tx.approval.count({
    where: { requestId, stepOrder, decision: 'APPROVED' },
  });

  return approvedCount >= requiredApprovers;
}

/**
 * Advances a request past the current step when it is complete.
 *
 * Audit finding A3: the whole transition (close current step's open tasks,
 * bump the step pointer, create next-step tasks / mark complete) runs inside
 * the provided transaction so a partial failure cannot leave the request in an
 * inconsistent state. SQLite serializes writers, so re-counting completion
 * inside the transaction also closes the double-advance race.
 */
export async function advanceRequest(tx: Tx, requestId: string): Promise<void> {
  const request = await tx.request.findUnique({
    where: { id: requestId },
    include: { flow: { include: { steps: { orderBy: { order: 'asc' } } } } },
  });
  if (!request) throw new Error('Solicitação não encontrada');
  if (request.status === 'COMPLETED' || request.status === 'REJECTED') return;

  const complete = await isStepComplete(tx, requestId, request.currentStep);
  if (!complete) return;

  // Close any still-pending tasks of the step we are leaving.
  await tx.requestTask.updateMany({
    where: { requestId, step: { order: request.currentStep }, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  const nextStepOrder = request.currentStep + 1;
  const nextStep = request.flow.steps.find((s) => s.order === nextStepOrder);

  if (nextStep) {
    await tx.request.update({
      where: { id: requestId },
      data: { currentStep: nextStepOrder, status: 'IN_PROGRESS' },
    });
    await createRequestTasks(tx, requestId, request.flowId, nextStepOrder);
  } else {
    await tx.request.update({
      where: { id: requestId },
      data: { status: 'COMPLETED' },
    });
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
}

/**
 * Kicks off the first step of a freshly created request (audit finding A4).
 * Must be called inside the same transaction that creates the request.
 */
export async function startRequest(tx: Tx, requestId: string, flowId: string): Promise<void> {
  await tx.request.update({
    where: { id: requestId },
    data: { status: 'IN_PROGRESS', currentStep: 0 },
  });
  await createRequestTasks(tx, requestId, flowId, 0);
}

export { prisma };
