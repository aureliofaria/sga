import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { createRequestTasks, advanceRequest } from '../services/workflow';
import { canOpenRequestType } from '../lib/users';
import { APPROVER_ROLES } from '../config';
import { notify, notifyMany } from '../services/notifications';
import { parseCents } from '../lib/money';
import { validatePaymentRequest, isPaymentCategory } from '../lib/payments';

const router = Router();

// Carrega quem está envolvido em uma solicitação (iniciador, responsáveis de
// tarefa, aprovadores) e decide se o usuário pode VISUALIZAR/anexar.
// Papéis com visão ampla (ADMIN/MANAGER/FINANCE/HR) sempre podem — espelha a
// listagem GET /, que já expõe todas as solicitações a esses papéis.
const WIDE_VIEW_ROLES = ['ADMIN', 'MANAGER', 'FINANCE', 'HR'];

async function canAccessRequest(
  user: { id: string; role: string },
  requestId: string,
): Promise<boolean> {
  if (WIDE_VIEW_ROLES.includes(user.role)) return true;
  const inv = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      initiatorId: true,
      tasks: { select: { assigneeId: true } },
      approvals: { select: { approverId: true } },
    },
  });
  if (!inv) return false;
  return (
    inv.initiatorId === user.id ||
    inv.tasks.some((t) => t.assigneeId === user.id) ||
    inv.approvals.some((a) => a.approverId === user.id)
  );
}

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, search } = req.query as any;
    const user = req.user;
    const where: any = {};

    if (user.role !== 'ADMIN' && user.role !== 'MANAGER' && user.role !== 'FINANCE' && user.role !== 'HR') {
      where.initiatorId = user.id;
    }
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
        flow: { include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } } },
        initiator: { select: { id: true, name: true, email: true, role: true } },
        tasks: {
          include: { assignee: { select: { id: true, name: true, email: true } }, step: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: { orderBy: { createdAt: 'desc' } },
        approvals: { include: { approver: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'desc' } },
        auditLogs: { orderBy: { createdAt: 'asc' } },
        resources: { include: { resourceItem: { include: { sector: { select: { id: true, name: true } } } }, asset: { include: { item: { select: { name: true } } } } } },
      },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    // IDOR: só envolvidos (ou papéis de visão ampla) leem a solicitação.
    const involved =
      WIDE_VIEW_ROLES.includes(req.user.role) ||
      request.initiatorId === req.user.id ||
      request.tasks.some((t: any) => t.assignee?.id === req.user.id) ||
      request.approvals.some((a: any) => a.approver?.id === req.user.id);
    if (!involved) { res.status(403).json({ error: 'Acesso negado' }); return; }
    res.json(request);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { flowId, title, description, targetEmployee, targetDepartment, startDate,
            amountCents, supplier, costCenter, justification, vacancyType, replacementName,
            paymentCategory, resourceIds } = req.body;
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

    const request = await prisma.request.create({
      data: {
        flowId,
        initiatorId: req.user.id,
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
      },
    });

    // Save selected resources
    if (Array.isArray(resourceIds) && resourceIds.length > 0) {
      for (const rid of resourceIds as string[]) {
        await prisma.requestResource.upsert({
          where: { requestId_resourceItemId: { requestId: request.id, resourceItemId: rid } },
          update: {},
          create: { requestId: request.id, resourceItemId: rid },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        requestId: request.id,
        userId: req.user.id,
        userName: req.user.name,
        action: 'CREATED',
        details: `Solicitação criada: ${title}`,
      },
    });

    await createRequestTasks(request.id, flowId, 0);

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

// Verifica se o usuário tem autoridade para decidir (aprovar/rejeitar) a etapa atual.
// Regras: nunca o próprio solicitante (segregação de funções); ADMIN sempre pode;
// se a etapa tem alçada, o papel deve casar com o approverRole da faixa de valor;
// caso contrário, qualquer papel de aprovador genérico.
function authorizeDecision(
  request: { initiatorId: string; amountCents: number | null; currentStep: number; flow: { steps: any[] } },
  user: { id: string; role: string }
): { ok: boolean; status: number; error: string } {
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
    return { ok: false, status: 403, error: 'Seu papel não tem alçada para aprovar esta etapa' };
  }

  if (APPROVER_ROLES.includes(user.role as any)) return { ok: true, status: 200, error: '' };
  return { ok: false, status: 403, error: 'Você não tem permissão para decidir esta solicitação' };
}

router.post('/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body;
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } } } },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.status === 'COMPLETED' || request.status === 'REJECTED' || request.status === 'CANCELLED') {
      res.status(409).json({ error: 'Solicitação não está em andamento' }); return;
    }

    const authz = authorizeDecision(request, req.user);
    if (!authz.ok) { res.status(authz.status).json({ error: authz.error }); return; }

    try {
      await prisma.$transaction([
        prisma.approval.create({
          data: {
            requestId: req.params.id,
            approverId: req.user.id,
            stepOrder: request.currentStep,
            decision: 'APPROVED',
            comments,
          },
        }),
        prisma.auditLog.create({
          data: {
            requestId: req.params.id,
            userId: req.user.id,
            userName: req.user.name,
            action: 'APPROVED',
            details: comments ? `Aprovado com comentário: ${comments}` : 'Aprovado',
          },
        }),
      ]);
    } catch (e: any) {
      if (e?.code === 'P2002') { res.status(409).json({ error: 'Você já decidiu esta etapa' }); return; }
      throw e;
    }

    await advanceRequest(req.params.id);
    const updated = await prisma.request.findUnique({ where: { id: req.params.id } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao aprovar solicitação' });
  }
});

router.post('/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { comments } = req.body;
    // Rejeição exige motivo (rastreabilidade — toda recusa fica justificada).
    if (!comments || !String(comments).trim()) {
      res.status(400).json({ error: 'O motivo da rejeição é obrigatório' }); return;
    }
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { flow: { include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } } } },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.status === 'COMPLETED' || request.status === 'REJECTED' || request.status === 'CANCELLED') {
      res.status(409).json({ error: 'Solicitação não está em andamento' }); return;
    }

    const authz = authorizeDecision(request, req.user);
    if (!authz.ok) { res.status(authz.status).json({ error: authz.error }); return; }

    // Tudo numa transação: registro da decisão, mudança de status, auditoria e
    // notificação são atômicos — falha no meio não deixa estado inconsistente.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.approval.create({
          data: { requestId: req.params.id, approverId: req.user.id, stepOrder: request.currentStep, decision: 'REJECTED', comments },
        });
        await tx.request.update({ where: { id: req.params.id }, data: { status: 'REJECTED' } });
        await tx.auditLog.create({
          data: { requestId: req.params.id, userId: req.user.id, userName: req.user.name, action: 'REJECTED', details: `Rejeitado: ${comments}` },
        });
        if (request.initiatorId !== req.user.id) {
          await notify(tx, { userId: request.initiatorId, type: 'REQUEST_REJECTED', title: 'Solicitação rejeitada', body: `Sua solicitação "${request.title}" foi rejeitada: ${comments}`, requestId: req.params.id });
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') { res.status(409).json({ error: 'Você já decidiu esta etapa' }); return; }
      throw e;
    }

    res.json({ message: 'Solicitação rejeitada' });
  } catch {
    res.status(500).json({ error: 'Erro ao rejeitar solicitação' });
  }
});

router.post('/:id/attachments', authenticate, upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }
    // IDOR: só envolvidos podem anexar a uma solicitação.
    if (!(await canAccessRequest(req.user, req.params.id))) { res.status(403).json({ error: 'Acesso negado' }); return; }

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
    // IDOR: só envolvidos listam os anexos (metadados podem revelar dados sensíveis).
    if (!(await canAccessRequest(req.user, req.params.id))) { res.status(403).json({ error: 'Acesso negado' }); return; }
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
    // IDOR: a trilha de auditoria de uma solicitação só é vista por envolvidos.
    if (!(await canAccessRequest(req.user, req.params.id))) { res.status(403).json({ error: 'Acesso negado' }); return; }
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

function canAccessComments(user: AuthRequest['user'], inv: NonNullable<Awaited<ReturnType<typeof loadInvolvement>>>): boolean {
  if (user.role === 'ADMIN') return true;
  return (
    inv.initiatorId === user.id ||
    inv.tasks.some((t) => t.assigneeId === user.id) ||
    inv.approvals.some((a) => a.approverId === user.id)
  );
}

router.get('/:id/comments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const inv = await loadInvolvement(req.params.id);
    if (!inv) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (!canAccessComments(req.user, inv)) { res.status(403).json({ error: 'Acesso negado' }); return; }
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
    if (!canAccessComments(req.user, inv)) { res.status(403).json({ error: 'Acesso negado' }); return; }

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
