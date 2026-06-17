import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, stockId, itemId, warehouseId, requestId, from, to } = req.query;
    const where: any = {};
    if (type) where.type = type as string;
    if (stockId) where.stockId = stockId as string;
    if (itemId) where.itemId = itemId as string;
    if (warehouseId) where.warehouseId = warehouseId as string;
    if (requestId) where.requestId = requestId as string;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        item: { select: { code: true, name: true, category: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
        stock: { select: { id: true, quantity: true } },
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
