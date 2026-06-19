import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';

const router = Router();

// Tipos de movimentação e como cada um altera o estado do ativo
const VALID_MOVEMENT_TYPES = [
  'ENTRADA', 'ALOCACAO', 'DEVOLUCAO', 'MANUTENCAO', 'RETORNO_MANUTENCAO',
  'DESCARTE', 'TRANSFERENCIA', 'EMPRESTIMO', 'AJUSTE_STATUS',
];

// GET /api/inventory/assets — lista com filtros
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, category, status, departmentId, userId, warehouseId, search, isActive } = req.query;
    const where: any = { isActive: isActive === 'false' ? false : true };
    if (status) where.status = status as string;
    if (departmentId) where.departmentId = departmentId as string;
    if (userId) where.userId = userId as string;
    if (warehouseId) where.warehouseId = warehouseId as string;
    if (type || category) {
      where.item = {};
      if (type) where.item.type = type as string;
      if (category) where.item.category = category as string;
    }
    if (search) {
      const s = search as string;
      where.OR = [
        { tag: { contains: s } },
        { serialNumber: { contains: s } },
        { imei: { contains: s } },
        { phoneNumber: { contains: s } },
        { item: { name: { contains: s } } },
        { item: { code: { contains: s } } },
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      include: {
        item: true,
        warehouse: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(assets);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar ativos' });
  }
});

// GET /api/inventory/assets/:id — detalhe completo + histórico
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: {
        item: true,
        warehouse: true,
        department: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
        movements: {
          include: {
            fromDepartment: { select: { id: true, name: true } },
            toDepartment: { select: { id: true, name: true } },
            fromUser: { select: { id: true, name: true } },
            toUser: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            request: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!asset) { res.status(404).json({ error: 'Ativo não encontrado' }); return; }
    res.json(asset);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar ativo' });
  }
});

// POST /api/inventory/assets — cadastra ativo + registra ENTRADA
router.post('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      itemId, tag, serialNumber, imei, phoneNumber, status, condition,
      purchaseDate, supplier, invoiceNumber, invoiceValueCents,
      warehouseId, departmentId, userId, notes,
    } = req.body;
    if (!itemId) { res.status(400).json({ error: 'itemId é obrigatório' }); return; }

    const initialStatus = status || (userId ? 'ATIVO' : 'DISPONIVEL');

    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          itemId,
          tag: tag || null,
          serialNumber: serialNumber || null,
          imei: imei || null,
          phoneNumber: phoneNumber || null,
          status: initialStatus,
          condition: condition || 'NOVO',
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
          supplier: supplier || null,
          invoiceNumber: invoiceNumber || null,
          invoiceValueCents: invoiceValueCents != null ? Math.round(Number(invoiceValueCents)) : null,
          warehouseId: warehouseId || null,
          departmentId: departmentId || null,
          userId: userId || null,
          notes: notes || null,
        },
        include: { item: true, warehouse: true, department: true, user: { select: { id: true, name: true } } },
      });

      await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          type: 'ENTRADA',
          toDepartmentId: departmentId || null,
          toUserId: userId || null,
          newStatus: initialStatus,
          reason: 'Cadastro inicial do ativo',
          createdById: req.user.id,
        },
      });

      return asset;
    });

    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Patrimônio/tag, série ou IMEI já cadastrado' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Item, almoxarifado, setor ou usuário não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao cadastrar ativo' });
  }
});

// PUT /api/inventory/assets/:id — atualiza dados descritivos (não muda posse/status)
router.put('/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const { tag, serialNumber, imei, phoneNumber, condition, purchaseDate, supplier, invoiceNumber, invoiceValueCents, notes, isActive } = req.body;
    const data: any = {};
    if (tag !== undefined) data.tag = tag;
    if (serialNumber !== undefined) data.serialNumber = serialNumber;
    if (imei !== undefined) data.imei = imei;
    if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;
    if (condition !== undefined) data.condition = condition;
    if (purchaseDate !== undefined) data.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (supplier !== undefined) data.supplier = supplier;
    if (invoiceNumber !== undefined) data.invoiceNumber = invoiceNumber;
    if (invoiceValueCents !== undefined) data.invoiceValueCents = invoiceValueCents != null ? Math.round(Number(invoiceValueCents)) : null;
    if (notes !== undefined) data.notes = notes;
    if (isActive !== undefined) data.isActive = isActive;

    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data,
      include: { item: true, warehouse: true, department: true, user: { select: { id: true, name: true } } },
    });
    res.json(asset);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Patrimônio/tag, série ou IMEI já cadastrado' }); return; }
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Ativo não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar ativo' });
  }
});

// POST /api/inventory/assets/:id/movements — registra movimentação e atualiza estado
router.post('/:id/movements', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, toDepartmentId, toUserId, warehouseId, newStatus, reason, notes, requestId, movementDate } = req.body;
    if (!type) { res.status(400).json({ error: 'type é obrigatório' }); return; }
    if (!VALID_MOVEMENT_TYPES.includes(type)) {
      res.status(400).json({ error: `type inválido. Válidos: ${VALID_MOVEMENT_TYPES.join(', ')}` });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: req.params.id } });
      if (!asset) throw Object.assign(new Error('not found'), { code: 'P2025' });

      const fromDepartmentId = asset.departmentId;
      const fromUserId = asset.userId;
      const previousStatus = asset.status;

      // Estado-alvo do ativo conforme o tipo de movimentação
      const update: any = {};
      let resolvedStatus: string | null = newStatus || null;

      switch (type) {
        case 'DEVOLUCAO':
          update.userId = null;
          update.status = 'DISPONIVEL';
          resolvedStatus = 'DISPONIVEL';
          if (warehouseId !== undefined) update.warehouseId = warehouseId || null;
          break;
        case 'DESCARTE':
          update.status = 'DESCARTADO';
          update.isActive = false;
          resolvedStatus = 'DESCARTADO';
          break;
        case 'MANUTENCAO':
          update.status = 'MANUTENCAO';
          resolvedStatus = 'MANUTENCAO';
          break;
        case 'RETORNO_MANUTENCAO':
          update.status = 'DISPONIVEL';
          resolvedStatus = 'DISPONIVEL';
          break;
        case 'ALOCACAO':
        case 'EMPRESTIMO':
          if (toDepartmentId !== undefined) update.departmentId = toDepartmentId || null;
          if (toUserId !== undefined) update.userId = toUserId || null;
          update.status = type === 'EMPRESTIMO' ? 'EMPRESTADO' : 'ATIVO';
          resolvedStatus = update.status;
          break;
        case 'TRANSFERENCIA':
          if (toDepartmentId !== undefined) update.departmentId = toDepartmentId || null;
          if (toUserId !== undefined) update.userId = toUserId || null;
          if (warehouseId !== undefined) update.warehouseId = warehouseId || null;
          if (newStatus) update.status = newStatus;
          break;
        default: // AJUSTE_STATUS, ENTRADA
          if (newStatus) update.status = newStatus;
          if (toDepartmentId !== undefined) update.departmentId = toDepartmentId || null;
          if (toUserId !== undefined) update.userId = toUserId || null;
          if (warehouseId !== undefined) update.warehouseId = warehouseId || null;
          break;
      }

      const updatedAsset = await tx.asset.update({
        where: { id: asset.id },
        data: update,
        include: { item: true, warehouse: true, department: true, user: { select: { id: true, name: true } } },
      });

      const movement = await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          type,
          movementDate: movementDate ? new Date(movementDate) : new Date(),
          fromDepartmentId,
          toDepartmentId: update.departmentId !== undefined ? update.departmentId : (toDepartmentId || null),
          fromUserId,
          toUserId: update.userId !== undefined ? update.userId : (toUserId || null),
          previousStatus,
          newStatus: resolvedStatus,
          requestId: requestId || null,
          reason: reason || null,
          notes: notes || null,
          createdById: req.user.id,
        },
        include: {
          fromDepartment: { select: { id: true, name: true } },
          toDepartment: { select: { id: true, name: true } },
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          request: { select: { id: true, title: true } },
        },
      });

      return { asset: updatedAsset, movement };
    });

    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Ativo não encontrado' }); return; }
    res.status(500).json({ error: 'Erro ao registrar movimentação' });
  }
});

// GET /api/inventory/assets/:id/movements — histórico do ativo
router.get('/:id/movements', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const movements = await prisma.assetMovement.findMany({
      where: { assetId: req.params.id },
      include: {
        fromDepartment: { select: { id: true, name: true } },
        toDepartment: { select: { id: true, name: true } },
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
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
