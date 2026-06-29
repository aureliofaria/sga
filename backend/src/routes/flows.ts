import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { parseCents } from '../lib/money';
import { isFieldType } from '../lib/fieldValidation';
import { SENSITIVE_TYPES, SensitiveType } from '../lib/fieldMasking';
import { validateConditionPayload } from '../lib/checklist';

const router = Router();

router.get('/', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const flows = await prisma.flowTemplate.findMany({
      include: {
        _count: { select: { steps: true } },
        sector: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(flows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxos' });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const flow = await prisma.flowTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        sector: { select: { id: true, name: true } },
        steps: {
          orderBy: { order: 'asc' },
          include: {
            authLevels: true,
            handlingSector: { select: { id: true, name: true } },
            activateOnSector: { select: { id: true, name: true } },
            formFields: { orderBy: { order: 'asc' } },
            checklistItems: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    if (!flow) { res.status(404).json({ error: 'Fluxo não encontrado' }); return; }
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar fluxo' });
  }
});

router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, type, scope, sectorId, isActive } = req.body;
    if (!name || !type) { res.status(400).json({ error: 'Nome e tipo são obrigatórios' }); return; }
    const flow = await prisma.flowTemplate.create({
      data: { name, description, type, scope: scope ?? 'INTRA', sectorId: sectorId || null, isActive: isActive ?? true },
    });
    res.status(201).json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao criar fluxo' });
  }
});

router.put('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, type, scope, sectorId, isActive } = req.body;
    const flow = await prisma.flowTemplate.update({
      where: { id: req.params.id },
      data: { name, description, type, scope, sectorId: sectorId || null, isActive },
      include: {
        sector: { select: { id: true, name: true } },
        steps: { orderBy: { order: 'asc' }, include: { authLevels: true, handlingSector: { select: { id: true, name: true } } } },
      },
    });
    res.json(flow);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar fluxo' });
  }
});

router.delete('/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.flowTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Fluxo removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover fluxo' });
  }
});

// Steps
router.post('/:id/steps', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, requiredRole, requiresAttachment, deadlineHours, slaExpiry, order,
            handlingSectorId, conditions, activateOnSectorId, collectsResources, statusLabel } = req.body;
    const maxOrder = await prisma.flowStep.aggregate({ where: { flowTemplateId: req.params.id }, _max: { order: true } });
    const nextOrder = order ?? ((maxOrder._max.order ?? -1) + 1);
    const step = await prisma.flowStep.create({
      data: {
        flowTemplateId: req.params.id, name, description, requiredRole,
        requiresAttachment: requiresAttachment ?? false, deadlineHours,
        slaExpiry: slaExpiry || 'KEEP_WITH_RESPONSIBLE',
        conditions: conditions || null,
        activateOnSectorId: activateOnSectorId || null,
        collectsResources: collectsResources ?? false,
        order: nextOrder, handlingSectorId: handlingSectorId || null,
        // Fase 0 · Passo 10: rótulo humano de exibição para esta etapa (opcional).
        statusLabel: (typeof statusLabel === 'string' && statusLabel.trim()) ? statusLabel.trim() : null,
      },
      include: {
        handlingSector: { select: { id: true, name: true } },
        activateOnSector: { select: { id: true, name: true } },
      },
    });
    res.status(201).json(step);
  } catch {
    res.status(500).json({ error: 'Erro ao criar etapa' });
  }
});

router.put('/:id/steps/:stepId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, requiredRole, requiresAttachment, deadlineHours, slaExpiry, order,
            handlingSectorId, conditions, activateOnSectorId, collectsResources, statusLabel } = req.body;
    // statusLabel: null explícito limpa o rótulo; string não-vazia atualiza; ausente mantém.
    const statusLabelData: { statusLabel?: string | null } = {};
    if ('statusLabel' in req.body) {
      statusLabelData.statusLabel = (typeof statusLabel === 'string' && statusLabel.trim())
        ? statusLabel.trim()
        : null;
    }
    const step = await prisma.flowStep.update({
      where: { id: req.params.stepId },
      data: {
        name, description, requiredRole, requiresAttachment, deadlineHours,
        slaExpiry: slaExpiry || 'KEEP_WITH_RESPONSIBLE',
        conditions: conditions || null,
        activateOnSectorId: activateOnSectorId || null,
        collectsResources: collectsResources ?? false,
        order, handlingSectorId: handlingSectorId || null,
        ...statusLabelData,
      },
      include: {
        handlingSector: { select: { id: true, name: true } },
        activateOnSector: { select: { id: true, name: true } },
      },
    });
    res.json(step);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar etapa' });
  }
});

router.delete('/:id/steps/:stepId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.flowStep.delete({ where: { id: req.params.stepId } });
    res.json({ message: 'Etapa removida com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover etapa' });
  }
});

// Auth levels
router.post('/:flowId/steps/:stepId/auth-levels', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, minValueCents, maxValueCents, requiredApprovers, approverRole, deadlineHours } = req.body;
    const min = parseCents(minValueCents);
    const max = parseCents(maxValueCents);
    if (!min.ok || !max.ok) { res.status(400).json({ error: 'Valor de alçada inválido' }); return; }
    const level = await prisma.authorizationLevel.create({
      data: {
        flowStepId: req.params.stepId,
        name,
        minValueCents: min.value,
        maxValueCents: max.value,
        requiredApprovers: requiredApprovers ?? 1,
        approverRole,
        deadlineHours,
      },
    });
    res.status(201).json(level);
  } catch {
    res.status(500).json({ error: 'Erro ao criar nível de autorização' });
  }
});

router.put('/:flowId/steps/:stepId/auth-levels/:levelId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, minValueCents, maxValueCents, requiredApprovers, approverRole, deadlineHours } = req.body;
    // Atualização parcial: só altera as faixas se vierem no corpo — campos
    // omitidos NÃO devem zerar a alçada configurada (Prisma ignora `undefined`).
    const data: Record<string, unknown> = { name, requiredApprovers, approverRole, deadlineHours };
    if ('minValueCents' in req.body) {
      const min = parseCents(minValueCents);
      if (!min.ok) { res.status(400).json({ error: 'minValueCents inválido' }); return; }
      data.minValueCents = min.value;
    }
    if ('maxValueCents' in req.body) {
      const max = parseCents(maxValueCents);
      if (!max.ok) { res.status(400).json({ error: 'maxValueCents inválido' }); return; }
      data.maxValueCents = max.value;
    }
    const level = await prisma.authorizationLevel.update({ where: { id: req.params.levelId }, data });
    res.json(level);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar nível de autorização' });
  }
});

router.delete('/:flowId/steps/:stepId/auth-levels/:levelId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.authorizationLevel.delete({ where: { id: req.params.levelId } });
    res.json({ message: 'Nível de autorização removido' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover nível de autorização' });
  }
});

// ===========================================================================
// Campos dinâmicos por etapa (Fase 0 · Passo 7) — definição (ADMIN).
// POST/PUT/DELETE /:flowId/steps/:stepId/fields.
// ===========================================================================

const KEY_RE = /^[a-z][a-z0-9_]*$/;

// Valida o payload de um FormField. Retorna { ok } e, em falha, status+erro.
// `requireType`: no POST o tipo é obrigatório; no PUT pode vir omitido.
function validateFieldPayload(
  body: any,
  opts: { requireType: boolean }
): { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string } {
  const data: Record<string, unknown> = {};

  if (body.key !== undefined) {
    if (typeof body.key !== 'string' || !KEY_RE.test(body.key)) {
      return { ok: false, status: 400, error: 'key inválida (use snake_case: ^[a-z][a-z0-9_]*$)' };
    }
    data.key = body.key;
  }

  if (opts.requireType || body.type !== undefined) {
    if (!isFieldType(body.type)) {
      return { ok: false, status: 400, error: 'type inválido' };
    }
    data.type = body.type;
  }

  // sensitiveType, se presente (e não-nulo), deve ser um SensitiveType válido.
  if (body.sensitiveType !== undefined && body.sensitiveType !== null) {
    if (!SENSITIVE_TYPES.includes(body.sensitiveType as SensitiveType)) {
      return { ok: false, status: 400, error: 'sensitiveType inválido' };
    }
    data.sensitiveType = body.sensitiveType;
  } else if (body.sensitiveType === null) {
    data.sensitiveType = null;
  }

  // SELECT exige options como JSON array válido.
  const effectiveType = (data.type as string | undefined) ?? undefined;
  if (effectiveType === 'SELECT' || (body.options !== undefined && body.options !== null)) {
    if (body.options === undefined || body.options === null) {
      if (effectiveType === 'SELECT') return { ok: false, status: 400, error: 'options (JSON array) é obrigatório para SELECT' };
    } else {
      let parsed: unknown;
      try {
        parsed = typeof body.options === 'string' ? JSON.parse(body.options) : body.options;
      } catch {
        return { ok: false, status: 400, error: 'options deve ser um JSON array válido' };
      }
      if (!Array.isArray(parsed)) return { ok: false, status: 400, error: 'options deve ser um JSON array' };
      // Armazena sempre como string JSON (coluna String?).
      data.options = JSON.stringify(parsed);
    }
  }

  if (body.label !== undefined) data.label = body.label;
  if (body.required !== undefined) data.required = !!body.required;
  if (body.order !== undefined) data.order = Number(body.order) || 0;

  // REF.1 — auto-sensibilidade só p/ CPF/RG: se o type final é CPF/RG e o ADMIN
  // não enviou sensitiveType, o servidor o seta igual ao type (defesa LGPD).
  // NÃO se aplica a MONEY (SALARY só quando o ADMIN setar explicitamente).
  const finalType = data.type as string | undefined;
  if ((finalType === 'CPF' || finalType === 'RG') && body.sensitiveType === undefined) {
    data.sensitiveType = finalType;
  }

  return { ok: true, data };
}

router.post('/:flowId/steps/:stepId/fields', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.label || typeof req.body.label !== 'string') { res.status(400).json({ error: 'label é obrigatório' }); return; }
    if (req.body.key === undefined) { res.status(400).json({ error: 'key é obrigatória' }); return; }
    const v = validateFieldPayload(req.body, { requireType: true });
    if (v.ok === false) { res.status(v.status).json({ error: v.error }); return; }
    const field = await prisma.formField.create({
      data: { flowStepId: req.params.stepId, ...(v.data as any) },
    });
    res.status(201).json(field);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Já existe um campo com esta key nesta etapa' }); return; }
    res.status(500).json({ error: 'Erro ao criar campo' });
  }
});

router.put('/:flowId/steps/:stepId/fields/:fieldId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    // Para validar SELECT/auto-sensibilidade com coerência, considera o tipo final
    // (o enviado ou o já persistido).
    const existing = await prisma.formField.findUnique({ where: { id: req.params.fieldId } });
    if (!existing) { res.status(404).json({ error: 'Campo não encontrado' }); return; }
    const effective = { ...req.body, type: req.body.type ?? existing.type };
    const v = validateFieldPayload(effective, { requireType: false });
    if (v.ok === false) { res.status(v.status).json({ error: v.error }); return; }
    // Não reescreve o type quando não enviado no corpo (mantém o persistido).
    if (req.body.type === undefined) delete (v.data as any).type;
    const field = await prisma.formField.update({ where: { id: req.params.fieldId }, data: v.data as any });
    res.json(field);
  } catch (e: any) {
    if (e?.code === 'P2002') { res.status(409).json({ error: 'Já existe um campo com esta key nesta etapa' }); return; }
    res.status(500).json({ error: 'Erro ao atualizar campo' });
  }
});

router.delete('/:flowId/steps/:stepId/fields/:fieldId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.formField.delete({ where: { id: req.params.fieldId } });
    res.json({ message: 'Campo removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover campo' });
  }
});

// ===========================================================================
// Checklist por etapa (Fase 0 · Passo 8) — definição (ADMIN).
// POST/PUT/DELETE /:flowId/steps/:stepId/checklist[/:itemId].
// Body POST: { label, order?, required?, condition? }.
// condition: JSON com type ∈ {resourceItem, fieldValue} — validado aqui.
// ===========================================================================

router.post('/:flowId/steps/:stepId/checklist', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { label, order, required, condition } = req.body;
    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label é obrigatório' }); return;
    }
    // Valida condição se presente.
    let conditionJson: string | null = null;
    if (condition !== undefined && condition !== null) {
      const v = validateConditionPayload(condition);
      if (v.ok === false) { res.status(400).json({ error: v.error }); return; }
      const parsed = JSON.parse(v.json);
      conditionJson = parsed === null ? null : v.json;
    }
    const item = await prisma.checklistItem.create({
      data: {
        flowStepId: req.params.stepId,
        label: label.trim(),
        order: order !== undefined ? Number(order) || 0 : 0,
        required: required !== undefined ? !!required : true,
        condition: conditionJson,
      },
    });
    res.status(201).json(item);
  } catch {
    res.status(500).json({ error: 'Erro ao criar item de checklist' });
  }
});

router.put('/:flowId/steps/:stepId/checklist/:itemId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.checklistItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing) { res.status(404).json({ error: 'Item de checklist não encontrado' }); return; }

    const data: Record<string, unknown> = {};
    if (req.body.label !== undefined) {
      if (typeof req.body.label !== 'string' || !req.body.label.trim()) {
        res.status(400).json({ error: 'label inválido' }); return;
      }
      data.label = req.body.label.trim();
    }
    if (req.body.order !== undefined) data.order = Number(req.body.order) || 0;
    if (req.body.required !== undefined) data.required = !!req.body.required;
    if ('condition' in req.body) {
      const v = validateConditionPayload(req.body.condition);
      if (v.ok === false) { res.status(400).json({ error: v.error }); return; }
      const parsed = JSON.parse(v.json);
      data.condition = parsed === null ? null : v.json;
    }

    const item = await prisma.checklistItem.update({ where: { id: req.params.itemId }, data });
    res.json(item);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar item de checklist' });
  }
});

router.delete('/:flowId/steps/:stepId/checklist/:itemId', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.checklistItem.delete({ where: { id: req.params.itemId } });
    res.json({ message: 'Item de checklist removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao remover item de checklist' });
  }
});

export default router;
