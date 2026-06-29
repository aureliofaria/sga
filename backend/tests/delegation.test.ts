// Fase 0 · Passo 13 — Suplência/delegação do Líder I (gestão + gate financeiro)
// Cobre: PUT/DELETE da delegação (autorização Líder I/ADMIN; validação de
// suplente e prazo) e a suplência EFETIVA no canEditFinanceParams (Líder II do
// Financeiro com delegação vigente passa a poder editar; expirada/limpa volta a
// 403). Regressão da visibilidade por suplência vive em visibility.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 1000).toISOString();

async function makeSector(name: string) {
  return prisma.sector.create({ data: { name } });
}
async function addMember(sectorId: string, userId: string, level: string, reportsToId?: string) {
  return prisma.sectorMember.create({
    data: { sectorId, userId, level, role: level === 'MEMBRO' ? 'PROTETOR' : 'LIDER', reportsToId: reportsToId ?? null },
  });
}

describe('Suplência/delegação do Líder I (Fase 0 · Passo 13)', () => {
  beforeEach(resetDb);

  // =========================================================================
  // Gestão da delegação (PUT/DELETE)
  // =========================================================================
  describe('gestão da delegação', () => {
    it('PUT pelo Líder I do setor → 200 e grava delegateToId/delegateUntil na linha do Líder I', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      const l2 = await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: l2u.id, until: future() });

      expect(res.status).toBe(200);
      expect(res.body.delegateToId).toBe(l2.id);
      expect(res.body.delegateUntil).not.toBeNull();

      const row = await prisma.sectorMember.findUnique({ where: { id: l1.id } });
      expect(row?.delegateToId).toBe(l2.id);
      expect(row?.delegateUntil).not.toBeNull();
    });

    it('concessão e revogação gravam trilha PERSISTENTE em DelegationAuditLog', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      const l2 = await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      await request(app).put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id))).send({ delegateUserId: l2u.id, until: future() });
      const setLog = await prisma.delegationAuditLog.findFirst({ where: { sectorId: sector.id, action: 'DELEGATION_SET' } });
      expect(setLog).toBeTruthy();
      expect(setLog?.delegateMemberId).toBe(l2.id);
      expect(setLog?.delegateUserId).toBe(l2u.id);
      expect(setLog?.byUserId).toBe(l1u.id);
      expect(setLog?.until).not.toBeNull();

      await request(app).delete(`/api/sectors/${sector.id}/delegation`).set(auth(tokenFor(l1u.id)));
      const clearLog = await prisma.delegationAuditLog.findFirst({ where: { sectorId: sector.id, action: 'DELEGATION_CLEARED' } });
      expect(clearLog).toBeTruthy();
      expect(clearLog?.byUserId).toBe(l1u.id);
    });

    it('PUT por ADMIN → 200', async () => {
      const admin = await makeUser('ADMIN');
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      const l2 = await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(admin.id)))
        .send({ delegateUserId: l2u.id, until: future() });

      expect(res.status).toBe(200);
      expect(res.body.delegateToId).toBe(l2.id);
    });

    it('PUT por Membro → 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const memU = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);
      await addMember(sector.id, memU.id, 'MEMBRO', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(memU.id)))
        .send({ delegateUserId: l2u.id, until: future() });
      expect(res.status).toBe(403);
    });

    it('PUT por Líder II (não titular) → 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l2u.id)))
        .send({ delegateUserId: l2u.id, until: future() });
      expect(res.status).toBe(403);
    });

    it('PUT por estranho ao setor → 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const estranho = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(estranho.id)))
        .send({ delegateUserId: l2u.id, until: future() });
      expect(res.status).toBe(403);
    });

    it('delegar a um Membro (não Líder II) → 400', async () => {
      const l1u = await makeUser('USER');
      const memU = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      await addMember(sector.id, memU.id, 'MEMBRO', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: memU.id, until: future() });
      expect(res.status).toBe(400);
    });

    it('delegar a um Líder II de OUTRO setor → 400', async () => {
      const l1u = await makeUser('USER');
      const l2outro = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const outro = await makeSector('RH');
      await addMember(sector.id, l1u.id, 'LIDER_1');
      const l1outro = await addMember(outro.id, await makeUser('USER').then((u) => u.id), 'LIDER_1');
      await addMember(outro.id, l2outro.id, 'LIDER_2', l1outro.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: l2outro.id, until: future() });
      expect(res.status).toBe(400);
    });

    it('delegar ao próprio Líder I → 400', async () => {
      const l1u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      await addMember(sector.id, l1u.id, 'LIDER_1');

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: l1u.id, until: future() });
      expect(res.status).toBe(400);
    });

    it('until no passado → 400', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      const res = await request(app)
        .put(`/api/sectors/${sector.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: l2u.id, until: past() });
      expect(res.status).toBe(400);
    });

    it('DELETE limpa a delegação → 200 e zera os campos', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const sector = await makeSector('Comercial');
      const l1 = await addMember(sector.id, l1u.id, 'LIDER_1');
      const l2 = await addMember(sector.id, l2u.id, 'LIDER_2', l1.id);

      await request(app).put(`/api/sectors/${sector.id}/delegation`).set(auth(tokenFor(l1u.id))).send({ delegateUserId: l2u.id, until: future() });

      const del = await request(app).delete(`/api/sectors/${sector.id}/delegation`).set(auth(tokenFor(l1u.id)));
      expect(del.status).toBe(200);
      expect(del.body.delegateToId).toBeNull();
      expect(del.body.delegateUntil).toBeNull();

      const row = await prisma.sectorMember.findUnique({ where: { id: l1.id } });
      expect(row?.delegateToId).toBeNull();
      expect(row?.delegateUntil).toBeNull();
      // sanity: a linha do suplente nunca foi tocada
      const l2row = await prisma.sectorMember.findUnique({ where: { id: l2.id } });
      expect(l2row?.delegateToId).toBeNull();
    });

    it('DELETE por estranho → 403', async () => {
      const l1u = await makeUser('USER');
      const estranho = await makeUser('USER');
      const sector = await makeSector('Comercial');
      await addMember(sector.id, l1u.id, 'LIDER_1');

      const del = await request(app).delete(`/api/sectors/${sector.id}/delegation`).set(auth(tokenFor(estranho.id)));
      expect(del.status).toBe(403);
    });
  });

  // =========================================================================
  // Suplência efetiva no gate financeiro (canEditFinanceParams)
  // =========================================================================
  describe('suplência efetiva no gate financeiro', () => {
    it('Líder II do Financeiro com delegação vigente PASSA a editar finance-params (PUT teto → 200)', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const fin = await makeSector('Financeiro');
      const l1 = await addMember(fin.id, l1u.id, 'LIDER_1');
      await addMember(fin.id, l2u.id, 'LIDER_2', l1.id);

      // Antes da delegação: Líder II não pode editar.
      const antes = await request(app)
        .put(`/api/finance-params/${fin.id}/2026/6`)
        .set(auth(tokenFor(l2u.id)))
        .send({ ceilingCents: 50000 });
      expect(antes.status).toBe(403);

      // Líder I delega ao Líder II.
      const set = await request(app)
        .put(`/api/sectors/${fin.id}/delegation`)
        .set(auth(tokenFor(l1u.id)))
        .send({ delegateUserId: l2u.id, until: future() });
      expect(set.status).toBe(200);

      // Agora o suplente edita.
      const depois = await request(app)
        .put(`/api/finance-params/${fin.id}/2026/6`)
        .set(auth(tokenFor(l2u.id)))
        .send({ ceilingCents: 50000 });
      expect(depois.status).toBe(200);
      expect(depois.body.ceilingCents).toBe(50000);
    });

    it('após DELETE da delegação, o ex-suplente volta a 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const fin = await makeSector('Financeiro');
      const l1 = await addMember(fin.id, l1u.id, 'LIDER_1');
      await addMember(fin.id, l2u.id, 'LIDER_2', l1.id);

      await request(app).put(`/api/sectors/${fin.id}/delegation`).set(auth(tokenFor(l1u.id))).send({ delegateUserId: l2u.id, until: future() });
      const ok = await request(app).put(`/api/finance-params/${fin.id}/2026/6`).set(auth(tokenFor(l2u.id))).send({ ceilingCents: 50000 });
      expect(ok.status).toBe(200);

      await request(app).delete(`/api/sectors/${fin.id}/delegation`).set(auth(tokenFor(l1u.id)));

      const depois = await request(app).put(`/api/finance-params/${fin.id}/2026/7`).set(auth(tokenFor(l2u.id))).send({ ceilingCents: 50000 });
      expect(depois.status).toBe(403);
    });

    it('delegação EXPIRADA não concede edição → 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const fin = await makeSector('Financeiro');
      const l1 = await addMember(fin.id, l1u.id, 'LIDER_1');
      const l2 = await addMember(fin.id, l2u.id, 'LIDER_2', l1.id);

      // Grava direto uma delegação já expirada (PUT recusaria data passada).
      await prisma.sectorMember.update({
        where: { id: l1.id },
        data: { delegateToId: l2.id, delegateUntil: new Date(Date.now() - 1000) },
      });

      const res = await request(app).put(`/api/finance-params/${fin.id}/2026/6`).set(auth(tokenFor(l2u.id))).send({ ceilingCents: 50000 });
      expect(res.status).toBe(403);
    });

    it('suplência em OUTRO setor não vaza para o Financeiro → 403', async () => {
      const l1u = await makeUser('USER');
      const l2u = await makeUser('USER');
      const outro = await makeSector('Comercial');
      const fin = await makeSector('Financeiro');
      const l1 = await addMember(outro.id, l1u.id, 'LIDER_1');
      await addMember(outro.id, l2u.id, 'LIDER_2', l1.id);

      // Delegação vigente no setor Comercial.
      await request(app).put(`/api/sectors/${outro.id}/delegation`).set(auth(tokenFor(l1u.id))).send({ delegateUserId: l2u.id, until: future() });

      // O suplente não tem relação com o Financeiro → não pode editar finance-params.
      const res = await request(app).put(`/api/finance-params/${fin.id}/2026/6`).set(auth(tokenFor(l2u.id))).send({ ceilingCents: 50000 });
      expect(res.status).toBe(403);
    });
  });
});
