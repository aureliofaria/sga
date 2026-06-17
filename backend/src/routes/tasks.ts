import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { advanceRequest, processSlaExpiries } from '../services/workflow';

const router = Router();

router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Auto-process any expired SLAs before returning tasks
    processSlaExpiries().catch(() => {});

    const tasks = await prisma.requestTask.findMany({
      where: { assigneeId: req.user.id },
      include: {
        request: { include: { flow: true, initiator: { select: { id: true, name: true } } } },
        step: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tasks);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
  }
});

// Batch complete
router.post('/batch-complete', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { taskIds, notes } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      res.status(400).json({ error: 'taskIds deve ser um array não vazio' }); return;
    }

    const completed = [];
    const requestIds = new Set<string>();

    for (const taskId of taskIds) {
      try {
        const task = await prisma.requestTask.update({
          where: { id: taskId, assigneeId: req.user.id },
          data: { status: 'COMPLETED', completedAt: new Date(), notes },
        });
        await prisma.auditLog.create({
          data: {
            requestId: task.requestId,
            userId: req.user.id,
            userName: req.user.name,
            action: 'TASK_COMPLETED',
            details: `Tarefa concluída (lote): ${task.title}`,
          },
        });
        requestIds.add(task.requestId);
        completed.push(task);
      } catch {
        // Skip tasks not found or not owned by user
      }
    }

    for (const requestId of requestIds) {
      await advanceRequest(requestId);
    }

    res.json({ completed: completed.length, tasks: completed });
  } catch {
    res.status(500).json({ error: 'Erro ao concluir tarefas em lote' });
  }
});

// Process SLA manually (admin only)
router.post('/process-sla', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Acesso negado' }); return; }
  try {
    const count = await processSlaExpiries();
    res.json({ processed: count });
  } catch {
    res.status(500).json({ error: 'Erro ao processar SLA' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const task = await prisma.requestTask.findUnique({
      where: { id: req.params.id },
      include: {
        request: { include: { flow: true } },
        assignee: { select: { id: true, name: true, email: true } },
        step: { include: { authLevels: true } },
        attachments: true,
      },
    });
    if (!task) { res.status(404).json({ error: 'Tarefa não encontrada' }); return; }
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar tarefa' });
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, notes } = req.body;
    const task = await prisma.requestTask.update({
      where: { id: req.params.id },
      data: { status, notes },
    });
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar tarefa' });
  }
});

router.post('/:id/complete', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { notes } = req.body;
    const task = await prisma.requestTask.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', completedAt: new Date(), notes },
    });

    await prisma.auditLog.create({
      data: {
        requestId: task.requestId,
        userId: req.user.id,
        userName: req.user.name,
        action: 'TASK_COMPLETED',
        details: `Tarefa concluída: ${task.title}`,
      },
    });

    await advanceRequest(task.requestId);
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao concluir tarefa' });
  }
});

router.post('/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { notes } = req.body;
    const task = await prisma.requestTask.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', notes },
    });

    await prisma.auditLog.create({
      data: {
        requestId: task.requestId,
        userId: req.user.id,
        userName: req.user.name,
        action: 'TASK_REJECTED',
        details: `Tarefa rejeitada: ${task.title}`,
      },
    });

    await prisma.request.update({ where: { id: task.requestId }, data: { status: 'REJECTED' } });
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao rejeitar tarefa' });
  }
});

router.post('/:id/attachments', authenticate, upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }
    const task = await prisma.requestTask.findUnique({ where: { id: req.params.id } });
    if (!task) { res.status(404).json({ error: 'Tarefa não encontrada' }); return; }

    const attachments = await Promise.all(files.map((file) =>
      prisma.attachment.create({
        data: {
          taskId: req.params.id,
          requestId: task.requestId,
          fileName: file.filename,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          storagePath: file.path,
          uploadedBy: req.user.id,
        },
      })
    ));
    res.status(201).json(attachments);
  } catch {
    res.status(500).json({ error: 'Erro ao fazer upload' });
  }
});

export default router;
