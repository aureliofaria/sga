import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { category, warehouseId, itemId, isActive } = req.query;
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId as string;
    if (itemId) where.itemId = itemId as string;
    if (isActive === 'false') {
      where.item = { isActive: false };
    } else {
      where.item = { isActive: true };
    }
    if (category) {
      where.item = { ...where.item, category: category as string };
    }

    const stocks = await prisma.stock.findMany({
      where,
      include: {
        item: true,
        warehouse: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(stocks);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar estoques' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const stock = await prisma.stock.findUnique({
      where: { id: req.params.id },
      include: {
        item: true,
        warehouse: true,
        movements: {
          include: {
            createdBy: { select: { id: true, name: true } },
            request: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!stock) { res.status(404).json({ error: 'Estoque não encontrado' }); return; }
    res.json(stock);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar estoque' });
  }
});

router.post('/', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { itemId, warehouseId, quantity, minQuantity, maxQuantity } = req.body;
    if (!itemId || !warehouseId) {
      res.status(400).json({ error: 'itemId e warehouseId são obrigatórios' });
      return;
    }
    const qty = Number(quantity ?? 0);

    const stock = await prisma.$transaction(async (tx) => {
      const created = await tx.stock.create({
        data: {
          itemId,
          warehouseId,
          quantity: qty,
          minQuantity: minQuantity != null ? Number(minQuantity) : null,
          maxQuantity: maxQuantity != null ? Number(maxQuantity) : null,
        },
        include: { item: true, warehouse: true },
      });

      await tx.inventoryMovement.create({
        data: {
          itemId,
          warehouseId,
          stockId: created.id,
          type: 'ENTRADA',
          quantity: qty,
          previousQuantity: 0,
          currentQuantity: qty,
          reason: 'Cadastro inicial do estoque',
          createdById: req.user.id,
        },
      });

      return created;
    });

    res.status(201).json(stock);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Estoque já cadastrado para este item/almoxarifado' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item ou almoxarifado não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao criar estoque' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { minQuantity, maxQuantity } = req.body;
    const data: any = {};
    if (minQuantity !== undefined) data.minQuantity = minQuantity != null ? Number(minQuantity) : null;
    if (maxQuantity !== undefined) data.maxQuantity = maxQuantity != null ? Number(maxQuantity) : null;

    const stock = await prisma.stock.update({
      where: { id: req.params.id },
      data,
      include: { item: true, warehouse: true },
    });
    res.json(stock);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Estoque não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar estoque' });
  }
});

const VALID_MOVEMENT_TYPES = ['ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA'];

router.post('/:id/movements', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, quantity, reason, notes, requestId } = req.body;
    if (!type) { res.status(400).json({ error: 'Tipo é obrigatório' }); return; }
    if (!VALID_MOVEMENT_TYPES.includes(type)) {
      res.status(400).json({ error: `Tipo inválido. Válidos: ${VALID_MOVEMENT_TYPES.join(', ')}` });
      return;
    }
    const qty = Number(quantity ?? 0);
    if (qty === 0 && type !== 'AJUSTE') {
      res.status(400).json({ error: 'Quantidade deve ser informada' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({ where: { id: req.params.id } });
      if (!stock) throw Object.assign(new Error('not found'), { code: 'P2025' });

      let delta = qty;
      if (type === 'SAIDA') delta = -qty;

      const newQty = stock.quantity + delta;

      const updated = await tx.stock.update({
        where: { id: req.params.id },
        data: { quantity: newQty },
        include: { item: true, warehouse: true },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: stock.itemId,
          warehouseId: stock.warehouseId,
          stockId: stock.id,
          type,
          quantity: qty,
          previousQuantity: stock.quantity,
          currentQuantity: newQty,
          reason: reason ?? null,
          notes: notes ?? null,
          requestId: requestId ?? null,
          createdById: req.user.id,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
          request: { select: { id: true, title: true } },
        },
      });

      return { stock: updated, movement };
    });

    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Estoque não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao registrar movimentação' });
  }
});

router.get('/:id/movements', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: { stockId: req.params.id },
      include: {
        item: { select: { code: true, name: true, category: true } },
        warehouse: { select: { code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        request: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(movements);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar movimentações' });
  }
});

export default router;
