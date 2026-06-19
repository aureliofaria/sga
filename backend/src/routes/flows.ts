import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const flows = await prisma.flowTemplate.findMany({
      include: {
        _count: { select: { steps: true } },
        sector: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(flows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxos' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const flow = await prisma.flowTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        sector: { select: { id: true, name: true } },
        steps: {
          orderBy: { order: 'asc' },
          include: {
            authLevels: true,
            handlingSector: { select: { id: true, name: true } },
            activateOnSector: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!flow) { res.status(404).json({ error: 'Fluxo não encontrado' }); return; }
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxo' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, type, scope, sectorId, isActive } = req.body;
    if (!name || !type) { res.status(400).json({ error: 'Nome e tipo são obrigatórios' }); return; }
    const flow = await prisma.flowTemplate.create({
      data: { name, description, type, scope: scope ?? 'INTRA', sectorId: sectorId || null, isActive: isActive ?? true },
    });
    res.status(201).json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao criar fluxo' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, type, scope, sectorId, isActive } = req.body;
    const flow = await prisma.flowTemplate.update({
      where: { id: req.params.id },
      data: { name, description, type, scope, sectorId: sectorId || null, isActive },
      include: {
        sector: { select: { id: true, name: true } },
        steps: { orderBy: { order: 'asc' }, include: { authLevels: true, handlingSector: { select: { id: true, name: true } } } },
      },
    });
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar fluxo' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.flowTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Fluxo removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover fluxo' });
  }
});

// Steps
router.post('/:id/steps', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, requiredRole, requiresAttachment, deadlineHours, slaExpiry, order,
            handlingSectorId, conditions, activateOnSectorId, collectsResources } = req.body;
    const maxOrder = await prisma.flowStep.aggregate({ where: { flowTemplateId: req.params.id }, _max: { order: true } });
    const nextOrder = order ?? ((maxOrder._max.order ?? -1) + 1);
    const step = await prisma.flowStep.create({
      data: {
        flowTemplateId: req.params.id, name, description, requiredRole,
        requiresAttachment: requiresAttachment ?? false, deadlineHours,
        slaExpiry: slaExpiry || 'KEEP_WITH_RESPONSIBLE',
        conditions: conditions || null,
        activateOnSectorId: activateOnSectorId || null,
        collectsResources: collectsResources ?? false,
        order: nextOrder, handlingSectorId: handlingSectorId || null,
      },
      include: {
        handlingSector: { select: { id: true, name: true } },
        activateOnSector: { select: { id: true, name: true } },
      },
    });
    res.status(201).json(step);
  } catch {
    res.status(500).json({ error: 'Erro ao criar etapa' });
  }
});

router.put('/:id/steps/:stepId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, requiredRole, requiresAttachment, deadlineHours, slaExpiry, order,
            handlingSectorId, conditions, activateOnSectorId, collectsResources } = req.body;
    const step = await prisma.flowStep.update({
      where: { id: req.params.stepId },
      data: {
        name, description, requiredRole, requiresAttachment, deadlineHours,
        slaExpiry: slaExpiry || 'KEEP_WITH_RESPONSIBLE',
        conditions: conditions || null,
        activateOnSectorId: activateOnSectorId || null,
        collectsResources: collectsResources ?? false,
        order, handlingSectorId: handlingSectorId || null,
      },
      include: {
        handlingSector: { select: { id: true, name: true } },
        activateOnSector: { select: { id: true, name: true } },
      },
    });
    res.json(step);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar etapa' });
  }
});

router.delete('/:id/steps/:stepId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.flowStep.delete({ where: { id: req.params.stepId } });
    res.json({ message: 'Etapa removida com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover etapa' });
  }
});

// Auth levels
router.post('/:flowId/steps/:stepId/auth-levels', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, minValueCents, maxValueCents, requiredApprovers, approverRole, deadlineHours } = req.body;
    const level = await prisma.authorizationLevel.create({
      data: {
        flowStepId: req.params.stepId,
        name,
        minValueCents: minValueCents != null ? Math.round(Number(minValueCents)) : null,
        maxValueCents: maxValueCents != null ? Math.round(Number(maxValueCents)) : null,
        requiredApprovers: requiredApprovers ?? 1,
        approverRole,
        deadlineHours,
      },
    });
    res.status(201).json(level);
  } catch {
    res.status(500).json({ error: 'Erro ao criar nível de autorização' });
  }
});

router.put('/:flowId/steps/:stepId/auth-levels/:levelId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, minValueCents, maxValueCents, requiredApprovers, approverRole, deadlineHours } = req.body;
    const level = await prisma.authorizationLevel.update({
      where: { id: req.params.levelId },
      data: {
        name,
        minValueCents: minValueCents != null ? Math.round(Number(minValueCents)) : null,
        maxValueCents: maxValueCents != null ? Math.round(Number(maxValueCents)) : null,
        requiredApprovers,
        approverRole,
        deadlineHours,
      },
    });
    res.json(level);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar nível de autorização' });
  }
});

router.delete('/:flowId/steps/:stepId/auth-levels/:levelId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.authorizationLevel.delete({ where: { id: req.params.levelId } });
    res.json({ message: 'Nível de autorização removido' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover nível de autorização' });
  }
});

export default router;
