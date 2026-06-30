import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// List all resources (grouped by sector for UI)
router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.resourceItem.findMany({
      include: { sector: { select: { id: true, name: true } } },
      orderBy: [{ sectorId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar recursos' });
  }
});

// List active resources for selection (onboarding form)
router.get('/active', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.resourceItem.findMany({
      where: { isActive: true },
      include: { sector: { select: { id: true, name: true } } },
      orderBy: [{ sectorId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar recursos ativos' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, sectorId, sortOrder, selectionGroup, dependsOnId } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Nome é obrigatório' }); return; }
    const item = await prisma.resourceItem.create({
      data: {
        name: name.trim(),
        type: type || 'EQUIPMENT',
        sectorId: sectorId || null,
        sortOrder: sortOrder ?? 0,
        selectionGroup: selectionGroup?.trim() || null,
        dependsOnId: dependsOnId || null,
      },
      include: { sector: { select: { id: true, name: true } } },
    });
    res.status(201).json(item);
  } catch {
    res.status(500).json({ error: 'Erro ao criar recurso' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, sectorId, isActive, sortOrder, selectionGroup, dependsOnId } = req.body;
    // Evita autodependência (um item não pode depender de si mesmo).
    const safeDependsOn = dependsOnId && dependsOnId !== req.params.id ? dependsOnId : (dependsOnId === null || dependsOnId === '' ? null : undefined);
    const item = await prisma.resourceItem.update({
      where: { id: req.params.id },
      data: {
        name, type, sectorId: sectorId || null, isActive, sortOrder,
        ...(selectionGroup !== undefined ? { selectionGroup: selectionGroup?.trim() || null } : {}),
        ...(safeDependsOn !== undefined ? { dependsOnId: safeDependsOn } : {}),
      },
      include: { sector: { select: { id: true, name: true } } },
    });
    res.json(item);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar recurso' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.resourceItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Recurso desativado' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover recurso' });
  }
});

export default router;
