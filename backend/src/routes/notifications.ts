import { Router, Request as ExpressRequest, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';

const router = Router();

const VALID_CHANNELS = ['IN_APP', 'TEAMS', 'OUTLOOK'] as const;
const VALID_EVENTS = ['TASK_ASSIGNED', 'REQUEST_REJECTED', 'REQUEST_COMPLETED', 'COMMENT_ADDED'] as const;

/** Current user's notifications. IN_APP only by default. */
router.get('/', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const status = typeof req.query.status === 'string' ? req.query.status : 'UNREAD';
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: user.id,
        channel: 'IN_APP',
        ...(status === 'ALL' ? {} : { status }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(notifications);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar notificações' });
  }
});

router.get('/unread-count', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const count = await prisma.notification.count({
      where: { userId: user.id, channel: 'IN_APP', status: 'UNREAD' },
    });
    res.json({ count });
  } catch {
    res.status(500).json({ error: 'Erro ao contar notificações' });
  }
});

router.post('/:id/read', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification || notification.userId !== user.id) {
      res.status(404).json({ error: 'Notificação não encontrada' });
      return;
    }
    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { status: 'READ', readAt: new Date() },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificação' });
  }
});

router.post('/read-all', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    await prisma.notification.updateMany({
      where: { userId: user.id, channel: 'IN_APP', status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    res.json({ message: 'Notificações marcadas como lidas' });
  } catch {
    res.status(500).json({ error: 'Erro ao marcar notificações' });
  }
});

// --- Preferências configuráveis de notificação ---

router.get('/preferences', authenticate, async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  try {
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: user.id } });
    res.json(prefs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar preferências' });
  }
});

const prefsSchema = z.object({
  preferences: z
    .array(
      z.object({
        channel: z.enum(VALID_CHANNELS),
        eventType: z.enum(VALID_EVENTS),
        enabled: z.boolean(),
      })
    )
    .min(1),
});

router.put('/preferences', authenticate, validateBody(prefsSchema), async (req: ExpressRequest, res: Response) => {
  const { user } = req as AuthRequest;
  const { preferences } = req.body as z.infer<typeof prefsSchema>;
  try {
    await prisma.$transaction(
      preferences.map((p) =>
        prisma.notificationPreference.upsert({
          where: {
            userId_channel_eventType: {
              userId: user.id,
              channel: p.channel,
              eventType: p.eventType,
            },
          },
          update: { enabled: p.enabled },
          create: { userId: user.id, channel: p.channel, eventType: p.eventType, enabled: p.enabled },
        })
      )
    );
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: user.id } });
    res.json(prefs);
  } catch {
    res.status(500).json({ error: 'Erro ao salvar preferências' });
  }
});

export default router;
