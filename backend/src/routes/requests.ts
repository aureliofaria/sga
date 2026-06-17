import { Router, Request as ExpressRequest, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';
import { startRequest } from '../services/workflow';
import { notifyMany } from '../services/notifications';

const router = Router();

const createSchema = z.object({
  flowId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  // Money is exchanged as integer cents (audit finding M3).
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  supplier: z.string().optional(),
  costCenter: z.string().optional(),
  justification: z.string().optional(),
  targetEmployeeId: z.string().optional(),
  targetDepartmentId: z.string().optional(),
  startDate: z.coerce.date().optional(),
});

router.post('/', authenticate, validateBody(createSchema), async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const body = req.body as z.infer<typeof createSchema>;
  try {
    const flow = await prisma.flowTemplate.findUnique({ where: { id: body.flowId } });
    if (!flow || !flow.isActive) {
      res.status(400).json({ error: 'Fluxo inválido ou inativo' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.request.create({
        data: {
          flowId: body.flowId,
          initiatorId: user.id,
          title: body.title,
          description: body.description,
          status: 'PENDING',
          currentStep: 0,
          amountCents: body.amountCents,
          currency: body.currency || 'BRL',
          supplier: body.supplier,
          costCenter: body.costCenter,
          justification: body.justification,
          targetEmployeeId: body.targetEmployeeId,
          targetDepartmentId: body.targetDepartmentId,
          startDate: body.startDate,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: request.id,
          userId: user.id,
          userName: user.name,
          action: 'CREATED',
          details: `Solicitação criada: ${request.title}`,
        },
      });
      // Audit finding A4: start the first step as part of creation.
      await startRequest(tx, request.id, body.flowId);
      return tx.request.findUnique({
        where: { id: request.id },
        include: { tasks: true, flow: true },
      });
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Erro ao criar solicitação' });
  }
});

router.get('/', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const seesAll = ['ADMIN', 'DIRETOR'].includes(user.role);
    const where = seesAll
      ? {}
      : {
          OR: [
            { initiatorId: user.id },
            { tasks: { some: { assigneeId: user.id } } },
            { approvals: { some: { approverId: user.id } } },
          ],
        };
    const requests = await prisma.request.findMany({
      where,
      include: {
        initiator: { select: { id: true, name: true } },
        flow: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitações' });
  }
});

router.get('/:id', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: {
        initiator: { select: { id: true, name: true, email: true } },
        targetEmployee: { select: { id: true, name: true } },
        targetDepartment: { select: { id: true, name: true } },
        flow: { include: { steps: { orderBy: { order: 'asc' } } } },
        tasks: { include: { assignee: { select: { id: true, name: true } } } },
        approvals: { include: { approver: { select: { id: true, name: true } } } },
        attachments: true,
        comments: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }
    const seesAll = ['ADMIN', 'DIRETOR'].includes(user.role);
    const involved =
      request.initiatorId === user.id ||
      request.tasks.some((t) => t.assigneeId === user.id) ||
      request.approvals.some((a) => a.approverId === user.id);
    if (!seesAll && !involved) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
    res.json(request);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

router.post('/:id/cancel', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const request = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!request) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }
    const canCancel = request.initiatorId === user.id || ['ADMIN', 'DIRETOR'].includes(user.role);
    if (!canCancel) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
    if (['COMPLETED', 'REJECTED', 'CANCELLED'].includes(request.status)) {
      res.status(409).json({ error: 'Solicitação já finalizada' });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.requestTask.updateMany({
        where: { requestId: request.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await tx.request.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({
        data: {
          requestId: request.id,
          userId: user.id,
          userName: user.name,
          action: 'CANCELLED',
          details: 'Solicitação cancelada',
        },
      });
    });
    res.json({ message: 'Solicitação cancelada' });
  } catch {
    res.status(500).json({ error: 'Erro ao cancelar solicitação' });
  }
});

// --- Comentários por etapa (Prioridade 2 — Comunicação e Colaboração) ---

const commentSchema = z.object({
  body: z.string().trim().min(1, 'O comentário não pode ser vazio'),
  stepOrder: z.number().int().nonnegative().nullish(),
});

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

function canAccess(
  user: AuthRequest['user'],
  req: NonNullable<Awaited<ReturnType<typeof loadInvolvement>>>
): boolean {
  if (['ADMIN', 'DIRETOR'].includes(user.role)) return true;
  return (
    req.initiatorId === user.id ||
    req.tasks.some((t) => t.assigneeId === user.id) ||
    req.approvals.some((a) => a.approverId === user.id)
  );
}

router.get('/:id/comments', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const involvement = await loadInvolvement(req.params.id);
    if (!involvement) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }
    if (!canAccess(user, involvement)) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
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

router.post(
  '/:id/comments',
  authenticate,
  validateBody(commentSchema),
  async (req: ExpressRequest, res: Response) => {
    const { user } = req as AuthRequest;
    const { body, stepOrder } = req.body as z.infer<typeof commentSchema>;
    try {
      const involvement = await loadInvolvement(req.params.id);
      if (!involvement) {
        res.status(404).json({ error: 'Solicitação não encontrada' });
        return;
      }
      if (!canAccess(user, involvement)) {
        res.status(403).json({ error: 'Acesso negado' });
        return;
      }
      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.comment.create({
          data: {
            requestId: req.params.id,
            stepOrder: stepOrder ?? null,
            authorId: user.id,
            body,
          },
          include: { author: { select: { id: true, name: true } } },
        });
        await tx.auditLog.create({
          data: {
            requestId: req.params.id,
            userId: user.id,
            userName: user.name,
            action: 'COMMENT_ADDED',
            details: stepOrder != null ? `Comentário na etapa ${stepOrder}` : 'Comentário geral',
          },
        });
        // Notify everyone involved except the author.
        const recipients = [
          involvement.initiatorId,
          ...involvement.tasks.map((t) => t.assigneeId),
          ...involvement.approvals.map((a) => a.approverId),
        ];
        await notifyMany(
          tx,
          recipients,
          {
            type: 'COMMENT_ADDED',
            title: 'Novo comentário',
            body: `${user.name} comentou em "${involvement.title}".`,
            requestId: req.params.id,
          },
          user.id
        );
        return created;
      });
      res.status(201).json(comment);
    } catch {
      res.status(500).json({ error: 'Erro ao adicionar comentário' });
    }
  }
);

export default router;
