import { Router, Request as ExpressRequest, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { validateBody } from '../lib/validate';

const router = Router();

const authLevelSchema = z.object({
  name: z.string().min(1),
  minValueCents: z.number().int().nonnegative().nullish(),
  maxValueCents: z.number().int().nonnegative().nullish(),
  requiredApprovers: z.number().int().min(1).default(1),
  approverRole: z.string().min(1),
  deadlineHours: z.number().int().positive().nullish(),
});

const stepSchema = z.object({
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().optional(),
  requiredRole: z.string().optional(),
  requiredApprovers: z.number().int().min(1).default(1),
  requiresAttachment: z.boolean().default(false),
  deadlineHours: z.number().int().positive().nullish(),
  authLevels: z.array(authLevelSchema).default([]),
});

const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1),
  isActive: z.boolean().default(true),
  steps: z.array(stepSchema).min(1, 'O fluxo precisa de ao menos uma etapa'),
});

router.get('/', authenticate, async (_req: ExpressRequest, res: Response) => {
  try {
    const templates = await prisma.flowTemplate.findMany({
      include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(templates);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxos' });
  }
});

router.get('/:id', authenticate, async (req: ExpressRequest, res: Response) => {
  try {
    const template = await prisma.flowTemplate.findUnique({
      where: { id: req.params.id },
      include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
    });
    if (!template) {
      res.status(404).json({ error: 'Fluxo não encontrado' });
      return;
    }
    res.json(template);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxo' });
  }
});

router.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validateBody(templateSchema),
  async (req: ExpressRequest, res: Response) => {
    const body = req.body as z.infer<typeof templateSchema>;
    try {
      const template = await prisma.flowTemplate.create({
        data: {
          name: body.name,
          description: body.description,
          type: body.type,
          isActive: body.isActive,
          steps: {
            create: body.steps.map((s) => ({
              order: s.order,
              name: s.name,
              description: s.description,
              requiredRole: s.requiredRole,
              requiredApprovers: s.requiredApprovers,
              requiresAttachment: s.requiresAttachment,
              deadlineHours: s.deadlineHours ?? null,
              authLevels: {
                create: s.authLevels.map((a) => ({
                  name: a.name,
                  minValueCents: a.minValueCents ?? null,
                  maxValueCents: a.maxValueCents ?? null,
                  requiredApprovers: a.requiredApprovers,
                  approverRole: a.approverRole,
                  deadlineHours: a.deadlineHours ?? null,
                })),
              },
            })),
          },
        },
        include: { steps: { orderBy: { order: 'asc' }, include: { authLevels: true } } },
      });
      res.status(201).json(template);
    } catch {
      res.status(500).json({ error: 'Erro ao criar fluxo' });
    }
  }
);

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: ExpressRequest, res: Response) => {
  try {
    const { name, description, type, isActive } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (type !== undefined) data.type = type;
    if (isActive !== undefined) data.isActive = isActive;
    const template = await prisma.flowTemplate.update({ where: { id: req.params.id }, data });
    res.json(template);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar fluxo' });
  }
});

export default router;
