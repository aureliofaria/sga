// ============================================================================
// Rotas de parâmetros financeiros (Fase 0 · Passo 12)
//
// CRUD do teto mensal por setor + override manual do consumido, com auditoria
// dedicada (FinanceParamAuditLog). Autorização em dois níveis (ver vs. editar)
// resolvida em lib/financeParams.ts. Valores monetários SEMPRE em centavos,
// validados por parseCents e exigidos >= 0 (REF.3).
// ============================================================================

import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { parseCents } from '../lib/money';
import { canEditFinanceParams, canViewFinanceParams } from '../lib/financeParams';
import { computeSectorBudget } from '../services/financeBudget';

const router = Router();

// Valida ano (inteiro 2000–2100) e mês (1–12). Retorna null se inválido.
function parsePeriod(rawYear: unknown, rawMonth: unknown): { year: number; month: number } | null {
  const year = Number(rawYear);
  const month = Number(rawMonth);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

// REF.3: valida centavos via parseCents E exige >= 0 (parseCents sozinho não
// barra negativo). Retorna { ok, value } — value é number (>= 0).
function parseNonNegativeCents(raw: unknown): { ok: boolean; value: number } {
  const parsed = parseCents(raw);
  if (!parsed.ok || parsed.value == null || parsed.value < 0) return { ok: false, value: 0 };
  return { ok: true, value: parsed.value };
}

async function logAudit(
  data: { sectorId: string; year: number; month: number; userId: string; userName: string; action: string; details?: unknown },
  db: typeof prisma = prisma
) {
  await db.financeParamAuditLog.create({
    data: {
      sectorId: data.sectorId,
      year: data.year,
      month: data.month,
      userId: data.userId,
      userName: data.userName,
      action: data.action,
      details: data.details === undefined ? null : JSON.stringify(data.details),
    },
  });
}

// ---------------------------------------------------------------------------
// GET / — lista de parâmetros (com BudgetResult por linha). Filtros opcionais
// por sectorId/year/month na query.
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canViewFinanceParams(req.user))) { res.status(403).json({ error: 'Acesso negado' }); return; }

    const where: { sectorId?: string; year?: number; month?: number } = {};
    if (req.query.sectorId) where.sectorId = String(req.query.sectorId);
    if (req.query.year !== undefined) where.year = Number(req.query.year);
    if (req.query.month !== undefined) where.month = Number(req.query.month);

    const params = await prisma.financeParam.findMany({
      where,
      include: { sector: { select: { id: true, name: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const rows = await Promise.all(
      params.map(async (p) => ({
        id: p.id,
        sectorId: p.sectorId,
        sector: p.sector,
        year: p.year,
        month: p.month,
        updatedById: p.updatedById,
        updatedAt: p.updatedAt,
        budget: await computeSectorBudget(p.sectorId, p.year, p.month),
      }))
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Erro ao listar parâmetros financeiros' });
  }
});

// ---------------------------------------------------------------------------
// GET /:sectorId/:year/:month — BudgetResult do setor no mês. Responde 200
// mesmo quando não há parâmetro cadastrado (hasParam:false), não 404.
// ---------------------------------------------------------------------------
router.get('/:sectorId/:year/:month', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canViewFinanceParams(req.user))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const period = parsePeriod(req.params.year, req.params.month);
    if (!period) { res.status(400).json({ error: 'Período inválido (ano 2000–2100, mês 1–12)' }); return; }

    const budget = await computeSectorBudget(req.params.sectorId, period.year, period.month);
    res.json(budget);
  } catch {
    res.status(500).json({ error: 'Erro ao consultar orçamento' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:sectorId/:year/:month — upsert do teto. Body { ceilingCents }.
// ---------------------------------------------------------------------------
router.put('/:sectorId/:year/:month', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canEditFinanceParams(req.user))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const period = parsePeriod(req.params.year, req.params.month);
    if (!period) { res.status(400).json({ error: 'Período inválido (ano 2000–2100, mês 1–12)' }); return; }

    const ceiling = parseNonNegativeCents(req.body?.ceilingCents);
    if (!ceiling.ok) { res.status(400).json({ error: 'ceilingCents inválido (centavos inteiros >= 0)' }); return; }

    const { sectorId } = req.params;
    const { year, month } = period;

    const before = await prisma.financeParam.findUnique({ where: { sectorId_year_month: { sectorId, year, month } } });

    const param = await prisma.financeParam.upsert({
      where: { sectorId_year_month: { sectorId, year, month } },
      update: { ceilingCents: ceiling.value, updatedById: req.user.id },
      create: { sectorId, year, month, ceilingCents: ceiling.value, updatedById: req.user.id },
    });

    await logAudit({
      sectorId, year, month,
      userId: req.user.id, userName: req.user.name,
      action: 'FINANCE_PARAM_UPSERTED',
      details: {
        before: before ? { ceilingCents: before.ceilingCents } : null,
        after: { ceilingCents: param.ceilingCents },
      },
    });

    const budget = await computeSectorBudget(sectorId, year, month);
    res.json(budget);
  } catch {
    res.status(500).json({ error: 'Erro ao salvar teto' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:sectorId/:year/:month/override — define/limpa o override do consumido.
// Body { overrideConsumedCents: number | null }. 404 se o FinanceParam não existe.
// ---------------------------------------------------------------------------
router.put('/:sectorId/:year/:month/override', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canEditFinanceParams(req.user))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const period = parsePeriod(req.params.year, req.params.month);
    if (!period) { res.status(400).json({ error: 'Período inválido (ano 2000–2100, mês 1–12)' }); return; }

    const { sectorId } = req.params;
    const { year, month } = period;

    const existing = await prisma.financeParam.findUnique({ where: { sectorId_year_month: { sectorId, year, month } } });
    if (!existing) { res.status(404).json({ error: 'Parâmetro financeiro não encontrado' }); return; }

    const raw = req.body?.overrideConsumedCents;
    const clearing = raw === null || raw === undefined || raw === '';

    let overrideValue: number | null = null;
    if (!clearing) {
      const parsed = parseNonNegativeCents(raw);
      if (!parsed.ok) { res.status(400).json({ error: 'overrideConsumedCents inválido (centavos inteiros >= 0)' }); return; }
      overrideValue = parsed.value;
    }

    const param = await prisma.financeParam.update({
      where: { sectorId_year_month: { sectorId, year, month } },
      data: { overrideConsumedCents: overrideValue, updatedById: req.user.id },
    });

    await logAudit({
      sectorId, year, month,
      userId: req.user.id, userName: req.user.name,
      action: clearing ? 'FINANCE_OVERRIDE_CLEARED' : 'FINANCE_OVERRIDE_SET',
      details: {
        before: { overrideConsumedCents: existing.overrideConsumedCents },
        after: { overrideConsumedCents: param.overrideConsumedCents },
      },
    });

    const budget = await computeSectorBudget(sectorId, year, month);
    res.json(budget);
  } catch {
    res.status(500).json({ error: 'Erro ao definir override' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:sectorId/:year/:month — remove o FinanceParam (mantém a auditoria).
// ---------------------------------------------------------------------------
router.delete('/:sectorId/:year/:month', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canEditFinanceParams(req.user))) { res.status(403).json({ error: 'Acesso negado' }); return; }
    const period = parsePeriod(req.params.year, req.params.month);
    if (!period) { res.status(400).json({ error: 'Período inválido (ano 2000–2100, mês 1–12)' }); return; }

    const { sectorId } = req.params;
    const { year, month } = period;

    const existing = await prisma.financeParam.findUnique({ where: { sectorId_year_month: { sectorId, year, month } } });
    if (!existing) { res.status(404).json({ error: 'Parâmetro financeiro não encontrado' }); return; }

    await prisma.financeParam.delete({ where: { sectorId_year_month: { sectorId, year, month } } });

    await logAudit({
      sectorId, year, month,
      userId: req.user.id, userName: req.user.name,
      action: 'FINANCE_PARAM_DELETED',
      details: { before: { ceilingCents: existing.ceilingCents, overrideConsumedCents: existing.overrideConsumedCents }, after: null },
    });

    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Erro ao remover parâmetro financeiro' });
  }
});

export default router;
