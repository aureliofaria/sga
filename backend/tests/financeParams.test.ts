// Fase 0 · Passo 12 — Parâmetros financeiros (teto + consumo + override + roteamento)
// Cobre: CRUD do teto (autorização ADMIN/Líder I Financeiro vs. USER/Membro;
// validação de período e centavos), cálculo do consumido (janela UTC, mês de
// abertura, filtros de status/tipo/setor), override (substitui e limpa),
// auditoria e decidePaymentRouting.

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { computeSectorBudget, decidePaymentRouting } from '../src/services/financeBudget';
import { makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria um setor com nome dado (default 'Financeiro').
async function makeSector(name = 'Financeiro') {
  return prisma.sector.create({ data: { name } });
}

// Vincula um usuário a um setor com o nível informado.
async function addMember(sectorId: string, userId: string, level: string) {
  return prisma.sectorMember.create({
    data: { sectorId, userId, level, role: level === 'MEMBRO' ? 'PROTETOR' : 'LIDER' },
  });
}

// Cria uma solicitação COMPLETED de um fluxo PAYMENT/PURCHASE com valor e data.
async function makePaidRequest(opts: {
  sectorId: string | null;
  flowType: string;
  amountCents: number | null;
  status?: string;
  createdAt?: Date;
}) {
  const initiator = await makeUser('USER');
  const flow = await prisma.flowTemplate.create({ data: { name: `${opts.flowType}-flow`, type: opts.flowType, isActive: true } });
  const req = await prisma.request.create({
    data: {
      flowId: flow.id,
      initiatorId: initiator.id,
      sectorId: opts.sectorId,
      title: 'Pedido',
      status: opts.status ?? 'COMPLETED',
      amountCents: opts.amountCents,
    },
  });
  // createdAt tem @default(now()); para testar a janela do mês, sobrescrevemos
  // via Prisma (que serializa DateTime para o formato esperado pelo SQLite).
  if (opts.createdAt) {
    await prisma.request.update({ where: { id: req.id }, data: { createdAt: opts.createdAt } });
  }
  return req;
}

describe('Parâmetros financeiros (Fase 0 · Passo 12)', () => {
  beforeEach(resetDb);

  // =========================================================================
  // CRUD do teto — autorização
  // =========================================================================
  describe('CRUD do teto — autorização', () => {
    it('ADMIN define teto → 200 com BudgetResult', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(admin.id)))
        .send({ ceilingCents: 100000 });
      expect(res.status).toBe(200);
      expect(res.body.hasParam).toBe(true);
      expect(res.body.ceilingCents).toBe(100000);
      expect(res.body.balanceCents).toBe(100000);
    });

    it('USER sem acesso → 403', async () => {
      const user = await makeUser('USER');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(user.id)))
        .send({ ceilingCents: 100000 });
      expect(res.status).toBe(403);
    });

    it('Líder I do Financeiro → 200', async () => {
      const lider = await makeUser('USER');
      const sector = await makeSector('Financeiro');
      await addMember(sector.id, lider.id, 'LIDER_1');
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(lider.id)))
        .send({ ceilingCents: 50000 });
      expect(res.status).toBe(200);
      expect(res.body.ceilingCents).toBe(50000);
    });

    it('Membro do Financeiro NÃO pode editar → 403', async () => {
      const membro = await makeUser('USER');
      const sector = await makeSector('Financeiro');
      await addMember(sector.id, membro.id, 'MEMBRO');
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(membro.id)))
        .send({ ceilingCents: 50000 });
      expect(res.status).toBe(403);
    });

    it('Líder I de OUTRO setor (não Financeiro) NÃO pode editar → 403', async () => {
      const lider = await makeUser('USER');
      const outro = await makeSector('RH');
      const alvo = await makeSector('Financeiro');
      await addMember(outro.id, lider.id, 'LIDER_1');
      const res = await request(app)
        .put(`/api/finance-params/${alvo.id}/2026/6`)
        .set(auth(tokenFor(lider.id)))
        .send({ ceilingCents: 50000 });
      expect(res.status).toBe(403);
    });

    it('Líder II do Financeiro NÃO pode editar (só LIDER_1) → 403', async () => {
      const lider2 = await makeUser('USER');
      const sector = await makeSector('Financeiro');
      await addMember(sector.id, lider2.id, 'LIDER_2');
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(lider2.id)))
        .send({ ceilingCents: 50000 });
      expect(res.status).toBe(403);
    });

    it('DIRETORIA pode editar → 200', async () => {
      const diretor = await makeUser('DIRETORIA');
      const sector = await makeSector('Financeiro');
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(diretor.id)))
        .send({ ceilingCents: 70000 });
      expect(res.status).toBe(200);
      expect(res.body.ceilingCents).toBe(70000);
    });

    it('ceilingCents ausente → 400', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(admin.id)))
        .send({});
      expect(res.status).toBe(400);
    });

    it('ceilingCents inválido (não numérico) → 400', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(admin.id)))
        .send({ ceilingCents: 'abc' });
      expect(res.status).toBe(400);
    });

    it('ceilingCents negativo → 400 (REF.3)', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6`)
        .set(auth(tokenFor(admin.id)))
        .send({ ceilingCents: -1 });
      expect(res.status).toBe(400);
    });

    it('mês 13 → 400', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/13`)
        .set(auth(tokenFor(admin.id)))
        .send({ ceilingCents: 100 });
      expect(res.status).toBe(400);
    });

    it('DELETE remove o parâmetro → 204 e mantém auditoria', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const del = await request(app).delete(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id)));
      expect(del.status).toBe(204);

      const param = await prisma.financeParam.findUnique({ where: { sectorId_year_month: { sectorId: sector.id, year: 2026, month: 6 } } });
      expect(param).toBeNull();

      // Auditoria preservada (UPSERTED + DELETED)
      const logs = await prisma.financeParamAuditLog.findMany({ where: { sectorId: sector.id } });
      expect(logs.map((l) => l.action)).toContain('FINANCE_PARAM_DELETED');
      expect(logs.map((l) => l.action)).toContain('FINANCE_PARAM_UPSERTED');
    });
  });

  // =========================================================================
  // Cálculo do consumido
  // =========================================================================
  describe('cálculo do consumido', () => {
    it('sem teto → hasParam:false e saldo 0', async () => {
      const sector = await makeSector();
      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.hasParam).toBe(false);
      expect(budget.balanceCents).toBe(0);
      expect(budget.ceilingCents).toBe(0);
    });

    it('com teto e sem pedidos → consumido 0', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });
      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.consumedCents).toBe(0);
      expect(budget.balanceCents).toBe(100000);
    });

    it('3 COMPLETED PAYMENT do setor no mês → soma', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const dia = new Date(Date.UTC(2026, 5, 15));
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 1000, createdAt: dia });
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 2000, createdAt: dia });
      await makePaidRequest({ sectorId: sector.id, flowType: 'PURCHASE', amountCents: 3000, createdAt: dia });

      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.calculatedConsumedCents).toBe(6000);
      expect(budget.consumedCents).toBe(6000);
      expect(budget.balanceCents).toBe(94000);
    });

    it('pedido de OUTRO setor não conta', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const outro = await makeSector('RH');
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const dia = new Date(Date.UTC(2026, 5, 15));
      await makePaidRequest({ sectorId: outro.id, flowType: 'PAYMENT', amountCents: 5000, createdAt: dia });

      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.consumedCents).toBe(0);
    });

    it('tipo ONBOARDING não conta', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const dia = new Date(Date.UTC(2026, 5, 15));
      await makePaidRequest({ sectorId: sector.id, flowType: 'ONBOARDING', amountCents: 5000, createdAt: dia });

      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.consumedCents).toBe(0);
    });

    it('status IN_PROGRESS não conta', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const dia = new Date(Date.UTC(2026, 5, 15));
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 5000, status: 'IN_PROGRESS', createdAt: dia });

      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.consumedCents).toBe(0);
    });

    it('pedido do mês anterior não conta (janela UTC)', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      // 31/05/2026 23:00 UTC — mês anterior; e 01/07 00:00 — mês seguinte
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 5000, createdAt: new Date(Date.UTC(2026, 4, 31, 23, 0)) });
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 7000, createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0)) });
      // dentro do mês: 01/06 00:00 UTC
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 100, createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0)) });

      const budget = await computeSectorBudget(sector.id, 2026, 6);
      expect(budget.consumedCents).toBe(100);
    });
  });

  // =========================================================================
  // Override
  // =========================================================================
  describe('override', () => {
    it('override substitui o consumido calculado; null volta ao calculado', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const dia = new Date(Date.UTC(2026, 5, 15));
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 6000, createdAt: dia });

      // Define override
      const set = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6/override`)
        .set(auth(tokenFor(admin.id)))
        .send({ overrideConsumedCents: 9000 });
      expect(set.status).toBe(200);
      expect(set.body.consumedCents).toBe(9000);
      expect(set.body.calculatedConsumedCents).toBe(6000);
      expect(set.body.balanceCents).toBe(91000);

      // Limpa override → volta ao calculado
      const clear = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6/override`)
        .set(auth(tokenFor(admin.id)))
        .send({ overrideConsumedCents: null });
      expect(clear.status).toBe(200);
      expect(clear.body.consumedCents).toBe(6000);
      expect(clear.body.overrideConsumedCents).toBeNull();
    });

    it('override negativo → 400 (REF.3)', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6/override`)
        .set(auth(tokenFor(admin.id)))
        .send({ overrideConsumedCents: -5 });
      expect(res.status).toBe(400);
    });

    it('override em parâmetro inexistente → 404', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app)
        .put(`/api/finance-params/${sector.id}/2026/6/override`)
        .set(auth(tokenFor(admin.id)))
        .send({ overrideConsumedCents: 100 });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Auditoria
  // =========================================================================
  describe('auditoria', () => {
    it('UPSERTED, OVERRIDE_SET e OVERRIDE_CLEARED registram userId', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });
      await request(app).put(`/api/finance-params/${sector.id}/2026/6/override`).set(auth(tokenFor(admin.id))).send({ overrideConsumedCents: 500 });
      await request(app).put(`/api/finance-params/${sector.id}/2026/6/override`).set(auth(tokenFor(admin.id))).send({ overrideConsumedCents: null });

      const logs = await prisma.financeParamAuditLog.findMany({ where: { sectorId: sector.id }, orderBy: { createdAt: 'asc' } });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('FINANCE_PARAM_UPSERTED');
      expect(actions).toContain('FINANCE_OVERRIDE_SET');
      expect(actions).toContain('FINANCE_OVERRIDE_CLEARED');
      expect(logs.every((l) => l.userId === admin.id)).toBe(true);
    });
  });

  // =========================================================================
  // decidePaymentRouting
  // =========================================================================
  describe('decidePaymentRouting', () => {
    async function comTeto(ceilingCents: number, year = 2026, month = 6) {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      await request(app).put(`/api/finance-params/${sector.id}/${year}/${month}`).set(auth(tokenFor(admin.id))).send({ ceilingCents });
      return sector;
    }

    it('dentro do teto, com previsão e saldo → FINANCE_MEMBER', async () => {
      const sector = await comTeto(100000);
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 1000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_MEMBER');
    });

    it('valor supera o teto → FINANCE_LEADER', async () => {
      const sector = await comTeto(1000);
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 5000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_LEADER');
      expect(r.reason).toBe('Supera o teto');
    });

    it('sem previsão → FINANCE_LEADER', async () => {
      const sector = await comTeto(100000);
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 1000, year: 2026, month: 6, hasForecast: false });
      expect(r.target).toBe('FINANCE_LEADER');
      expect(r.reason).toBe('Sem previsão');
    });

    it('saldo insuficiente → FINANCE_LEADER', async () => {
      const sector = await comTeto(10000);
      const dia = new Date(Date.UTC(2026, 5, 10));
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 9000, createdAt: dia });
      // saldo = 10000 - 9000 = 1000 < 5000
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 5000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_LEADER');
      expect(r.reason).toBe('Saldo insuficiente');
    });

    it('sem teto cadastrado → FINANCE_LEADER', async () => {
      const sector = await makeSector();
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 1000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_LEADER');
      expect(r.reason).toBe('Sem teto cadastrado');
    });

    it('limite: amount == teto, saldo cheio → FINANCE_MEMBER (não "supera")', async () => {
      const sector = await comTeto(5000);
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 5000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_MEMBER');
    });

    it('limite: saldo == amount (consumido deixa exatamente o valor) → FINANCE_MEMBER', async () => {
      const sector = await comTeto(10000);
      const dia = new Date(Date.UTC(2026, 5, 10));
      await makePaidRequest({ sectorId: sector.id, flowType: 'PAYMENT', amountCents: 6000, createdAt: dia });
      // saldo = 10000 - 6000 = 4000; amount = 4000 → balance < amount é FALSO → MEMBER
      const r = await decidePaymentRouting({ sectorId: sector.id, amountCents: 4000, year: 2026, month: 6, hasForecast: true });
      expect(r.target).toBe('FINANCE_MEMBER');
    });
  });

  // =========================================================================
  // Visibilidade (GET)
  // =========================================================================
  describe('visibilidade GET', () => {
    it('Membro do Financeiro pode ver → 200', async () => {
      const admin = await makeUser('ADMIN');
      const membro = await makeUser('USER');
      const sector = await makeSector('Financeiro');
      await addMember(sector.id, membro.id, 'MEMBRO');
      await request(app).put(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id))).send({ ceilingCents: 100000 });

      const res = await request(app).get(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(membro.id)));
      expect(res.status).toBe(200);
      expect(res.body.hasParam).toBe(true);
    });

    it('usuário sem relação com o Financeiro → 403', async () => {
      const estranho = await makeUser('USER');
      const sector = await makeSector('Financeiro');
      const res = await request(app).get(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(estranho.id)));
      expect(res.status).toBe(403);
    });

    it('ADMIN pode ver → 200 (mesmo sem parâmetro: hasParam:false, não 404)', async () => {
      const admin = await makeUser('ADMIN');
      const sector = await makeSector();
      const res = await request(app).get(`/api/finance-params/${sector.id}/2026/6`).set(auth(tokenFor(admin.id)));
      expect(res.status).toBe(200);
      expect(res.body.hasParam).toBe(false);
    });
  });
});
