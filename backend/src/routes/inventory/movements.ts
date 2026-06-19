import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

// GET /api/inventory/movements — log global de movimentações com filtros
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { type, assetId, departmentId, userId, requestId, from, to } = req.query;
    const where: any = {};
    if (type) where.type = type as string;
    if (assetId) where.assetId = assetId as string;
    if (requestId) where.requestId = requestId as string;
    if (departmentId) {
      where.OR = [
        ...(where.OR || []),
        { fromDepartmentId: departmentId as string },
        { toDepartmentId: departmentId as string },
      ];
    }
    if (userId) {
      where.AND = [
        ...(where.AND || []),
        { OR: [{ fromUserId: userId as string }, { toUserId: userId as string }] },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    const movements = await prisma.assetMovement.findMany({
      where,
      include: {
        asset: { select: { id: true, tag: true, item: { select: { code: true, name: true, type: true, category: true } } } },
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
