import { Router, Request as ExpressRequest, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/** Tasks assigned to the current user (defaults to pending ones). */
router.get('/my', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
  try {
    const tasks = await prisma.requestTask.findMany({
      where: { assigneeId: user.id, ...(status === 'ALL' ? {} : { status }) },
      include: {
        request: {
          select: { id: true, title: true, status: true, amountCents: true, currency: true },
        },
        step: { select: { id: true, name: true, order: true, requiresAttachment: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(tasks);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
  }
});

router.get('/:id', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const task = await prisma.requestTask.findUnique({
      where: { id: req.params.id },
      include: { request: true, step: { include: { authLevels: true } }, attachments: true },
    });
    if (!task) {
      res.status(404).json({ error: 'Tarefa não encontrada' });
      return;
    }
    const seesAll = ['ADMIN', 'DIRETOR'].includes(user.role);
    if (!seesAll && task.assigneeId !== user.id && task.request.initiatorId !== user.id) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar tarefa' });
  }
});

export default router;
