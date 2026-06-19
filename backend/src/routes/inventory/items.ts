import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

const VALID_TYPES = ['TI', 'ADMINISTRATIVO'];
const VALID_CATEGORIES = ['HARDWARE', 'PERIFERICO', 'SMARTPHONE', 'CHIP', 'MOBILIARIO', 'OUTROS'];

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { isActive, type, category } = req.query;
    const where: any = { isActive: isActive === 'false' ? false : true };
    if (type) where.type = type as string;
    if (category) where.category = category as string;

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { _count: { select: { assets: true } } },
      orderBy: [{ type: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar itens do catálogo' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        assets: {
          where: { isActive: true },
          select: {
            id: true, tag: true, status: true, condition: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!item) { res.status(404).json({ error: 'Item não encontrado' }); return; }
    res.json(item);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar item' });
  }
});

router.post('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, description, type, category, brand, model, unit } = req.body;
    if (!code || !name || !type || !category) {
      res.status(400).json({ error: 'code, name, type e category são obrigatórios' });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `type deve ser: ${VALID_TYPES.join(' | ')}` });
      return;
    }
    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: `category deve ser: ${VALID_CATEGORIES.join(' | ')}` });
      return;
    }
    const item = await prisma.inventoryItem.create({
      data: {
        code, name,
        description: description || null,
        type, category,
        brand: brand || null,
        model: model || null,
        unit: unit || 'UN',
      },
    });
    res.status(201).json(item);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Código já cadastrado' }); return; }
    res.status(500).json({ error: 'Erro ao criar item' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, description, type, category, brand, model, unit, isActive } = req.body;
    const data: any = {};
    if (code !== undefined) data.code = code;
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (type !== undefined) data.type = type;
    if (category !== undefined) data.category = category;
    if (brand !== undefined) data.brand = brand;
    if (model !== undefined) data.model = model;
    if (unit !== undefined) data.unit = unit;
    if (isActive !== undefined) data.isActive = isActive;

    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json(item);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Código já cadastrado' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar item' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Item desativado com sucesso' });
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao desativar item' });
  }
});

export default router;
