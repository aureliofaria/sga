import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      include: { _count: { select: { assets: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(warehouses);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar almoxarifados' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: {
        assets: {
          where: { isActive: true },
          include: {
            item: { select: { code: true, name: true, type: true, category: true } },
            user: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!warehouse) { res.status(404).json({ error: 'Almoxarifado não encontrado' }); return; }
    res.json(warehouse);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar almoxarifado' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, description } = req.body;
    if (!code || !name) {
      res.status(400).json({ error: 'Código e nome são obrigatórios' });
      return;
    }
    const warehouse = await prisma.warehouse.create({ data: { code, name, description: description || null } });
    res.status(201).json(warehouse);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Código já cadastrado' }); return; }
    res.status(500).json({ error: 'Erro ao criar almoxarifado' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, description, isActive } = req.body;
    const data: any = {};
    if (code !== undefined) data.code = code;
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;

    const warehouse = await prisma.warehouse.update({ where: { id: req.params.id }, data });
    res.json(warehouse);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Código já cadastrado' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Almoxarifado não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar almoxarifado' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const activeAssets = await prisma.asset.count({ where: { warehouseId: req.params.id, isActive: true } });
    if (activeAssets > 0) {
      res.status(409).json({ error: 'Almoxarifado possui ativos ativos e não pode ser desativado' });
      return;
    }
    await prisma.warehouse.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Almoxarifado desativado com sucesso' });
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Almoxarifado não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao desativar almoxarifado' });
  }
});

export default router;
