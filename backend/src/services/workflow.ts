import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { notify, notifyMany } from './notifications';
import { isFunctionRole, resolveQueueEligibles } from '../lib/queue';

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

// Rodada ATIVA de decisão de uma etapa. Reenvios após correção abrem nova rodada
// sem criar Approval, então a rodada ativa não é simplesmente o MAX(round) das
// aprovações: se a maior rodada já terminou em CORRECTION_REQUESTED (ou seja, foi
// devolvida e reenviada), a rodada ativa é MAX(round)+1. As decisões da etapa são
// sempre gravadas/contadas nesta rodada — decisões de rodadas anteriores não contam.
export async function activeRound(db: Db, requestId: string, stepOrder: number): Promise<number> {
  const approvals = await db.approval.findMany({
    where: { requestId, stepOrder },
    select: { round: true, decision: true },
  });
  if (approvals.length === 0) return 0;
  const maxRound = approvals.reduce((m, a) => Math.max(m, a.round), 0);
  const correctionAtMax = approvals.some(a => a.round === maxRound && a.decision === 'CORRECTION_REQUESTED');
  return correctionAtMax ? maxRound + 1 : maxRound;
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

    // Etapa de SUBMISSÃO/REQUISIÇÃO (o próprio iniciador executa a sua parte):
    // não tem alçada (authLevels) E o papel requerido é ausente ou o papel-base
    // 'USER' (catch-all). Antes, um requiredRole='USER' difundia a tarefa a TODOS
    // os usuários do papel (resíduo de IDOR de leitura) — agora a tarefa dessa
    // etapa recai SOMENTE no iniciador, sem broadcast indiscriminado.
    //
    // Etapas de APROVAÇÃO (com authLevels) ou de uma FUNÇÃO específica
    // (requiredRole ≠ 'USER', ex.: MANAGER/FINANCE/HR/TI/...) mantêm a segregação
    // de funções (SoD): atribuídas a TODOS os outros usuários do papel, EXCLUINDO
    // o iniciador; recai sobre o iniciador apenas quando ele é o único do papel.
    const initiator = await db.user.findUnique({
      where: { id: request.initiatorId },
      select: { id: true, name: true },
    });

    const hasAuthLevels = step.authLevels.length > 0;
    const isSelfSubmissionStep = !hasAuthLevels && (!step.requiredRole || step.requiredRole === 'USER');
    // Etapa de FUNÇÃO (fila): requiredRole ∈ FUNCTION_ROLES. A resolução por
    // hierarquia (MEMBRO→LÍDER II→LÍDER I; Diretoria = qualquer diretor) faz o
    // fan-out: cada elegível recebe a SUA tarefa PENDING e "assume" na própria
    // linha. Papéis legados (MANAGER/FINANCE/HR/USER) seguem o caminho atual.
    const isFunctionStep = isFunctionRole(step.requiredRole);

    let assignees: { id: string; name: string }[] = [];
    if (isSelfSubmissionStep) {
      // Submissão do iniciador: só o iniciador, sem difundir ao papel inteiro.
      if (initiator) assignees = [initiator];
    } else if (isFunctionStep) {
      // Fila de função: já inclui fallback hierárquico e fallback ao iniciador.
      assignees = await resolveQueueEligibles(db, step, request.initiatorId);
    } else {
      if (step.requiredRole) {
        assignees = await db.user.findMany({
          where: { role: step.requiredRole, isActive: true, id: { not: request.initiatorId } },
          select: { id: true, name: true },
        });
      }
      // Sem outros do papel (ou etapa sem papel): recai sobre o iniciador.
      if (assignees.length === 0 && initiator) {
        assignees = [initiator];
      }
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
      // Notifica o responsável sobre a nova tarefa (exceto o próprio iniciador).
      // Em etapas de fila, o texto sinaliza que é preciso ASSUMIR para trabalhar.
      if (assignee.id !== request.initiatorId) {
        const body = isFunctionStep
          ? `Tarefa na fila — assuma para trabalhar em "${request.title}": ${step.name}.`
          : `Você tem uma tarefa em "${request.title}": ${step.name}.`;
        await notify(db, { userId: assignee.id, type: 'TASK_ASSIGNED', title: 'Nova tarefa atribuída', body, requestId });
      }
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
              members: { where: { level: 'LIDER_1' }, include: { user: { select: { id: true, name: true } } } },
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

// ===========================================================================
// Escalonamento temporal (Fase 0 · Passo 11)
//
// Independente do SLA por prazo (dueDate), o escalonamento dispara por IDADE da
// tarefa (dias desde createdAt), em três estágios de severidade crescente:
//   Estágio 1 (≥ day1, padrão 2 dias): lembra o responsável.
//   Estágio 2 (≥ day2, padrão 3 dias): aciona o Líder I do setor + o responsável.
//   Estágio 3 (≥ day3, padrão 7 dias): transfere ao Líder I (se houver), marca
//     slaEscalated e notifica responsável anterior + líder + iniciador.
// A cadência é configurável por etapa via FlowStep.escalationDay1/2/3 (overrides).
// A guarda escalationStage < N garante idempotência. Cada execução dispara
// no máximo UM estágio (o mais severo ainda não disparado).
// ===========================================================================

const DIA_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ESCALATION_DAYS = { d1: 2, d2: 3, d3: 7 } as const;

// Resolve o Líder I do setor que trata a etapa (hierarquia Fase 0: level
// 'LIDER_1', NÃO o papel legado role 'LIDER'). Retorna null se não houver.
async function resolveStepLeader(
  handlingSectorId: string | null | undefined
): Promise<{ id: string; name: string } | null> {
  if (!handlingSectorId) return null;
  const leader = await prisma.sectorMember.findFirst({
    where: { sectorId: handlingSectorId, level: 'LIDER_1' },
    include: { user: { select: { id: true, name: true } } },
  });
  return leader ? { id: leader.user.id, name: leader.user.name } : null;
}

// Sufixo com a justificativa de atraso, quando registrada — anexado ao corpo das
// notificações dos estágios 1 e 2 para dar contexto a quem é acionado.
function justificationSuffix(justification: string | null | undefined): string {
  return justification ? ` Justificativa do atraso: "${justification}".` : '';
}

interface EscalationTask {
  id: string;
  requestId: string;
  title: string;
  assigneeId: string;
  escalationStage: number;
  delayJustification: string | null;
  assignee: { id: string; name: string };
  request: { id: string; title: string; initiator: { id: string; name: string } };
  step: {
    escalationDay1: number | null;
    escalationDay2: number | null;
    escalationDay3: number | null;
    handlingSectorId: string | null;
  };
}

// Estágio 1: lembra o responsável (TASK_DELAY_REMINDER). Idempotente via guarda
// escalationStage < 1 no updateMany dentro da transação.
async function applyStage1(task: EscalationTask): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const upd = await tx.requestTask.updateMany({
      where: { id: task.id, escalationStage: { lt: 1 } },
      data: { escalationStage: 1 },
    });
    if (upd.count === 0) return false;
    await notify(tx, {
      userId: task.assigneeId,
      type: 'TASK_DELAY_REMINDER',
      title: 'Tarefa atrasada — lembrete',
      body: `A tarefa "${task.title}" em "${task.request.title}" está atrasada.` + justificationSuffix(task.delayJustification),
      requestId: task.requestId,
    });
    await tx.auditLog.create({
      data: {
        requestId: task.requestId, userId: 'system', userName: 'Sistema',
        action: 'ESCALATION_STAGE_1',
        details: `Escalonamento estágio 1 — lembrete ao responsável ${task.assignee.name} sobre a tarefa "${task.title}"`,
      },
    });
    return true;
  });
}

// Estágio 2: aciona o Líder I do setor + o responsável. Sem líder, notifica só o
// responsável. Idempotente via guarda escalationStage < 2.
async function applyStage2(task: EscalationTask): Promise<boolean> {
  const leader = await resolveStepLeader(task.step.handlingSectorId);
  return prisma.$transaction(async (tx) => {
    const upd = await tx.requestTask.updateMany({
      where: { id: task.id, escalationStage: { lt: 2 } },
      data: { escalationStage: 2 },
    });
    if (upd.count === 0) return false;
    const suffix = justificationSuffix(task.delayJustification);
    if (leader) {
      await notify(tx, {
        userId: leader.id,
        type: 'TASK_ESCALATED_TO_LEADER',
        title: 'Tarefa escalonada à liderança',
        body: `A tarefa "${task.title}" em "${task.request.title}" segue atrasada com ${task.assignee.name}.` + suffix,
        requestId: task.requestId,
      });
    }
    await notify(tx, {
      userId: task.assigneeId,
      type: 'TASK_DELAY_REMINDER',
      title: 'Tarefa atrasada — escalonada',
      body: `A tarefa "${task.title}" em "${task.request.title}" foi escalonada à liderança.` + suffix,
      requestId: task.requestId,
    });
    await tx.auditLog.create({
      data: {
        requestId: task.requestId, userId: 'system', userName: 'Sistema',
        action: 'ESCALATION_STAGE_2',
        details: leader
          ? `Escalonamento estágio 2 — acionado o líder ${leader.name} sobre a tarefa "${task.title}"`
          : `Escalonamento estágio 2 — sem líder no setor; responsável ${task.assignee.name} notificado sobre a tarefa "${task.title}"`,
      },
    });
    return true;
  });
}

// Estágio 3: transfere ao Líder I (se houver; senão mantém), marca slaEscalated,
// notifica responsável anterior + líder + iniciador. Retorna o novo assigneeId
// quando houve transferência (para o evento de workflow). Idempotente via guarda
// escalationStage < 3.
async function applyStage3(task: EscalationTask): Promise<{ applied: boolean; newAssigneeId: string | null }> {
  const leader = await resolveStepLeader(task.step.handlingSectorId);
  // Segregação de funções: NÃO transferir a tarefa ao próprio solicitante. Se o
  // único líder do setor for o iniciador, trata-se como "sem destino válido" —
  // o escalonamento ocorre (estágio 3, notificações), mas o responsável é mantido.
  const initiatorIsLeader = !!leader && leader.id === task.request.initiator.id;
  const effectiveLeader = initiatorIsLeader ? null : leader;
  const newAssigneeId = effectiveLeader ? effectiveLeader.id : task.assigneeId;
  const keepReason = initiatorIsLeader
    ? 'líder do setor é o próprio solicitante (segregação de funções)'
    : 'sem líder no setor';
  const applied = await prisma.$transaction(async (tx) => {
    const upd = await tx.requestTask.updateMany({
      where: { id: task.id, escalationStage: { lt: 3 } },
      data: { escalationStage: 3, slaEscalated: true, assigneeId: newAssigneeId },
    });
    if (upd.count === 0) return false;
    await tx.auditLog.create({
      data: {
        requestId: task.requestId, userId: 'system', userName: 'Sistema',
        action: 'ESCALATION_STAGE_3',
        details: effectiveLeader
          ? `Escalonamento estágio 3 — tarefa "${task.title}" transferida ao líder ${effectiveLeader.name}`
          : `Escalonamento estágio 3 — tarefa "${task.title}" mantida com ${task.assignee.name} (${keepReason})`,
      },
    });
    // Notifica responsável anterior, líder (se houver destino válido) e iniciador.
    const recipients = [task.assigneeId, task.request.initiator.id];
    if (effectiveLeader) recipients.push(effectiveLeader.id);
    await notifyMany(tx, recipients, {
      type: 'TASK_ESCALATED_TO_LEADER',
      title: 'Tarefa escalonada — transferida',
      body: effectiveLeader
        ? `A tarefa "${task.title}" em "${task.request.title}" foi transferida ao líder ${effectiveLeader.name} por atraso prolongado.`
        : `A tarefa "${task.title}" em "${task.request.title}" segue em atraso prolongado (${keepReason}).`,
      requestId: task.requestId,
    });
    return true;
  });
  return { applied, newAssigneeId: applied && effectiveLeader ? newAssigneeId : null };
}

// Varre as tarefas elegíveis e dispara o estágio mais severo ainda não disparado.
// `now` é injetável para tornar os testes determinísticos (sem timers reais).
// Retorna a quantidade de tarefas que tiveram algum estágio aplicado.
export async function processEscalations(now: Date = new Date()): Promise<number> {
  const tasks = (await prisma.requestTask.findMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      slaEscalated: false,
    },
    select: {
      id: true,
      requestId: true,
      title: true,
      assigneeId: true,
      escalationStage: true,
      delayJustification: true,
      createdAt: true,
      assignee: { select: { id: true, name: true } },
      request: { select: { id: true, title: true, initiator: { select: { id: true, name: true } } } },
      step: {
        select: { escalationDay1: true, escalationDay2: true, escalationDay3: true, handlingSectorId: true },
      },
    },
  })) as (EscalationTask & { createdAt: Date })[];

  let processed = 0;

  for (const task of tasks) {
    const ageDays = (now.getTime() - task.createdAt.getTime()) / DIA_MS;
    const d1 = task.step.escalationDay1 ?? DEFAULT_ESCALATION_DAYS.d1;
    const d2 = task.step.escalationDay2 ?? DEFAULT_ESCALATION_DAYS.d2;
    const d3 = task.step.escalationDay3 ?? DEFAULT_ESCALATION_DAYS.d3;

    // Dispara o estágio MAIS SEVERO ainda não disparado (um por execução).
    if (ageDays >= d3 && task.escalationStage < 3) {
      const { applied, newAssigneeId } = await applyStage3(task);
      if (applied) {
        await publishWorkflowEvent('TASK_ESCALATED', task.requestId, { stage: 3, newAssigneeId });
        processed++;
      }
    } else if (ageDays >= d2 && task.escalationStage < 2) {
      if (await applyStage2(task)) processed++;
    } else if (ageDays >= d1 && task.escalationStage < 1) {
      if (await applyStage1(task)) processed++;
    }
  }

  return processed;
}

// Avança a solicitação para a próxima etapa (ou conclui) de forma atômica.
// Toda a leitura de completude e a mutação correm dentro de uma única transação,
// e a atualização usa o currentStep atual como guarda otimista — se outra
// execução concorrente já avançou a etapa, esta sai sem efeito (evita avanço/
// duplicação de tarefas em cliques simultâneos).

// Define o status-alvo do inventário conforme o tipo de fluxo: admissão/compra
// alocam o recurso ao colaborador; desligamento devolve.
function targetResourceStatus(flowType: string): 'ALLOCATED' | 'RETURNED' | null {
  if (flowType === 'ONBOARDING' || flowType === 'PURCHASE') return 'ALLOCATED';
  if (flowType === 'OFFBOARDING') return 'RETURNED';
  return null;
}

// Aplica as transições de inventário da solicitação. Quando a etapa concluída
// é específica de setor (activateOnSectorId), transiciona apenas os recursos
// daquele setor; na conclusão final da solicitação, varre os recursos restantes.
async function applyResourceTransitions(
  request: { id: string; initiatorId: string; flow: { type: string; steps: { order: number; activateOnSectorId: string | null }[] } },
  completedStepOrder: number,
  isTerminal: boolean,
  db: Db,
) {
  const target = targetResourceStatus(request.flow.type);
  if (!target) return;

  const transition = async (where: any, scope: string) => {
    const matches = await db.requestResource.findMany({
      where: { ...where, requestId: request.id, status: { not: target } },
      select: { id: true, assetId: true, asset: { select: { status: true } } },
    });
    if (matches.length === 0) return;
    await db.requestResource.updateMany({ where: { id: { in: matches.map(m => m.id) } }, data: { status: target } });

    // Ponte com o inventário patrimonial: para as linhas vinculadas a uma unidade
    // física, reflete a alocação/devolução no Asset e grava o log imutável
    // (AssetMovement) vinculado à solicitação — na mesma transação.
    for (const m of matches) {
      if (!m.assetId) continue;
      const assetStatus = target === 'ALLOCATED' ? 'ATIVO' : 'DISPONIVEL';
      const movementType = target === 'ALLOCATED' ? 'ALOCACAO' : 'DEVOLUCAO';
      await db.asset.update({
        where: { id: m.assetId },
        data: target === 'ALLOCATED' ? { status: assetStatus } : { status: assetStatus, userId: null, departmentId: null },
      });
      await db.assetMovement.create({
        data: {
          assetId: m.assetId,
          type: movementType,
          previousStatus: m.asset?.status ?? null,
          newStatus: assetStatus,
          requestId: request.id,
          createdById: request.initiatorId,
          reason: target === 'ALLOCATED' ? 'Alocação automática pela conclusão do fluxo' : 'Devolução automática pela conclusão do fluxo',
        },
      });
    }

    await db.auditLog.create({
      data: {
        requestId: request.id,
        userId: request.initiatorId,
        userName: 'Sistema',
        action: target === 'ALLOCATED' ? 'RESOURCES_ALLOCATED' : 'RESOURCES_RETURNED',
        details: `${matches.length} recurso(s) ${target === 'ALLOCATED' ? 'alocado(s)' : 'devolvido(s)'} (${scope})`,
      },
    });
  };

  const sectorIds = request.flow.steps
    .filter(s => s.order === completedStepOrder && s.activateOnSectorId)
    .map(s => s.activateOnSectorId as string);

  if (sectorIds.length > 0) {
    await transition({ resourceItem: { sectorId: { in: sectorIds } } }, 'etapa de setor');
  }
  if (isTerminal) {
    await transition({}, 'conclusão do fluxo');
  }
}

export async function advanceRequest(requestId: string) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      include: { flow: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });
    if (!request) return;
    // AWAITING_CORRECTION não avança: o pedido voltou ao solicitante e só segue
    // após reenvio (resubmit), que restaura IN_PROGRESS na etapa de correção.
    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'AWAITING_CORRECTION'].includes(request.status)) return;

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
      // Fase 0 · Passo 10: busca o statusLabel da próxima etapa para denormalizar.
      const nextStep = request.flow.steps.find(s => s.order === nextStepOrder!);
      const nextStatusLabel = (nextStep as any)?.statusLabel ?? null;

      const upd = await tx.request.updateMany({
        where: { id: requestId, currentStep: request.currentStep },
        data: { currentStep: nextStepOrder!, status: 'IN_PROGRESS', statusLabel: nextStatusLabel },
      });
      if (upd.count === 0) return; // outra execução já avançou esta etapa
      await createRequestTasks(requestId, request.flowId, nextStepOrder!, tx);
      await applyResourceTransitions(request, request.currentStep, false, tx);
    } else {
      // Fase 0 · Passo 10: ao concluir, zeramos o statusLabel — o status de máquina
      // COMPLETED já comunica o estado; manter um rótulo de etapa seria enganoso.
      const upd = await tx.request.updateMany({
        where: { id: requestId, currentStep: request.currentStep, status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELLED'] } },
        data: { status: 'COMPLETED', statusLabel: null },
      });
      if (upd.count === 0) return;
      await applyResourceTransitions(request, request.currentStep, true, tx);
      await tx.auditLog.create({
        data: {
          requestId,
          userId: request.initiatorId,
          userName: 'Sistema',
          action: 'COMPLETED',
          details: 'Solicitação concluída com sucesso',
        },
      });
      await notify(tx, { userId: request.initiatorId, type: 'REQUEST_COMPLETED', title: 'Solicitação concluída', body: `Sua solicitação "${request.title}" foi concluída.`, requestId });
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

    // Tarefas CANCELLED (irmãs perdedoras de uma fila assumida/concluída) não
    // são COMPLETED e travariam a etapa — considerar apenas as NÃO-CANCELLED.
    const stepTasks = request.tasks.filter(t => t.stepId === step.id);
    const activeTasks = stepTasks.filter(t => t.status !== 'CANCELLED');
    if (activeTasks.length === 0) return false;
    if (!activeTasks.every(t => t.status === 'COMPLETED')) return false;

    if (step.authLevels.length > 0) {
      const amount = request.amountCents ?? 0;
      let required = 1;
      for (const lvl of step.authLevels) {
        const min = lvl.minValueCents ?? 0;
        const max = lvl.maxValueCents ?? Infinity;
        if (amount >= min && amount <= max) { required = lvl.requiredApprovers; break; }
      }
      // Conta apenas aprovações (decision=APPROVED) da RODADA ATIVA da etapa.
      // Decisões de rodadas anteriores (ex.: antes de uma correção/reenvio) e
      // decisões não-aprovadoras (CORRECTION_REQUESTED/FORWARDED) não contam.
      const round = await activeRound(db, requestId, stepOrder);
      const approved = new Set(
        request.approvals
          .filter(a => a.decision === 'APPROVED' && a.round === round)
          .map(a => a.approverId)
      ).size;
      if (approved < required) return false;
    }
  }

  return true;
}

// Ponto de integração futuro com o ERP (Sankhya): publica um evento de workflow
// ao fim de cada ação de aprovação. Hoje é NO-OP por desenho — quando a
// integração entrar (Passo futuro), aqui se enfileira o evento para o ERP.
// Mantém o contrato de chamada limpo desde já. Não lança: nunca deve quebrar a
// transação de negócio que a precede.
export async function publishWorkflowEvent(
  _type: string,
  _requestId: string,
  _payload?: Record<string, unknown>,
): Promise<void> {
  // intencionalmente vazio (no-op) até a integração com o ERP existir.
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
