import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

const VALID_STATUSES = ['RASCUNHO', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];
const STATUS_ORDER: Record<string, number> = { RASCUNHO: 0, EM_ANDAMENTO: 1, CONCLUIDA: 2, CANCELADA: 3 };
const VALID_TYPES = ['GERAL', 'TI', 'ADMINISTRATIVO', 'SETOR'];

// GET /api/inventory/counts — lista contagens
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, departmentId } = req.query;
    const where: any = {};
    if (status) where.status = status as string;
    if (type) where.type = type as string;
    if (departmentId) where.departmentId = departmentId as string;

    const counts = await prisma.inventoryCount.findMany({
      where,
      include: {
        _count: { select: { items: true } },
        createdBy: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(counts);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar contagens' });
  }
});

// GET /api/inventory/counts/:id — detalhe com itens contados
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        items: {
          include: {
            asset: {
              select: {
                id: true, tag: true, serialNumber: true, status: true,
                item: { select: { code: true, name: true, type: true, category: true } },
                department: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } },
              },
            },
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

// POST /api/inventory/counts — cria contagem (pré-popula por setor se informado)
router.post('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, departmentId, notes } = req.body;
    const countType = type || 'GERAL';
    if (!VALID_TYPES.includes(countType)) {
      res.status(400).json({ error: `type deve ser: ${VALID_TYPES.join(' | ')}` });
      return;
    }

    const count = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryCount.create({
        data: {
          status: 'RASCUNHO',
          type: countType,
          departmentId: departmentId || null,
          notes: notes || null,
          createdById: req.user.id,
        },
      });

      if (departmentId) {
        const assets = await tx.asset.findMany({ where: { departmentId, isActive: true } });
        if (assets.length > 0) {
          await tx.inventoryCountItem.createMany({
            data: assets.map((a) => ({ countId: created.id, assetId: a.id })),
          });
        }
      }

      return tx.inventoryCount.findUnique({
        where: { id: created.id },
        include: {
          _count: { select: { items: true } },
          createdBy: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      });
    });

    res.status(201).json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Setor não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao criar contagem' });
  }
});

// PUT /api/inventory/counts/:id — atualiza status (sem retroceder) e observações
router.put('/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, notes } = req.body;
    const data: any = {};
    if (notes !== undefined) data.notes = notes;

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json({ error: `Status inválido. Válidos: ${VALID_STATUSES.join(', ')}` });
        return;
      }
      const current = await prisma.inventoryCount.findUnique({ where: { id: req.params.id }, select: { status: true } });
      if (!current) { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
      if (STATUS_ORDER[status] < STATUS_ORDER[current.status]) {
        res.status(400).json({ error: 'Não é possível retroceder o status da contagem' });
        return;
      }
      data.status = status;
      if (status === 'CONCLUIDA') data.completedAt = new Date();
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

// POST /api/inventory/counts/:id/items — adiciona ativo à contagem
router.post('/:id/items', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { assetId } = req.body;
    if (!assetId) { res.status(400).json({ error: 'assetId é obrigatório' }); return; }

    const count = await prisma.inventoryCount.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!count) { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    if (!['RASCUNHO', 'EM_ANDAMENTO'].includes(count.status)) {
      res.status(400).json({ error: 'Contagem não está em RASCUNHO ou EM_ANDAMENTO' });
      return;
    }

    const item = await prisma.inventoryCountItem.create({
      data: { countId: req.params.id, assetId },
      include: {
        asset: {
          select: {
            id: true, tag: true, status: true,
            item: { select: { code: true, name: true } },
            department: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    res.status(201).json(item);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Ativo já adicionado a esta contagem' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Ativo não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao adicionar ativo à contagem' });
  }
});

// PUT /api/inventory/counts/:id/items/:itemId — registra resultado da contagem física
router.put('/:id/items/:itemId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { found, foundLocation, notes } = req.body;
    const data: any = {};
    if (found !== undefined) data.found = found;
    if (foundLocation !== undefined) data.foundLocation = foundLocation;
    if (notes !== undefined) data.notes = notes;

    const item = await prisma.inventoryCountItem.update({
      where: { id: req.params.itemId },
      data,
      include: {
        asset: {
          select: {
            id: true, tag: true, status: true,
            item: { select: { code: true, name: true } },
          },
        },
      },
    });
    res.json(item);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item da contagem não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar item da contagem' });
  }
});

// POST /api/inventory/counts/:id/start — inicia a contagem
router.post('/:id/start', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.update({ where: { id: req.params.id }, data: { status: 'EM_ANDAMENTO' } });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao iniciar contagem' });
  }
});

// POST /api/inventory/counts/:id/complete — conclui a contagem
router.post('/:id/complete', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
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

// POST /api/inventory/counts/:id/cancel — cancela a contagem
router.post('/:id/cancel', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.inventoryCount.update({ where: { id: req.params.id }, data: { status: 'CANCELADA' } });
    res.json(count);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Contagem não encontrada' }); return; }
    res.status(500).json({ error: 'Erro ao cancelar contagem' });
  }
});

export default router;
