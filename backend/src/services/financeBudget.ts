// ============================================================================
// Orçamento financeiro por setor (Fase 0 · Passo 12)
//
// Calcula o teto, o consumido e o saldo de um setor em um determinado mês, e
// decide o roteamento de aprovação de um pagamento (Membro vs. Líder do
// Financeiro) conforme as regras de negócio confirmadas pelo CEO.
//
// Dinheiro SEMPRE em centavos inteiros.
//
// REF.1 (simplificação V0): o "consumido" é contado pelo MÊS DE ABERTURA da
// solicitação (Request.createdAt). Ou seja, um pedido conta no mês em que foi
// criado, ainda que sua deferição/conclusão ocorra em outro mês. A precisão de
// "mês da deferição" (data em que o pedido foi efetivamente concluído) é um
// refinamento futuro deliberadamente adiado nesta versão.
// ============================================================================

import prisma from '../lib/prisma';

export interface BudgetResult {
  ceilingCents: number;
  consumedCents: number;
  calculatedConsumedCents: number;
  overrideConsumedCents: number | null;
  balanceCents: number;
  hasParam: boolean;
}

type Db = typeof prisma;

/**
 * Calcula o orçamento (teto, consumido, saldo) de um setor em um mês.
 *
 * Quando não há FinanceParam cadastrado para (sectorId, year, month), retorna
 * `hasParam:false` com todos os valores zerados (não lança).
 *
 * @param db cliente Prisma (injetável para transações/testes; default: prisma).
 */
export async function computeSectorBudget(
  sectorId: string,
  year: number,
  month: number,
  db: Db = prisma
): Promise<BudgetResult> {
  const param = await db.financeParam.findUnique({
    where: { sectorId_year_month: { sectorId, year, month } },
  });

  if (!param) {
    return {
      hasParam: false,
      ceilingCents: 0,
      consumedCents: 0,
      calculatedConsumedCents: 0,
      overrideConsumedCents: null,
      balanceCents: 0,
    };
  }

  // REF.2: janela do mês em UTC, para que o cálculo independa do fuso do servidor.
  // [start, end) cobre exatamente o mês (year, month).
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  // Consumido calculado: soma de amountCents das solicitações CONCLUÍDAS de
  // fluxos de PAGAMENTO/COMPRA, do setor, abertas (createdAt — ver REF.1) no mês.
  const agg = await db.request.aggregate({
    _sum: { amountCents: true },
    where: {
      sectorId,
      status: 'COMPLETED',
      flow: { type: { in: ['PAYMENT', 'PURCHASE'] } },
      createdAt: { gte: start, lt: end },
      amountCents: { not: null },
    },
  });

  const calculatedConsumedCents = agg._sum.amountCents ?? 0;
  const overrideConsumedCents = param.overrideConsumedCents ?? null;
  // Override manual, quando presente, SUBSTITUI o consumido calculado.
  const consumedCents = overrideConsumedCents ?? calculatedConsumedCents;
  const balanceCents = param.ceilingCents - consumedCents;

  return {
    hasParam: true,
    ceilingCents: param.ceilingCents,
    consumedCents,
    calculatedConsumedCents,
    overrideConsumedCents,
    balanceCents,
  };
}

export interface PaymentRoutingInput {
  sectorId: string;
  amountCents: number;
  year: number;
  month: number;
  // Previsão de fluxo de caixa para o pagamento. Será preenchido pela integração
  // do Pagador (PR #9); por ora é fornecido pelo chamador.
  hasForecast: boolean;
}

export interface PaymentRoutingResult {
  target: 'FINANCE_MEMBER' | 'FINANCE_LEADER';
  reason: string;
}

/**
 * Decide para quem roteia a aprovação de um pagamento dentro do Financeiro.
 *
 * Encaminha ao LÍDER (FINANCE_LEADER) quando há qualquer fator de exceção:
 * ausência de teto cadastrado, ausência de previsão, valor que supera o teto,
 * ou saldo insuficiente. Caso contrário, fica com o MEMBRO (FINANCE_MEMBER).
 *
 * @param hasForecast será preenchido pela integração do Pagador (PR #9).
 * @param db cliente Prisma (injetável; default: prisma).
 */
export async function decidePaymentRouting(
  input: PaymentRoutingInput,
  db: Db = prisma
): Promise<PaymentRoutingResult> {
  const { sectorId, amountCents, year, month, hasForecast } = input;
  const budget = await computeSectorBudget(sectorId, year, month, db);

  if (!budget.hasParam) {
    return { target: 'FINANCE_LEADER', reason: 'Sem teto cadastrado' };
  }
  if (!hasForecast) {
    return { target: 'FINANCE_LEADER', reason: 'Sem previsão' };
  }
  if (amountCents > budget.ceilingCents) {
    return { target: 'FINANCE_LEADER', reason: 'Supera o teto' };
  }
  if (budget.balanceCents < amountCents) {
    return { target: 'FINANCE_LEADER', reason: 'Saldo insuficiente' };
  }
  return { target: 'FINANCE_MEMBER', reason: 'Dentro do teto, com previsão e saldo' };
}
