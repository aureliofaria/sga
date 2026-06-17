import { Router, Request as ExpressRequest, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * Global audit trail — restricted to ADMIN/DIRETOR (least-privilege, LGPD).
 * The per-request timeline remains available to involved users via
 * GET /api/requests/:id (which embeds `auditLogs`).
 */
router.get('/', authenticate, requireRole('ADMIN', 'DIRETOR'), async (req: ExpressRequest, res: Response) => {
  try {
    const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : undefined;
    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const logs = await prisma.auditLog.findMany({
      where: requestId ? { requestId } : {},
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar trilha de auditoria' });
  }
});

export default router;
