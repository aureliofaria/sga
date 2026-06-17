import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

const VALID_STATUSES = ['RASCUNHO', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];
const STATUS_ORDER: Record<string, number> = {
  RASCUNHO: 0,
  EM_ANDAMENTO: 1,
  CONCLUIDA: 2,
  CANCELADA: 3,
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status as string;

    const counts = await prisma.inventoryCount.findMany({
      where,
      include: {
        _count: { select: { items: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(counts);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar contagens' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            stock: { select: { id: true, quantity: true } },
            item: { select: { code: true, name: true, unit: true } },
            warehouse: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!count) { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.json(count);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar contagem' });
  }
});

router.post('/', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { notes, warehouseId } = req.body;

    const count = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryCount.create({
        data: {
          status: 'RASCUNHO',
          notes: notes ?? null,
          createdById: req.user.id,
        },
      });

      if (warehouseId) {
        const stocks = await tx.stock.findMany({
          where: { warehouseId, quantity: { gt: 0 }, item: { isActive: true } },
        });

        if (stocks.length > 0) {
          await tx.inventoryCountItem.createMany({
            data: stocks.map((s) => ({
              countId: created.id,
              stockId: s.id,
              itemId: s.itemId,
              warehouseId: s.warehouseId,
              expectedQuantity: s.quantity,
            })),
          });
        }
      }

      return tx.inventoryCount.findUnique({
        where: { id: created.id },
        include: {
          _count: { select: { items: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
    });

    res.status(201).json(count);
  } catch {
    res.status(500).json({ error: 'Erro ao criar contagem' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, notes } = req.body;
    const data: any = {};
    if (notes !== undefined) data.notes = notes;

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json({ error: `Status inválido. Válidos: ${VALID_STATUSES.join(', ')}` });
        return;
      }
      const current = await prisma.inventoryCount.findUnique({
        where: { id: req.params.id },
        select: { status: true },
      });
      if (!current) { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
      if (STATUS_ORDER[status] < STATUS_ORDER[current.status]) {
        res.status(400).json({ error: 'Não é possível retroceder o status da contagem' });
        return;
      }
      data.status = status;
    }

    const count = await prisma.inventoryCount.update({
      where: { id: req.params.id },
      data,
      include: { _count: { select: { items: true } } },
    });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar contagem' });
  }
});

router.post('/:id/items', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { stockId } = req.body;
    if (!stockId) { res.status(400).json({ error: 'stockId é obrigatório' }); return; }

    const count = await prisma.inventoryCount.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!count) { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    if (!['RASCUNHO', 'EM_ANDAMENTO'].includes(count.status)) {
      res.status(400).json({ error: 'Contagem não está em RASCUNHO ou EM_ANDAMENTO' });
      return;
    }

    const stock = await prisma.stock.findUnique({ where: { id: stockId } });
    if (!stock) { res.status(404).json({ error: 'Estoque não encontrado' }); return; }

    const item = await prisma.inventoryCountItem.create({
      data: {
        countId: req.params.id,
        stockId,
        itemId: stock.itemId,
        warehouseId: stock.warehouseId,
        expectedQuantity: stock.quantity,
      },
      include: {
        item: { select: { code: true, name: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
        stock: { select: { id: true, quantity: true } },
      },
    });
    res.status(201).json(item);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Estoque já adicionado a esta contagem' }); return; }
    res.status(500).json({ error: 'Erro ao adicionar item à contagem' });
  }
});

router.put('/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { countedQuantity, difference, notes } = req.body;
    const data: any = {};
    if (countedQuantity !== undefined) data.countedQuantity = Number(countedQuantity);
    if (difference !== undefined) data.difference = Number(difference);
    if (notes !== undefined) data.notes = notes;

    const item = await prisma.inventoryCountItem.update({
      where: { id: req.params.itemId },
      data,
      include: {
        item: { select: { code: true, name: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
        stock: { select: { id: true, quantity: true } },
      },
    });
    res.json(item);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item da contagem não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar item da contagem' });
  }
});

router.post('/:id/start', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.update({
      where: { id: req.params.id },
      data: { status: 'EM_ANDAMENTO' },
    });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao iniciar contagem' });
  }
});

router.post('/:id/complete', authenticate, requireRole('ADMIN', 'GESTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.update({
      where: { id: req.params.id },
      data: { status: 'CONCLUIDA', completedAt: new Date() },
    });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao concluir contagem' });
  }
});

router.post('/:id/cancel', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.update({
      where: { id: req.params.id },
      data: { status: 'CANCELADA' },
    });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao cancelar contagem' });
  }
});

export default router;
