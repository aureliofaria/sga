import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload, handleUpload } from '../middleware/upload';
import { createRequestTasks, advanceRequest, publishWorkflowEvent, activeRound } from '../services/workflow';
import { Prisma } from '@prisma/client';
import { canOpenRequestType } from '../lib/users';
import { APPROVER_ROLES } from '../config';
import { notify, notifyMany } from '../services/notifications';
import { parseCents } from '../lib/money';
import { validatePaymentRequest, isPaymentCategory } from '../lib/payments';
import { buildRequestWhere, canViewRequest } from '../lib/visibility';
import {
  SensitiveType,
  resolveViewerSensitiveAccess,
  maskFields,
  recordSensitiveAccess,
  maskDynamicFieldValues,
} from '../lib/fieldMasking';
import { validateFieldValue } from '../lib/fieldValidation';
import { isItemApplicable, evaluateApplicabilityInMemory, ApplicabilityContext } from '../lib/checklist';

const router = Router();

// ===== Mascaramento de campos sensíveis (LGPD) — Fase 0 · Passo 4 ===========
// Registro dos campos sensíveis de PRIMEIRA CLASSE da Request (colunas reais).
// VAZIO hoje: o schema atual não possui coluna estruturada de PII. Os valores
// sensíveis de formulário virão como campos dinâmicos no Passo 7 (FormField
// com flag de sensibilidade) e alimentarão o mascaramento por ali. Este
// registro cobre eventuais colunas futuras de 1ª classe — a costura já fica
// pronta e auditada, sendo hoje um no-op verificável em linhas reais.
const REQUEST_SENSITIVE_FIELDS: Partial<Record<string, SensitiveType>> = {};

// Função interna testável: aplica o mascaramento de um registro dado um
// registro de campos sensíveis e o conjunto de tipos liberados, devolvendo a
// cópia mascarada e a lista de campos revelados (para auditoria).
export function applyMaskWithRegistry<T extends Record<string, any>>(
  record: T,
  registry: Partial<Record<string, SensitiveType>>,
  allowed: Set<SensitiveType>
) {
  return maskFields(record, registry as Partial<Record<keyof T, SensitiveType>>, allowed);
}

// Serializa uma Request para o espectador: mascara os campos sensíveis de 1ª
// classe registrados, audita o que foi revelado e devolve a cópia mascarada.
// Com o registro vazio é um no-op (não muta, não audita).
// REF.3: aceita `allowed` opcional — o chamador resolve o acesso UMA vez e o
// injeta aqui e em maskDynamicFieldValues, evitando uma 2ª consulta de SectorMember.
export async function maskRequestForViewer<T extends { id: string }>(
  user: { id: string; name?: string | null; role?: string | null },
  request: T,
  db = prisma,
  allowed?: Set<SensitiveType>
): Promise<T> {
  const allow = allowed ?? (await resolveViewerSensitiveAccess(user, db));
  const { masked, revealed } = applyMaskWithRegistry(request, REQUEST_SENSITIVE_FIELDS, allow);
  await recordSensitiveAccess(db, { user, requestId: request.id, revealed });
  return masked;
}

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, search } = req.query as any;
    const user = req.user;
    // Escopo por setor/hierarquia (Fase 0 · Passo 3): substitui o filtro grosso
    // por papel. ADMIN/DIRETORIA veem tudo; Líder I vê o setor; Líder II vê seus
    // Membros; Membro vê só os próprios. Demais filtros compõem por cima.
    const where: any = await buildRequestWhere(user);
    if (status) where.status = status;
    if (type) where.flow = { type };
    if (search) where.title = { contains: search };

    const requests = await prisma.request.findMany({
      where,
      include: {
        flow: true,
        initiator: { select: { id: true, name: true, email: true } },
        _count: { select: { tasks: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitações' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: {
        flow: {
          include: {
            steps: {
              orderBy: { order: 'asc' },
              include: {
                authLevels: true,
                checklistItems: { orderBy: { order: 'asc' } },
              },
            },
          },
        },
        initiator: { select: { id: true, name: true, email: true, role: true } },
        tasks: {
          include: { assignee: { select: { id: true, name: true, email: true } }, step: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: { orderBy: { createdAt: 'desc' } },
        approvals: { include: { approver: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'desc' } },
        auditLogs: { orderBy: { createdAt: 'asc' } },
        resources: { include: { resourceItem: { include: { sector: { select: { id: true, name: true } } } }, asset: { include: { item: { select: { name: true } } } } } },
        fieldValues: { include: { field: true } },
        checklistItems: { include: { item: true } },
        // Subfluxo (Fase 0 · Passo 9): expõe os filhos vinculados com dados mínimos.
        children: { select: { id: true, title: true, status: true, flow: { select: { type: true } } } },
      },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canViewRequest(req.user, request))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    // REF.3: resolve o acesso sensível UMA vez e injeta nos dois mascaramentos
    // (campos de 1ª classe da Request + valores dinâmicos do Passo 7).
    const allowed = await resolveViewerSensitiveAccess(req.user, prisma);
    const masked = await maskRequestForViewer(req.user, request, prisma, allowed);
    masked.fieldValues = await maskDynamicFieldValues(req.user, request.fieldValues, prisma, allowed);

    // REF.1 — applicable computado no servidor (passo 8): carregamos UMA vez
    // os resourceItemIds e fieldValues da solicitação e avaliamos cada condição
    // EM MEMÓRIA (sem N+1). Incluímos os checklistItems de TODAS as etapas do
    // fluxo com seus estados (checked) e o booleano applicable para o frontend.
    // fieldValues como Map<key, Set<value>>: a mesma key pode existir em etapas
    // distintas (key é única só por etapa). Coletar TODOS os valores casa com a
    // semântica exists/any do gate (isItemApplicable) — sem divergência.
    const fieldValuesByKey = new Map<string, Set<string>>();
    for (const fv of request.fieldValues as any[]) {
      const key = fv.field.key as string;
      if (!fieldValuesByKey.has(key)) fieldValuesByKey.set(key, new Set<string>());
      fieldValuesByKey.get(key)!.add(fv.value as string);
    }
    const ctx: ApplicabilityContext = {
      resourceItemIds: new Set(request.resources.map((r) => r.resourceItemId)),
      fieldValues: fieldValuesByKey,
    };
    // Enriquece cada etapa com checklistItems anotados com applicable + checked.
    const stepsWithChecklist = (masked as any).flow.steps.map((step: any) => {
      const stateByItemId = new Map<string, boolean>(
        request.checklistItems
          .filter((rci) => rci.item.flowStepId === step.id)
          .map((rci) => [rci.itemId, rci.checked])
      );
      const items = evaluateApplicabilityInMemory(step.checklistItems ?? [] as any[], ctx).map((ci: any) => ({
        ...ci,
        checked: stateByItemId.get(ci.id) ?? false,
      }));
      return { ...step, checklistItems: items };
    });
    (masked as any).flow = { ...(masked as any).flow, steps: stepsWithChecklist };
    // Remove checklistItems da raiz (já estão dentro de cada etapa).
    delete (masked as any).checklistItems;

    res.json(masked);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { flowId, title, description, targetEmployee, targetDepartment, startDate,
            amountCents, supplier, costCenter, justification, vacancyType, replacementName,
            paymentCategory, resourceIds, parentRequestId } = req.body;
    if (!flowId || !title) { res.status(400).json({ error: 'Fluxo e título são obrigatórios' }); return; }
    const amount = parseCents(amountCents);
    if (!amount.ok) { res.status(400).json({ error: 'Valor (amountCents) inválido' }); return; }

    const flow = await prisma.flowTemplate.findUnique({ where: { id: flowId } });
    if (!flow) { res.status(404).json({ error: 'Fluxo não encontrado' }); return; }

    if (!canOpenRequestType(req.user, flow.type)) {
      res.status(403).json({ error: 'Você não tem permissão para abrir este tipo de solicitação' });
      return;
    }

    // Regras específicas de PAGAMENTO: categoria + campos obrigatórios + valor.
    // Os anexos exigidos são cobrados ao concluir a etapa de solicitação.
    let normalizedCategory: string | null = null;
    if (flow.type === 'PAYMENT') {
      const paymentError = validatePaymentRequest({
        paymentCategory, amountCents: amount.value, costCenter, justification, supplier,
      });
      if (paymentError) { res.status(400).json({ error: paymentError }); return; }
      normalizedCategory = paymentCategory;
    } else if (isPaymentCategory(paymentCategory)) {
      normalizedCategory = paymentCategory;
    }

    // Subfluxo: verifica o pai se informado (Fase 0 · Passo 9).
    let resolvedParentId: string | null = null;
    let parentRecord: any = null;
    if (parentRequestId) {
      parentRecord = await prisma.request.findUnique({
        where: { id: parentRequestId as string },
        select: {
          id: true,
          title: true,
          currentStep: true,
          initiatorId: true,
          tasks: { select: { assigneeId: true } },
          approvals: { select: { approverId: true } },
          flow: { select: { type: true } },
        },
      });
      if (!parentRecord) {
        res.status(404).json({ error: 'Solicitação pai não encontrada' }); return;
      }
      const canSee = await canViewRequest(req.user, parentRecord);
      if (!canSee) {
        res.status(403).json({ error: 'Sem acesso à solicitação pai' }); return;
      }
      resolvedParentId = parentRecord.id as string;
    }

    // Setor do pedido = primeira filiação do iniciador (denormalizado). Alimenta o
    // orçamento financeiro por setor (computeSectorBudget) e o roteamento de
    // pagamento (decidePaymentRouting). Null quando o iniciador não tem filiação.
    const initiatorMembership = await prisma.sectorMember.findFirst({
      where: { userId: req.user.id },
      select: { sectorId: true },
    });
    const initiatorSectorId = initiatorMembership?.sectorId ?? null;

    // Criação atômica: a solicitação, os recursos, a auditoria, o protocolo do
    // subfluxo no pai e as tarefas iniciais vivem na MESMA transação — evita
    // "solicitação fantasma" (criada mas sem tarefas/protocolo) se algo falhar
    // no meio. createRequestTasks aceita o cliente de transação.
    const request = await prisma.$transaction(async (tx) => {
      // Fase 0 · Passo 10: busca o statusLabel da etapa 0 ANTES de criar a Request
      // para incluir já na INSERT (não requer UPDATE separado).
      const step0 = await tx.flowStep.findFirst({
        where: { flowTemplateId: flowId, order: 0 },
        select: { statusLabel: true },
      });
      const initialStatusLabel = step0?.statusLabel ?? null;

      const created = await tx.request.create({
        data: {
          flowId,
          initiatorId: req.user.id,
          sectorId: initiatorSectorId,
          title,
          description,
          status: 'IN_PROGRESS',
          currentStep: 0,
          targetEmployee,
          targetDepartment,
          startDate,
          amountCents: amount.value,
          supplier,
          costCenter,
          justification,
          paymentCategory: normalizedCategory,
          vacancyType: vacancyType || null,
          replacementName: replacementName || null,
          parentRequestId: resolvedParentId,
          // Fase 0 · Passo 10: rótulo denormalizado da etapa inicial.
          statusLabel: initialStatusLabel,
        },
      });

      // Save selected resources
      if (Array.isArray(resourceIds) && resourceIds.length > 0) {
        for (const rid of resourceIds as string[]) {
          await tx.requestResource.upsert({
            where: { requestId_resourceItemId: { requestId: created.id, resourceItemId: rid } },
            update: {},
            create: { requestId: created.id, resourceItemId: rid },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          requestId: created.id,
          userId: req.user.id,
          userName: req.user.name,
          action: 'CREATED',
          details: `Solicitação criada: ${title}`,
        },
      });

      // Protocolo de retorno automático no pai (Fase 0 · Passo 9):
      // registra AuditLog + Comment no pai indicando abertura do subfluxo.
      if (resolvedParentId && parentRecord) {
        await tx.auditLog.create({
          data: {
            requestId: resolvedParentId,
            userId: req.user.id,
            userName: req.user.name,
            action: 'SUBFLOW_OPENED',
            details: JSON.stringify({ childId: created.id, childTitle: title, childType: flow.type }),
          },
        });
        await tx.comment.create({
          data: {
            requestId: resolvedParentId,
            stepOrder: parentRecord.currentStep as number,
            authorId: req.user.id,
            body: `Subfluxo aberto: "${title}" (protocolo ${created.id})`,
          },
        });
      }

      await createRequestTasks(created.id, flowId, 0, tx);
      return created;
    });

    const full = await prisma.request.findUnique({
      where: { id: request.id },
      include: {
        flow: true,
        initiator: { select: { id: true, name: true, email: true } },
        tasks: true,
        resources: { include: { resourceItem: { include: { sector: { select: { id: true, name: true } } } }, asset: { include: { item: { select: { name: true } } } } } },
      },
    });
    res.status(201).json(full);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar solicitação' });
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, targetEmployee, targetDepartment, startDate, amountCents, supplier, costCenter, justification } = req.body;
    const amount = parseCents(amountCents);
    if (!amount.ok) { res.status(400).json({ error: 'Valor (amountCents) inválido' }); return; }
    const request = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.initiatorId !== req.user.id && req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Acesso negado' }); return;
    }
    const updated = await prisma.request.update({
      where: { id: req.params.id },
      // Só altera o valor quando enviado no corpo; omitido não zera.
      data: { title, description, targetEmployee, targetDepartment, startDate, amountCents: 'amountCents' in req.body ? amount.value : undefined, supplier, costCenter, justification },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar solicitação' });
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const request = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.initiatorId !== req.user.id && req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Acesso negado' }); return;
    }
    await prisma.request.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    await prisma.auditLog.create({
      data: { requestId: req.params.id, userId: req.user.id, userName: req.user.name, action: 'CANCELLED', details: 'Solicitação cancelada pelo usuário' },
    });
    res.json({ message: 'Solicitação cancelada' });
  } catch {
    res.status(500).json({ error: 'Erro ao cancelar solicitação' });
  }
});

// ===========================================================================
// Ações de aprovação ricas (Fase 0 · Passo 5)
// DEFERIR · INDEFERIR · SOLICITAR CORREÇÃO · SOLICITAR INFORMAÇÃO · ENCAMINHAR
// + reenvio do solicitante (resubmit). As ações compartilham autorização (SoD/
// alçada/ADMIN + destino de encaminhamento) e correm em transação atômica.
// ===========================================================================

type DecisionAction = 'DEFER' | 'REJECT' | 'REQUEST_CORRECTION' | 'REQUEST_INFO' | 'FORWARD';

// Aceita cliente normal ou de transação.
type DbClient = Prisma.TransactionClient | typeof prisma;

// Verifica se o usuário tem autoridade para decidir a etapa atual.
// Regras: nunca o próprio solicitante (segregação de funções); ADMIN sempre pode;
// se a etapa tem alçada, o papel deve casar com o approverRole da faixa de valor;
// senão, qualquer papel de aprovador genérico. ADICIONALMENTE (REFINAMENTO 2):
// o destino de um ENCAMINHAMENTO ATIVO (Approval FORWARDED mais recente, na etapa
// e rodada correntes) é autorizado a decidir — por id (forwardedToId) ou por papel
// (forwardedToRole casando com user.role). A SoD permanece: o destino nunca pode
// ser o iniciador.
// Papéis ELEGÍVEIS como destino de um encaminhamento nesta etapa: a Diretoria
// (escalonamento para cima) e os papéis que efetivamente TÊM alçada na própria
// etapa. Fecha o furo de encaminhar a um papel sem alçada na faixa — que, de
// outro modo, ganharia poder de decisão indevido sobre a etapa.
function forwardEligibleRoles(step: any): Set<string> {
  const roles = new Set<string>(['DIRETORIA']);
  const authLevels = step?.authLevels ?? [];
  if (authLevels.length > 0) {
    for (const l of authLevels) if (l.approverRole) roles.add(l.approverRole);
  } else {
    for (const r of APPROVER_ROLES) roles.add(r as string);
  }
  return roles;
}

async function authorizeDecision(
  db: DbClient,
  request: { id: string; initiatorId: string; amountCents: number | null; currentStep: number; flow: { steps: any[] } },
  user: { id: string; role: string }
): Promise<{ ok: boolean; status: number; error: string }> {
  if (request.initiatorId === user.id) {
    return { ok: false, status: 403, error: 'O solicitante não pode decidir a própria solicitação' };
  }
  if (user.role === 'ADMIN') return { ok: true, status: 200, error: '' };

  const step = request.flow.steps.find((s: any) => s.order === request.currentStep);
  const authLevels = step?.authLevels ?? [];

  if (authLevels.length > 0) {
    const amount = request.amountCents ?? 0;
    const level =
      authLevels.find((l: any) => amount >= (l.minValueCents ?? 0) && amount <= (l.maxValueCents ?? Infinity)) ??
      authLevels[authLevels.length - 1];
    if (user.role === level.approverRole) return { ok: true, status: 200, error: '' };
    // Destino de encaminhamento ativo só decide se for papel elegível da etapa.
    if ((await isActiveForwardTarget(db, request, user)) && forwardEligibleRoles(step).has(user.role)) {
      return { ok: true, status: 200, error: '' };
    }
    return { ok: false, status: 403, error: 'Seu papel não tem alçada para aprovar esta etapa' };
  }

  if (APPROVER_ROLES.includes(user.role as any)) return { ok: true, status: 200, error: '' };
  if ((await isActiveForwardTarget(db, request, user)) && forwardEligibleRoles(step).has(user.role)) {
    return { ok: true, status: 200, error: '' };
  }
  return { ok: false, status: 403, error: 'Você não tem permissão para decidir esta solicitação' };
}

// O usuário é o destino do encaminhamento ATIVO da etapa+rodada correntes?
// Considera apenas o FORWARDED mais recente (último encaminhamento manda).
async function isActiveForwardTarget(
  db: DbClient,
  request: { id: string; currentStep: number },
  user: { id: string; role: string }
): Promise<boolean> {
  const round = await activeRound(db, request.id, request.currentStep);
  const lastForward = await db.approval.findFirst({
    where: { requestId: request.id, stepOrder: request.currentStep, round, decision: 'FORWARDED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!lastForward) return false;
  if (lastForward.forwardedToId && lastForward.forwardedToId === user.id) return true;
  if (lastForward.forwardedToRole && lastForward.forwardedToRole === user.role) return true;
  return false;
}

// Núcleo compartilhado por POST /:id/decision e pelos aliases /approve e /reject.
// Retorna { status, body } já pronto para a resposta HTTP.
async function handleDecision(
  reqUser: { id: string; name: string; role: string },
  requestId: string,
  action: DecisionAction,
  opts: { reason?: string; forwardToUserId?: string; forwardToRole?: string }
): Promise<{ status: number; body: any }> {
  const reason = opts.reason != null ? String(opts.reason).trim() : '';

  // Motivo obrigatório para todas as ações exceto DEFER.
  if (action !== 'DEFER' && !reason) {
    return { status: 400, body: { error: 'O motivo é obrigatório para esta ação' } };
  }

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { flow: { include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } } } },
  });
  if (!request) return { status: 404, body: { error: 'Solicitação não encontrada' } };

  // Estados terminais não aceitam decisão.
  if (['COMPLETED', 'REJECTED', 'CANCELLED'].includes(request.status)) {
    return { status: 409, body: { error: 'Solicitação não está em andamento' } };
  }
  // Pedido devolvido ao solicitante: o aprovador não age até o reenvio.
  if (request.status === 'AWAITING_CORRECTION') {
    return { status: 409, body: { error: 'Solicitação devolvida ao solicitante; aguardando reenvio' } };
  }

  const authz = await authorizeDecision(prisma, request, reqUser);
  if (!authz.ok) return { status: authz.status, body: { error: authz.error } };

  const step = request.currentStep;
  const round = await activeRound(prisma, requestId, step);
  // Ramo de devolução desta etapa: para qual order a correção devolve. Null →
  // devolve para a própria etapa (padrão Fase 0). Na trilha, etapas de decisão
  // usam 0 (volta ao solicitante na submissão).
  const currentStepDef = request.flow.steps.find((s) => s.order === step);
  const correctionReturnTo = currentStepDef?.returnStepOrder ?? step;

  // --- FORWARD: validações específicas do destino ---
  let forwardAssignees: { id: string; name: string }[] = [];
  if (action === 'FORWARD') {
    const hasUser = !!opts.forwardToUserId;
    const hasRole = !!opts.forwardToRole;
    if (hasUser === hasRole) {
      return { status: 400, body: { error: 'Encaminhamento exige exatamente um destino: forwardToUserId OU forwardToRole' } };
    }
    // Destino precisa ter alçada na etapa (ou ser a Diretoria): encaminhar não
    // pode conferir decisão a um papel sem alçada na faixa (escalonamento, não bypass).
    const eligible = forwardEligibleRoles(request.flow.steps.find((s: any) => s.order === step));
    if (hasUser) {
      if (opts.forwardToUserId === reqUser.id) {
        return { status: 400, body: { error: 'Não é possível encaminhar para si mesmo' } };
      }
      if (opts.forwardToUserId === request.initiatorId) {
        return { status: 403, body: { error: 'Não é possível encaminhar para o solicitante (segregação de funções)' } };
      }
      const target = await prisma.user.findUnique({ where: { id: opts.forwardToUserId } });
      if (!target || !target.isActive) {
        return { status: 400, body: { error: 'Destino do encaminhamento inválido' } };
      }
      if (!eligible.has(target.role)) {
        return { status: 403, body: { error: 'O destino não tem alçada para decidir esta etapa (encaminhe à Diretoria ou a um papel com alçada)' } };
      }
      // Destino não pode já ter APROVADO/ENCAMINHADO nesta etapa+rodada.
      const prior = await prisma.approval.findFirst({
        where: { requestId, stepOrder: step, round, approverId: target.id, decision: { in: ['APPROVED', 'FORWARDED'] } },
      });
      if (prior) {
        return { status: 400, body: { error: 'O destino já decidiu (aprovou/encaminhou) esta etapa' } };
      }
      forwardAssignees = [{ id: target.id, name: target.name }];
    } else {
      if (!eligible.has(opts.forwardToRole as string)) {
        return { status: 403, body: { error: 'O papel destino não tem alçada para decidir esta etapa (encaminhe à Diretoria ou a um papel com alçada)' } };
      }
      // Modelo de fila: todos os usuários ativos cujo papel casa, exceto o iniciador.
      const candidates = await prisma.user.findMany({
        where: { role: opts.forwardToRole, isActive: true, id: { not: request.initiatorId } },
        select: { id: true, name: true },
      });
      if (candidates.length === 0) {
        return { status: 400, body: { error: 'Nenhum usuário ativo com o papel informado para encaminhar' } };
      }
      forwardAssignees = candidates;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (action === 'DEFER') {
        await tx.approval.create({
          data: { requestId, approverId: reqUser.id, stepOrder: step, decision: 'APPROVED', comments: opts.reason || null, round },
        });
        await tx.auditLog.create({
          data: { requestId, userId: reqUser.id, userName: reqUser.name, action: 'APPROVED', details: reason ? `Aprovado com comentário: ${reason}` : 'Aprovado' },
        });
      } else if (action === 'REJECT') {
        await tx.approval.create({
          data: { requestId, approverId: reqUser.id, stepOrder: step, decision: 'REJECTED', comments: reason, round },
        });
        // Tarefas abertas da etapa são canceladas; pedido vira terminal REJECTED.
        await tx.requestTask.updateMany({
          where: { requestId, step: { order: step }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          data: { status: 'CANCELLED' },
        });
        await tx.request.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
        await tx.auditLog.create({
          data: { requestId, userId: reqUser.id, userName: reqUser.name, action: 'REJECTED', details: `Rejeitado: ${reason}` },
        });
        if (request.initiatorId !== reqUser.id) {
          await notify(tx, { userId: request.initiatorId, type: 'REQUEST_REJECTED', title: 'Solicitação rejeitada', body: `Sua solicitação "${request.title}" foi rejeitada: ${reason}`, requestId });
        }
      } else if (action === 'REQUEST_CORRECTION') {
        await tx.approval.create({
          data: { requestId, approverId: reqUser.id, stepOrder: step, decision: 'CORRECTION_REQUESTED', comments: reason, round },
        });
        await tx.requestTask.updateMany({
          where: { requestId, step: { order: step }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          data: { status: 'CANCELLED' },
        });
        await tx.comment.create({ data: { requestId, stepOrder: step, authorId: reqUser.id, body: reason } });
        await tx.request.update({ where: { id: requestId }, data: { status: 'AWAITING_CORRECTION', correctionReturnStep: correctionReturnTo } });
        await tx.auditLog.create({
          data: { requestId, userId: reqUser.id, userName: reqUser.name, action: 'CORRECTION_REQUESTED', details: `Correção solicitada: ${reason}` },
        });
        await notify(tx, { userId: request.initiatorId, type: 'REQUEST_CORRECTION_REQUESTED', title: 'Correção solicitada', body: `Sua solicitação "${request.title}" precisa de correção: ${reason}`, requestId });
      } else if (action === 'REQUEST_INFO') {
        // SEM Approval e SEM mudança de status/tarefas: a etapa segue com o aprovador.
        await tx.comment.create({ data: { requestId, stepOrder: step, authorId: reqUser.id, body: reason } });
        await tx.auditLog.create({
          data: { requestId, userId: reqUser.id, userName: reqUser.name, action: 'INFO_REQUESTED', details: `Informação solicitada: ${reason}` },
        });
        await notify(tx, { userId: request.initiatorId, type: 'REQUEST_INFO_REQUESTED', title: 'Informação solicitada', body: `O aprovador pediu informações em "${request.title}": ${reason}`, requestId });
      } else if (action === 'FORWARD') {
        await tx.approval.create({
          data: {
            requestId, approverId: reqUser.id, stepOrder: step, decision: 'FORWARDED', comments: reason, round,
            forwardedToId: opts.forwardToUserId ?? null,
            forwardedToRole: opts.forwardToRole ?? null,
          },
        });
        // A tarefa atual do aprovador é cancelada; cria-se tarefa DIRECIONADA ao(s)
        // destino(s) — explícita, não pela definição da etapa (REFINAMENTO 1).
        await tx.requestTask.updateMany({
          where: { requestId, step: { order: step }, assigneeId: reqUser.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          data: { status: 'CANCELLED' },
        });
        const stepDef = request.flow.steps.find((s: any) => s.order === step);
        const dueDate = stepDef?.deadlineHours ? new Date(Date.now() + stepDef.deadlineHours * 60 * 60 * 1000) : null;
        for (const dest of forwardAssignees) {
          await tx.requestTask.create({
            data: {
              requestId,
              stepId: stepDef.id,
              assigneeId: dest.id,
              title: `Apreciação encaminhada: ${stepDef?.name ?? 'etapa'}`,
              description: `Encaminhado por ${reqUser.name}. Motivo: ${reason}`,
              status: 'PENDING',
              dueDate,
            },
          });
          await notify(tx, { userId: dest.id, type: 'TASK_ASSIGNED', title: 'Apreciação encaminhada', body: `Você recebeu uma apreciação encaminhada em "${request.title}": ${reason}`, requestId });
        }
        await tx.auditLog.create({
          data: {
            requestId, userId: reqUser.id, userName: reqUser.name, action: 'FORWARDED',
            details: opts.forwardToUserId
              ? `Encaminhado ao usuário ${forwardAssignees[0]?.name}: ${reason}`
              : `Encaminhado ao papel ${opts.forwardToRole} (${forwardAssignees.length} destinatário(s)): ${reason}`,
          },
        });
        // Notifica o aprovador que encaminhou (confirmação).
        await notify(tx, { userId: reqUser.id, type: 'REQUEST_FORWARDED', title: 'Apreciação encaminhada', body: `Você encaminhou "${request.title}".`, requestId });
      }
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return { status: 409, body: { error: 'Você já decidiu esta etapa' } };
    throw e;
  }

  // Avanço só faz sentido em DEFER (as demais não avançam).
  if (action === 'DEFER') await advanceRequest(requestId);

  // Ponto de integração futuro com o ERP (no-op hoje).
  await publishWorkflowEvent(`DECISION_${action}`, requestId, { userId: reqUser.id });

  const updated = await prisma.request.findUnique({ where: { id: requestId } });
  return { status: 200, body: updated };
}

router.post('/:id/decision', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { action, reason, forwardToUserId, forwardToRole } = req.body as {
      action?: string; reason?: string; forwardToUserId?: string; forwardToRole?: string;
    };
    const valid: DecisionAction[] = ['DEFER', 'REJECT', 'REQUEST_CORRECTION', 'REQUEST_INFO', 'FORWARD'];
    if (!action || !valid.includes(action as DecisionAction)) {
      res.status(400).json({ error: 'Ação inválida' }); return;
    }
    const result = await handleDecision(req.user, req.params.id, action as DecisionAction, { reason, forwardToUserId, forwardToRole });
    res.status(result.status).json(result.body);
  } catch {
    res.status(500).json({ error: 'Erro ao registrar decisão' });
  }
});

// Aliases de compatibilidade — delegam ao núcleo handleDecision (DEFER/REJECT).
router.post('/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body;
    const result = await handleDecision(req.user, req.params.id, 'DEFER', { reason: comments });
    res.status(result.status).json(result.body);
  } catch {
    res.status(500).json({ error: 'Erro ao aprovar solicitação' });
  }
});

router.post('/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body;
    if (!comments || !String(comments).trim()) {
      res.status(400).json({ error: 'O motivo da rejeição é obrigatório' }); return;
    }
    const result = await handleDecision(req.user, req.params.id, 'REJECT', { reason: comments });
    if (result.status === 200) { res.json({ message: 'Solicitação rejeitada' }); return; }
    res.status(result.status).json(result.body);
  } catch {
    res.status(500).json({ error: 'Erro ao rejeitar solicitação' });
  }
});

// Reenvio do solicitante após SOLICITAR CORREÇÃO. Só o iniciador (ou ADMIN);
// exige status AWAITING_CORRECTION; abre nova rodada (round+1) na etapa de retorno,
// recria as tarefas da etapa (SoD/alçada restaurados naturalmente) e volta a
// IN_PROGRESS. Notifica os responsáveis da etapa recriada.
router.post('/:id/resubmit', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const request = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.initiatorId !== req.user.id && req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Apenas o solicitante pode reenviar' }); return;
    }
    if (request.status !== 'AWAITING_CORRECTION') {
      res.status(409).json({ error: 'Solicitação não está aguardando correção' }); return;
    }

    const returnStep = request.correctionReturnStep ?? request.currentStep;

    const RACE = Symbol('resubmit-race');
    try {
      await prisma.$transaction(async (tx) => {
        // Guard otimista contra reenvios concorrentes: só prossegue quem efetivar a
        // transição AWAITING_CORRECTION -> IN_PROGRESS. O perdedor da corrida (count 0)
        // aborta com 409 e não gera tarefas/auditoria duplicadas.
        const moved = await tx.request.updateMany({
          where: { id: request.id, status: 'AWAITING_CORRECTION' },
          data: { status: 'IN_PROGRESS', currentStep: returnStep, correctionReturnStep: null },
        });
        if (moved.count === 0) throw RACE;

        // Nova rodada = maior round da etapa de retorno + 1 (decisões antigas não contam).
        const round = await activeRound(tx, request.id, returnStep);
        const nextRound = round + 1;

        // Cancela tarefas residuais da etapa de retorno antes de recriar.
        await tx.requestTask.updateMany({
          where: { requestId: request.id, step: { order: returnStep }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          data: { status: 'CANCELLED' },
        });

        // Recria as tarefas da etapa de retorno (assignees pela definição da etapa).
        await createRequestTasks(request.id, request.flowId, returnStep, tx);

        await tx.auditLog.create({
          data: {
            requestId: request.id, userId: req.user.id, userName: req.user.name,
            action: 'RESUBMITTED',
            details: `Reenviado pelo solicitante (etapa ${returnStep}, rodada ${nextRound})`,
          },
        });
      });
    } catch (e) {
      if (e === RACE) { res.status(409).json({ error: 'Solicitação não está aguardando correção' }); return; }
      throw e;
    }

    await publishWorkflowEvent('RESUBMITTED', request.id, { userId: req.user.id });

    const updated = await prisma.request.findUnique({ where: { id: request.id } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao reenviar solicitação' });
  }
});

// ===========================================================================
// Gravação de valores de campos dinâmicos por etapa (Fase 0 · Passo 7).
// Body: { stepOrder, values: [{ fieldId, value }] }. Autorização: ADMIN ou
// quem é assignee de uma tarefa da etapa (status PENDING/IN_PROGRESS). Cada
// valor é validado por tipo (tolerante — REF.2) e gravado via upsert
// (@@unique[requestId,fieldId]). Valor de campo com `sensitiveType` setado gera
// AuditLog 'SENSITIVE_FIELD_WRITTEN'. O valor é armazenado como enviado (trim).
// ===========================================================================
router.post('/:id/fields', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { stepOrder, values } = req.body as { stepOrder?: number; values?: Array<{ fieldId?: string; value?: unknown }> };
    if (typeof stepOrder !== 'number') { res.status(400).json({ error: 'stepOrder é obrigatório' }); return; }
    if (!Array.isArray(values) || values.length === 0) { res.status(400).json({ error: 'values deve ser um array não vazio' }); return; }

    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { steps: { where: { order: stepOrder }, include: { formFields: true } } } } },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }

    const step = request.flow.steps[0];
    if (!step) { res.status(404).json({ error: 'Etapa não encontrada' }); return; }

    // Autorização: ADMIN ou assignee de uma tarefa ABERTA (PENDING/IN_PROGRESS)
    // daquela etapa. Tarefa concluída/cancelada não concede acesso de escrita.
    if (req.user.role !== 'ADMIN') {
      const openTask = await prisma.requestTask.count({
        where: { requestId: request.id, assigneeId: req.user.id, stepId: step.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      });
      if (openTask === 0) { res.status(403).json({ error: 'Acesso negado: você não tem tarefa aberta nesta etapa' }); return; }
    }

    // Mapa fieldId -> FormField (só campos DESTA etapa são aceitos).
    const fieldsById = new Map(step.formFields.map((f) => [f.id, f]));

    // Pré-valida tudo ANTES de gravar (transação tudo-ou-nada).
    const prepared: Array<{ fieldId: string; value: string; sensitiveType: string | null; key: string }> = [];
    for (const item of values) {
      if (!item || typeof item.fieldId !== 'string') { res.status(400).json({ error: 'Cada valor exige fieldId' }); return; }
      const field = fieldsById.get(item.fieldId);
      if (!field) { res.status(400).json({ error: `Campo ${item.fieldId} não pertence a esta etapa` }); return; }
      const value = item.value == null ? '' : String(item.value).trim();
      const check = validateFieldValue(field.type, value);
      if (!check.ok) { res.status(400).json({ error: `Campo "${field.label}": ${check.error}` }); return; }
      prepared.push({ fieldId: field.id, value, sensitiveType: field.sensitiveType, key: field.key });
    }

    await prisma.$transaction(async (tx) => {
      for (const p of prepared) {
        await tx.requestFieldValue.upsert({
          where: { requestId_fieldId: { requestId: request.id, fieldId: p.fieldId } },
          update: { value: p.value },
          create: { requestId: request.id, fieldId: p.fieldId, value: p.value },
        });
        // Gravação de valor de campo sensível: registra auditoria LGPD (sem o valor).
        if (p.sensitiveType) {
          await tx.auditLog.create({
            data: {
              requestId: request.id,
              userId: req.user.id,
              userName: req.user.name,
              action: 'SENSITIVE_FIELD_WRITTEN',
              details: JSON.stringify({ field: p.key, type: p.sensitiveType }),
            },
          });
        }
      }
    });

    // Não ecoa os VALORES na resposta de gravação: PII (CPF/RG/salário...) só é
    // serializada pelo motor de máscara no GET /:id. Devolve apenas a confirmação
    // e os fieldIds gravados (consistência LGPD; sem rota fora do mascaramento).
    res.json({ ok: true, count: prepared.length, savedFieldIds: prepared.map((p) => p.fieldId) });
  } catch {
    res.status(500).json({ error: 'Erro ao gravar valores de campos' });
  }
});

// ===========================================================================
// Marcar/desmarcar item de checklist (Fase 0 · Passo 8).
// Body: { checked: boolean }. Autorização: ADMIN ou assignee de tarefa
// PENDING/IN_PROGRESS na etapa do item (mesmo padrão do POST /:id/fields).
// ===========================================================================
router.post('/:id/checklist/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { checked } = req.body as { checked?: boolean };
    if (typeof checked !== 'boolean') {
      res.status(400).json({ error: 'checked (boolean) é obrigatório' }); return;
    }

    // Carrega o item de checklist.
    const item = await prisma.checklistItem.findUnique({
      where: { id: req.params.itemId },
      include: { flowStep: { select: { id: true, flowTemplateId: true } } },
    });
    if (!item) { res.status(404).json({ error: 'Item de checklist não encontrado' }); return; }

    // Carrega a solicitação (para verificar o flowId).
    const requestRecord = await prisma.request.findUnique({
      where: { id: req.params.id },
      select: { id: true, flowId: true },
    });
    if (!requestRecord) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }

    // Valida que o item pertence a uma etapa do fluxo desta solicitação.
    if (item.flowStep.flowTemplateId !== requestRecord.flowId) {
      res.status(400).json({ error: 'Item de checklist não pertence ao fluxo desta solicitação' }); return;
    }

    // Valida aplicabilidade.
    const applicable = await isItemApplicable(item, req.params.id);
    if (!applicable) {
      res.status(400).json({ error: 'Este item de checklist não se aplica a esta solicitação' }); return;
    }

    // Autorização: ADMIN ou assignee de tarefa PENDING/IN_PROGRESS na etapa do item.
    if (req.user.role !== 'ADMIN') {
      const openTask = await prisma.requestTask.count({
        where: {
          requestId: req.params.id,
          assigneeId: req.user.id,
          stepId: item.flowStepId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      });
      if (openTask === 0) {
        res.status(403).json({ error: 'Acesso negado: você não tem tarefa aberta nesta etapa' }); return;
      }
    }

    // Upsert do estado.
    await prisma.requestChecklistItem.upsert({
      where: { requestId_itemId: { requestId: req.params.id, itemId: req.params.itemId } },
      update: {
        checked,
        checkedById: checked ? req.user.id : null,
        checkedAt: checked ? new Date() : null,
      },
      create: {
        requestId: req.params.id,
        itemId: req.params.itemId,
        checked,
        checkedById: checked ? req.user.id : null,
        checkedAt: checked ? new Date() : null,
      },
    });

    // AuditLog.
    await prisma.auditLog.create({
      data: {
        requestId: req.params.id,
        userId: req.user.id,
        userName: req.user.name,
        action: checked ? 'CHECKLIST_ITEM_CHECKED' : 'CHECKLIST_ITEM_UNCHECKED',
        details: JSON.stringify({ itemId: req.params.itemId, label: item.label }),
      },
    });

    res.json({ ok: true, checked, itemId: req.params.itemId });
  } catch {
    res.status(500).json({ error: 'Erro ao marcar item de checklist' });
  }
});

router.post('/:id/attachments', authenticate, handleUpload(upload.array('files', 10)), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }
    // IDOR: só envolvidos podem anexar a uma solicitação.
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canViewRequest(req.user, inv))) { res.status(403).json({ error: 'Acesso negado' }); return; }

    const attachments = await Promise.all(files.map((file) =>
      prisma.attachment.create({
        data: {
          requestId: req.params.id,
          fileName: file.filename,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          storagePath: file.path,
          uploadedBy: req.user.id,
        },
      })
    ));

    await prisma.auditLog.create({
      data: {
        requestId: req.params.id,
        userId: req.user.id,
        userName: req.user.name,
        action: 'ATTACHMENT_UPLOADED',
        details: `${files.length} arquivo(s) anexado(s)`,
      },
    });

    res.status(201).json(attachments);
  } catch {
    res.status(500).json({ error: 'Erro ao fazer upload de arquivo' });
  }
});

router.get('/:id/attachments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canViewRequest(req.user, inv))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const attachments = await prisma.attachment.findMany({
      where: { requestId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar anexos' });
  }
});

router.get('/:id/audit', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canViewRequest(req.user, inv))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const logs = await prisma.auditLog.findMany({
      where: { requestId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// Vincula (ou desvincula) uma unidade física do inventário a uma linha de
// recurso da solicitação — o cumprimento físico da intenção. A alocação/devolução
// efetiva do ativo ocorre na conclusão do fluxo (advanceRequest); aqui apenas
// registra-se a escolha e reserva-se a unidade para evitar dupla reserva.
router.post('/:id/resources/:resourceId/asset', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { assetId } = req.body as { assetId: string | null };
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { flow: { select: { type: true } } },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }

    // Só ADMIN ou quem tem uma tarefa EM ABERTO nesta solicitação (responsável
    // atual pelo atendimento) pode vincular — tarefa já concluída não dá acesso.
    if (req.user.role !== 'ADMIN') {
      const hasOpenTask = await prisma.requestTask.count({ where: { requestId: request.id, assigneeId: req.user.id, status: 'PENDING' } });
      if (hasOpenTask === 0) { res.status(403).json({ error: 'Acesso negado' }); return; }
    }

    const rr = await prisma.requestResource.findFirst({ where: { id: req.params.resourceId, requestId: request.id }, include: { asset: true } });
    if (!rr) { res.status(404).json({ error: 'Recurso da solicitação não encontrado' }); return; }

    const allocates = request.flow.type === 'ONBOARDING' || request.flow.type === 'PURCHASE';
    // Unidade anteriormente reservada por esta linha, a liberar em desvínculo OU
    // em troca de unidade (antes a liberação só ocorria no desvínculo, deixando o
    // ativo anterior preso em RESERVADO).
    const oldAssetId = rr.assetId && rr.assetId !== assetId ? rr.assetId : null;

    // Desvínculo.
    if (!assetId) {
      await prisma.$transaction(async (tx) => {
        if (rr.assetId) await tx.asset.updateMany({ where: { id: rr.assetId, status: 'RESERVADO' }, data: { status: 'DISPONIVEL' } });
        await tx.requestResource.update({ where: { id: rr.id }, data: { assetId: null } });
      });
      res.json({ ok: true }); return;
    }

    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || !asset.isActive) { res.status(400).json({ error: 'Ativo inválido' }); return; }

    if (allocates) {
      // Reserva ATÔMICA: só reserva se ainda estiver DISPONIVEL (evita corrida /
      // dupla reserva entre requisições concorrentes).
      const reserved = await prisma.asset.updateMany({ where: { id: assetId, status: 'DISPONIVEL' }, data: { status: 'RESERVADO' } });
      if (reserved.count === 0) { res.status(409).json({ error: 'Ativo não está disponível para alocação' }); return; }
    }
    // Para desligamento, vincula-se a unidade em uso, sem alterar o status agora
    // (a devolução acontece na conclusão do fluxo).

    const updated = await prisma.$transaction(async (tx) => {
      if (oldAssetId) await tx.asset.updateMany({ where: { id: oldAssetId, status: 'RESERVADO' }, data: { status: 'DISPONIVEL' } });
      return tx.requestResource.update({ where: { id: rr.id }, data: { assetId } });
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao vincular ativo ao recurso' });
  }
});

// ===== Comentários por etapa =====
// Carrega quem está envolvido na solicitação para o controle de acesso.
async function loadInvolvement(requestId: string) {
  return prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      initiatorId: true,
      tasks: { select: { assigneeId: true } },
      approvals: { select: { approverId: true } },
    },
  });
}

// Acesso a comentários: mesma semântica de escopo do detalhe do pedido.
function canAccessComments(user: AuthRequest['user'], inv: NonNullable<Awaited<ReturnType<typeof loadInvolvement>>>): Promise<boolean> {
  return canViewRequest(user, inv);
}

router.get('/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canAccessComments(req.user, inv))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const comments = await prisma.comment.findMany({
      where: { requestId: req.params.id },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar comentários' });
  }
});

router.post('/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { body, stepOrder } = req.body as { body?: string; stepOrder?: number | null };
    if (!body || !body.trim()) { res.status(400).json({ error: 'O comentário não pode ser vazio' }); return; }
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!(await canAccessComments(req.user, inv))) { res.status(403).json({ error: 'Acesso negado' }); return; }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { requestId: req.params.id, stepOrder: stepOrder ?? null, authorId: req.user.id, body: body.trim() },
        include: { author: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          requestId: req.params.id,
          userId: req.user.id,
          userName: req.user.name,
          action: 'COMMENT_ADDED',
          details: stepOrder != null ? `Comentário na etapa ${stepOrder}` : 'Comentário geral',
        },
      });
      // Notifica os envolvidos (iniciador, responsáveis, aprovadores), menos o autor.
      const recipients = [inv.initiatorId, ...inv.tasks.map((t) => t.assigneeId), ...inv.approvals.map((a) => a.approverId)];
      await notifyMany(tx, recipients, { type: 'COMMENT_ADDED', title: 'Novo comentário', body: `${req.user.name} comentou em "${inv.title}".`, requestId: req.params.id }, req.user.id);
      return created;
    });
    res.status(201).json(comment);
  } catch {
    res.status(500).json({ error: 'Erro ao adicionar comentário' });
  }
});

export default router;
