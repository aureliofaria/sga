import { Router, Request as ExpressRequest, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';
import { advanceRequest } from '../services/workflow';

const router = Router();

const decisionSchema = z
  .object({
    requestId: z.string().min(1),
    decision: z.enum(['APPROVED', 'REJECTED']),
    comments: z.string().optional(),
  })
  // Rejection must carry a reason (mandatory justification).
  .refine((d) => d.decision !== 'REJECTED' || (d.comments && d.comments.trim().length > 0), {
    message: 'A rejeição exige um motivo',
    path: ['comments'],
  });

router.post('/', authenticate, validateBody(decisionSchema), async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const { requestId, decision, comments } = req.body as z.infer<typeof decisionSchema>;
  try {
    const request = await prisma.request.findUnique({ where: { id: requestId } });
    if (!request) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }
    if (!['PENDING', 'IN_PROGRESS'].includes(request.status)) {
      res.status(409).json({ error: 'Solicitação não está em andamento' });
      return;
    }
    // Defense in depth — the initiator can never decide on their own request
    // (audit finding C3); they are also never assigned a task for it.
    if (request.initiatorId === user.id) {
      res.status(403).json({ error: 'Você não pode aprovar a própria solicitação' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.requestTask.findFirst({
        where: {
          requestId,
          assigneeId: user.id,
          status: 'PENDING',
          step: { order: request.currentStep },
        },
      });
      if (!task) {
        return { status: 403 as const, body: { error: 'Você não tem uma tarefa pendente nesta etapa' } };
      }

      try {
        await tx.approval.create({
          data: {
            requestId,
            approverId: user.id,
            stepOrder: request.currentStep,
            decision,
            comments: comments || null,
          },
        });
      } catch (e) {
        // Unique constraint => approver already decided this step (C4).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { status: 409 as const, body: { error: 'Você já registrou uma decisão nesta etapa' } };
        }
        throw e;
      }

      await tx.requestTask.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', completedAt: new Date(), notes: comments || null },
      });

      await tx.auditLog.create({
        data: {
          requestId,
          userId: user.id,
          userName: user.name,
          action: decision,
          details:
            decision === 'REJECTED'
              ? `Rejeitado: ${comments}`
              : `Aprovado${comments ? `: ${comments}` : ''}`,
        },
      });

      if (decision === 'REJECTED') {
        await tx.requestTask.updateMany({
          where: { requestId, status: 'PENDING', step: { order: request.currentStep } },
          data: { status: 'CANCELLED' },
        });
        await tx.request.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
      } else {
        await advanceRequest(tx, requestId);
      }

      return { status: 200 as const, body: null };
    });

    if (result.status !== 200) {
      res.status(result.status).json(result.body);
      return;
    }

    const updated = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        tasks: { include: { assignee: { select: { id: true, name: true } } } },
        approvals: { include: { approver: { select: { id: true, name: true } } } },
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao registrar decisão' });
  }
});

export default router;
