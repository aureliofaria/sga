import { Router, Request as ExpressRequest, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';
import { startRequest } from '../services/workflow';

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

export default router;
