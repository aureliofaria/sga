import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { createRequestTasks, advanceRequest } from '../services/workflow';
import { canOpenRequestType } from '../lib/users';
import { APPROVER_ROLES } from '../config';

const router = Router();

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
        resources: { include: { resourceItem: { include: { sector: { select: { id: true, name: true } } } } } },
      },
    });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    res.json(request);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { flowId, title, description, targetEmployee, targetDepartment, startDate,
            amountCents, supplier, costCenter, justification, vacancyType, replacementName,
            resourceIds } = req.body;
    if (!flowId || !title) { res.status(400).json({ error: 'Fluxo e título são obrigatórios' }); return; }

    const flow = await prisma.flowTemplate.findUnique({ where: { id: flowId } });
    if (!flow) { res.status(404).json({ error: 'Fluxo não encontrado' }); return; }

    if (!canOpenRequestType(req.user, flow.type)) {
      res.status(403).json({ error: 'Você não tem permissão para abrir este tipo de solicitação' });
      return;
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
        amountCents: amountCents != null && amountCents !== '' ? Math.round(Number(amountCents)) : null,
        supplier,
        costCenter,
        justification,
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
        resources: { include: { resourceItem: { include: { sector: { select: { id: true, name: true } } } } } },
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
    const request = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!request) { res.status(404).json({ error: 'Solicitação não encontrada' }); return; }
    if (request.initiatorId !== req.user.id && req.user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Acesso negado' }); return;
    }
    const updated = await prisma.request.update({
      where: { id: req.params.id },
      data: { title, description, targetEmployee, targetDepartment, startDate, amountCents: amountCents != null && amountCents !== '' ? Math.round(Number(amountCents)) : undefined, supplier, costCenter, justification },
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
      await prisma.approval.create({
        data: {
          requestId: req.params.id,
          approverId: req.user.id,
          stepOrder: request.currentStep,
          decision: 'REJECTED',
          comments,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') { res.status(409).json({ error: 'Você já decidiu esta etapa' }); return; }
      throw e;
    }

    await prisma.request.update({ where: { id: req.params.id }, data: { status: 'REJECTED' } });

    await prisma.auditLog.create({
      data: {
        requestId: req.params.id,
        userId: req.user.id,
        userName: req.user.name,
        action: 'REJECTED',
        details: comments ? `Rejeitado: ${comments}` : 'Rejeitado',
      },
    });

    res.json({ message: 'Solicitação rejeitada' });
  } catch {
    res.status(500).json({ error: 'Erro ao rejeitar solicitação' });
  }
});

router.post('/:id/attachments', authenticate, upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado' }); return; }

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
    const logs = await prisma.auditLog.findMany({
      where: { requestId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

export default router;
