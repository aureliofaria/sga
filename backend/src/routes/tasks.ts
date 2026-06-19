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
    const skipped: { id: string; reason: string }[] = [];
    const requestIds = new Set<string>();

    for (const taskId of taskIds) {
      try {
        const existing = await prisma.requestTask.findUnique({ where: { id: taskId } });
        if (!existing || existing.assigneeId !== req.user.id) {
          skipped.push({ id: taskId, reason: 'não atribuída ao usuário' });
          continue;
        }
        if (await attachmentRequirementUnmet(existing.stepId, existing.id, existing.requestId)) {
          skipped.push({ id: taskId, reason: 'anexo obrigatório ausente' });
          continue;
        }
        const task = await prisma.requestTask.update({
          where: { id: taskId },
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
        skipped.push({ id: taskId, reason: 'erro ao processar' });
      }
    }

    for (const requestId of requestIds) {
      await advanceRequest(requestId);
    }

    res.json({ completed: completed.length, skipped, tasks: completed });
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

// Verifica se a etapa exige anexo e, em caso afirmativo, se há ao menos um anexo
// vinculado à tarefa ou à solicitação. Retorna true quando o requisito NÃO foi atendido.
async function attachmentRequirementUnmet(stepId: string, taskId: string, requestId: string): Promise<boolean> {
  const step = await prisma.flowStep.findUnique({ where: { id: stepId }, select: { requiresAttachment: true } });
  if (!step?.requiresAttachment) return false;
  const count = await prisma.attachment.count({ where: { OR: [{ taskId }, { requestId }] } });
  return count === 0;
}

// Garante que a tarefa pertence ao usuário (ou que ele é ADMIN). Retorna a tarefa
// ou envia a resposta de erro apropriada e devolve null.
async function loadOwnedTask(req: AuthRequest, res: Response) {
  const task = await prisma.requestTask.findUnique({ where: { id: req.params.id } });
  if (!task) { res.status(404).json({ error: 'Tarefa não encontrada' }); return null; }
  if (task.assigneeId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Esta tarefa não está atribuída a você' }); return null;
  }
  return task;
}

router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const owned = await loadOwnedTask(req, res);
    if (!owned) return;
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
    const owned = await loadOwnedTask(req, res);
    if (!owned) return;
    if (await attachmentRequirementUnmet(owned.stepId, owned.id, owned.requestId)) {
      res.status(400).json({ error: 'Esta etapa exige pelo menos um anexo antes da conclusão' }); return;
    }
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
    const owned = await loadOwnedTask(req, res);
    if (!owned) return;
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
