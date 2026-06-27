import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { parseCents } from '../lib/money';
import { isPaymentCategory, validatePaymentAmount } from '../lib/payments';
import { generateDueRecurrences } from '../services/recurrences';

const router = Router();

// Papéis autorizados a administrar recorrências de pagamento.
const RECURRENCE_ADMIN = ['ADMIN', 'FINANCE', 'MANAGER'];

const INTERVAL_UNITS = ['MONTH', 'WEEK'];

// Lista recorrências (papéis administrativos veem todas; demais, as próprias).
router.get('/recurrences', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const where = RECURRENCE_ADMIN.includes(req.user.role) ? {} : { initiatorId: req.user.id };
    const recs = await prisma.paymentRecurrence.findMany({
      where,
      include: { flow: { select: { id: true, name: true, type: true } } },
      orderBy: { nextRunAt: 'asc' },
    });
    res.json(recs);
  } catch {
    res.status(500).json({ error: 'Erro ao listar recorrências' });
  }
});

// Cria uma recorrência de pagamento.
router.post('/recurrences', authenticate, requireRole(...RECURRENCE_ADMIN), async (req: AuthRequest, res: Response) => {
  try {
    const { flowId, title, paymentCategory, amountCents, supplier, costCenter,
            justification, intervalUnit, intervalCount, nextRunAt } = req.body;

    if (!flowId || !title) { res.status(400).json({ error: 'Fluxo e título são obrigatórios' }); return; }
    const flow = await prisma.flowTemplate.findUnique({ where: { id: flowId } });
    if (!flow || flow.type !== 'PAYMENT') { res.status(400).json({ error: 'Fluxo de pagamento inválido' }); return; }

    if (!isPaymentCategory(paymentCategory)) { res.status(400).json({ error: 'Categoria de pagamento inválida' }); return; }

    const amount = parseCents(amountCents);
    if (!amount.ok) { res.status(400).json({ error: 'Valor (amountCents) inválido' }); return; }
    const amountError = validatePaymentAmount(amount.value);
    if (amountError) { res.status(400).json({ error: amountError }); return; }

    const unit = INTERVAL_UNITS.includes(intervalUnit) ? intervalUnit : 'MONTH';
    const count = Number.isInteger(intervalCount) && intervalCount > 0 ? intervalCount : 1;

    const next = nextRunAt ? new Date(nextRunAt) : new Date();
    if (Number.isNaN(next.getTime())) { res.status(400).json({ error: 'Data de próxima execução inválida' }); return; }

    if (!costCenter || !String(costCenter).trim()) { res.status(400).json({ error: 'O centro de custo é obrigatório' }); return; }
    if (!justification || !String(justification).trim()) { res.status(400).json({ error: 'A justificativa é obrigatória' }); return; }

    const rec = await prisma.paymentRecurrence.create({
      data: {
        flowId,
        initiatorId: req.user.id,
        title,
        paymentCategory,
        amountCents: amount.value as number,
        supplier: supplier ?? null,
        costCenter,
        justification,
        intervalUnit: unit,
        intervalCount: count,
        nextRunAt: next,
        isActive: true,
      },
    });
    res.status(201).json(rec);
  } catch {
    res.status(500).json({ error: 'Erro ao criar recorrência' });
  }
});

// Ativa/desativa ou ajusta uma recorrência. Só o criador ou papéis admin.
router.put('/recurrences/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const rec = await prisma.paymentRecurrence.findUnique({ where: { id: req.params.id } });
    if (!rec) { res.status(404).json({ error: 'Recorrência não encontrada' }); return; }
    if (rec.initiatorId !== req.user.id && !RECURRENCE_ADMIN.includes(req.user.role)) {
      res.status(403).json({ error: 'Acesso negado' }); return;
    }
    const { isActive, amountCents, title, supplier, costCenter, justification, intervalUnit, intervalCount, nextRunAt } = req.body;

    const data: any = {};
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (title != null) data.title = title;
    if (supplier !== undefined) data.supplier = supplier;
    if (costCenter != null) data.costCenter = costCenter;
    if (justification != null) data.justification = justification;
    if (intervalUnit != null) data.intervalUnit = INTERVAL_UNITS.includes(intervalUnit) ? intervalUnit : rec.intervalUnit;
    if (intervalCount != null) data.intervalCount = Number.isInteger(intervalCount) && intervalCount > 0 ? intervalCount : rec.intervalCount;
    if ('amountCents' in req.body) {
      const amount = parseCents(amountCents);
      if (!amount.ok) { res.status(400).json({ error: 'Valor (amountCents) inválido' }); return; }
      const amountError = validatePaymentAmount(amount.value);
      if (amountError) { res.status(400).json({ error: amountError }); return; }
      data.amountCents = amount.value;
    }
    if (nextRunAt != null) {
      const next = new Date(nextRunAt);
      if (Number.isNaN(next.getTime())) { res.status(400).json({ error: 'Data inválida' }); return; }
      data.nextRunAt = next;
    }

    const updated = await prisma.paymentRecurrence.update({ where: { id: rec.id }, data });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar recorrência' });
  }
});

// Dispara a geração das recorrências vencidas (manual; cron futuro). Admin/Finance.
router.post('/recurrences/run', authenticate, requireRole('ADMIN', 'FINANCE'), async (_req: AuthRequest, res: Response) => {
  try {
    const created = await generateDueRecurrences();
    res.json({ created });
  } catch {
    res.status(500).json({ error: 'Erro ao processar recorrências' });
  }
});

export default router;
