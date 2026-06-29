import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload, handleUpload } from '../middleware/upload';
import { advanceRequest, processSlaExpiries, processEscalations, publishWorkflowEvent } from '../services/workflow';
import { notify } from '../services/notifications';
import { isFunctionRole } from '../lib/queue';
import { checklistUnmet } from '../lib/checklist';

const router = Router();

router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Auto-process any expired SLAs before returning tasks
    processSlaExpiries().catch(() => {});
    // Escalonamento temporal (Passo 11): dispara estágios elegíveis em background.
    processEscalations().catch(() => {});

    const tasks = await prisma.requestTask.findMany({
      // Não polui a lista com tarefas de fila que outro colega assumiu (irmãs
      // CANCELLED de quem "perdeu" a fila).
      where: { assigneeId: req.user.id, status: { not: 'CANCELLED' } },
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
        if ((await requiredFieldsUnmet(existing.stepId, existing.requestId)).length > 0) {
          skipped.push({ id: taskId, reason: 'campos obrigatórios não preenchidos' });
          continue;
        }
        if ((await checklistUnmet(existing.stepId, existing.requestId)).length > 0) {
          skipped.push({ id: taskId, reason: 'checklist incompleto' });
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
    // Anti-IDOR: só o responsável pela tarefa, o iniciador da solicitação ou um
    // papel de visão ampla (ADMIN/MANAGER/FINANCE/HR) podem ver a tarefa.
    const privileged = ['ADMIN', 'MANAGER', 'FINANCE', 'HR'].includes(req.user.role);
    if (!privileged && task.assigneeId !== req.user.id && task.request.initiatorId !== req.user.id) {
      res.status(403).json({ error: 'Acesso negado' }); return;
    }
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

// Verifica se há FormFields OBRIGATÓRIOS da etapa sem RequestFieldValue gravado
// para a solicitação. Espelha attachmentRequirementUnmet. Retorna a lista de
// `key`s pendentes (vazia quando o requisito foi atendido) — Passo 7.
async function requiredFieldsUnmet(stepId: string, requestId: string): Promise<string[]> {
  const required = await prisma.formField.findMany({
    where: { flowStepId: stepId, required: true },
    select: { id: true, key: true },
  });
  if (required.length === 0) return [];
  const filled = await prisma.requestFieldValue.findMany({
    where: { requestId, fieldId: { in: required.map((f) => f.id) }, NOT: { value: '' } },
    select: { fieldId: true },
  });
  const filledIds = new Set(filled.map((v) => v.fieldId));
  return required.filter((f) => !filledIds.has(f.id)).map((f) => f.key);
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
    const missing = await requiredFieldsUnmet(owned.stepId, owned.requestId);
    if (missing.length > 0) {
      res.status(400).json({ error: 'Há campos obrigatórios não preenchidos nesta etapa', missing }); return;
    }
    const pendingChecklist = await checklistUnmet(owned.stepId, owned.requestId);
    if (pendingChecklist.length > 0) {
      res.status(400).json({ error: 'Há itens de checklist obrigatórios não concluídos nesta etapa', pending: pendingChecklist }); return;
    }
    const { notes } = req.body;
    // Concluir implica assumir (Passo 6 — REF.2): se a etapa é de FUNÇÃO (fila),
    // marcar COMPLETED e, na mesma transação, cancelar as irmãs PENDING da etapa.
    // Assim a fila fecha mesmo que o usuário conclua sem ter clicado "assumir".
    // Etapas legadas/aprovação mantêm o comportamento atual (sem cancelar irmãs).
    const step = await prisma.flowStep.findUnique({ where: { id: owned.stepId }, select: { requiredRole: true } });
    const isFunctionStep = isFunctionRole(step?.requiredRole);

    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.requestTask.update({
        where: { id: req.params.id },
        data: { status: 'COMPLETED', completedAt: new Date(), notes },
      });
      if (isFunctionStep) {
        // Concluída a tarefa de função, o trabalho da etapa está feito: cancela
        // TODAS as outras irmãs ativas (PENDING e IN_PROGRESS) — não só as
        // pendentes — para não deixar uma tarefa assumida em paralelo "presa".
        await tx.requestTask.updateMany({
          where: { requestId: t.requestId, stepId: t.stepId, status: { in: ['PENDING', 'IN_PROGRESS'] }, id: { not: t.id } },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.auditLog.create({
        data: {
          requestId: t.requestId,
          userId: req.user.id,
          userName: req.user.name,
          action: 'TASK_COMPLETED',
          details: `Tarefa concluída: ${t.title}`,
        },
      });
      return t;
    });

    await advanceRequest(task.requestId);
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao concluir tarefa' });
  }
});

// Assumir uma tarefa de FILA (Passo 6 — REF.1). O claim age na PRÓPRIA linha
// do usuário: no fan-out, cada elegível já recebeu a sua RequestTask, então
// quem tem linha era elegível — não há reatribuição de assigneeId nem nova
// resolução da fila. Concorrência: a transição PENDING→IN_PROGRESS é otimista
// (updateMany com guarda de status); na mesma transação, as irmãs PENDING da
// etapa são canceladas e quem assumiu fica como único responsável ativo.
router.post('/:id/claim', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const task = await prisma.requestTask.findUnique({ where: { id: req.params.id } });
    if (!task) { res.status(404).json({ error: 'Tarefa não encontrada' }); return; }
    // A fila é DELE: a linha já é do próprio usuário (ou ADMIN intervém).
    if (task.assigneeId !== req.user.id && req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Esta tarefa não está atribuída a você' }); return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Fila de DONO ÚNICO: se uma irmã já foi assumida/concluída, a fila está
      // tomada — ninguém mais assume (evita trabalho paralelo desperdiçado).
      const taken = await tx.requestTask.findFirst({
        where: { requestId: task.requestId, stepId: task.stepId, status: { in: ['IN_PROGRESS', 'COMPLETED'] }, id: { not: task.id } },
        select: { id: true },
      });
      if (taken) return 'TAKEN';

      // Guarda otimista: só assume se a própria linha ainda estiver PENDING.
      const upd = await tx.requestTask.updateMany({
        where: { id: task.id, status: 'PENDING' },
        data: { status: 'IN_PROGRESS' },
      });
      if (upd.count === 0) return 'NOT_PENDING';

      // Cancela as irmãs PENDING da mesma (requestId, stepId) — padrão do fan-out.
      await tx.requestTask.updateMany({
        where: { requestId: task.requestId, stepId: task.stepId, status: 'PENDING', id: { not: task.id } },
        data: { status: 'CANCELLED' },
      });

      await tx.auditLog.create({
        data: {
          requestId: task.requestId,
          userId: req.user.id,
          userName: req.user.name,
          action: 'TASK_CLAIMED',
          details: `Tarefa assumida da fila: ${task.title}`,
        },
      });
      await notify(tx, { userId: req.user.id, type: 'TASK_CLAIMED', title: 'Tarefa assumida', body: `Você assumiu a tarefa "${task.title}".`, requestId: task.requestId });
      return 'OK';
    });

    if (result === 'TAKEN') { res.status(409).json({ error: 'Esta fila já foi assumida por outro responsável' }); return; }
    if (result === 'NOT_PENDING') { res.status(409).json({ error: 'Tarefa já foi assumida' }); return; }

    // Ponto de integração futuro com o ERP (no-op hoje).
    await publishWorkflowEvent('TASK_CLAIMED', task.requestId, { taskId: task.id, userId: req.user.id });

    const updated = await prisma.requestTask.findUnique({ where: { id: task.id } });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao assumir tarefa' });
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

router.post('/:id/attachments', authenticate, handleUpload(upload.array('files', 10)), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }
    // Anti-IDOR: só o responsável pela tarefa (ou ADMIN) pode anexar.
    const task = await loadOwnedTask(req, res);
    if (!task) return;

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

// Justificativa de atraso (Fase 0 · Passo 11). O responsável (ou ADMIN) registra
// o motivo do atraso; o texto é incorporado às notificações de escalonamento.
// Não exige que a tarefa esteja efetivamente atrasada — o responsável pode
// justificar proativamente.
router.post('/:id/justify-delay', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const owned = await loadOwnedTask(req, res);
    if (!owned) return;
    const justification = typeof req.body?.justification === 'string' ? req.body.justification.trim() : '';
    if (!justification) {
      res.status(400).json({ error: 'A justificativa é obrigatória' }); return;
    }
    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.requestTask.update({
        where: { id: req.params.id },
        data: {
          delayJustification: justification,
          delayJustifiedAt: new Date(),
          delayJustifiedById: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: t.requestId,
          userId: req.user.id,
          userName: req.user.name,
          action: 'DELAY_JUSTIFIED',
          details: `Justificativa de atraso registrada na tarefa "${t.title}": ${justification}`,
        },
      });
      return t;
    });
    res.json(task);
  } catch {
    res.status(500).json({ error: 'Erro ao registrar justificativa' });
  }
});

export default router;
