// Fase 0 · Passo 9 — Subfluxo pai↔filho
// Cobre: criação vinculada, autorização via canViewRequest, protocolo automático
// (AuditLog SUBFLOW_OPENED + Comment no pai), exposição via GET /:id e regressão.

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cria uma solicitação mínima (sem subfluxo) diretamente no banco.
async function makeRequest(flowId: string, initiatorId: string, title = 'pai') {
  return prisma.request.create({
    data: { flowId, initiatorId, title, status: 'IN_PROGRESS', currentStep: 0 },
  });
}

describe('subfluxo pai↔filho (Fase 0 · Passo 9)', () => {
  beforeEach(resetDb);

  // ------------------------------------------------------------------
  // Caso nominal: criar filho com parentRequestId válido e com acesso
  // ------------------------------------------------------------------
  it('cria filho com parentRequestId válido → 201; parentRequestId setado; pai tem filho; AuditLog e Comment no pai', async () => {
    const usuario = await makeUser('USER');
    const flowPai = await makeFlow('HIRING', [{ order: 0 }]);
    const flowFilho = await makeFlow('PURCHASE', [{ order: 0 }]);

    const pai = await makeRequest(flowPai.id, usuario.id, 'Vaga engenheiro');

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(usuario.id)))
      .send({ flowId: flowFilho.id, title: 'Compra notebook', parentRequestId: pai.id });

    expect(res.status).toBe(201);
    expect(res.body.parentRequestId).toBe(pai.id);

    // Pai deve listar o filho nos children
    const paiAtualizado = await prisma.request.findUniqueOrThrow({
      where: { id: pai.id },
      include: { children: true },
    });
    expect(paiAtualizado.children).toHaveLength(1);
    expect(paiAtualizado.children[0].id).toBe(res.body.id);

    // AuditLog SUBFLOW_OPENED no pai
    const audit = await prisma.auditLog.findFirst({
      where: { requestId: pai.id, action: 'SUBFLOW_OPENED' },
    });
    expect(audit).not.toBeNull();
    const details = JSON.parse(audit!.details ?? '{}');
    expect(details.childId).toBe(res.body.id);
    expect(details.childTitle).toBe('Compra notebook');
    expect(details.childType).toBe('PURCHASE');

    // Comment no pai com protocolo
    const comment = await prisma.comment.findFirst({
      where: { requestId: pai.id },
    });
    expect(comment).not.toBeNull();
    expect(comment!.body).toContain('Compra notebook');
    expect(comment!.body).toContain(res.body.id);
    expect(comment!.authorId).toBe(usuario.id);
  });

  // ------------------------------------------------------------------
  // parentRequestId inexistente → 404
  // ------------------------------------------------------------------
  it('parentRequestId inexistente → 404', async () => {
    const usuario = await makeUser('USER');
    const flow = await makeFlow('PURCHASE', [{ order: 0 }]);

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(usuario.id)))
      .send({ flowId: flow.id, title: 'Filho órfão', parentRequestId: 'id-inexistente-xxxx' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Solicitação pai não encontrada');
  });

  // ------------------------------------------------------------------
  // Solicitante NÃO pode ver o pai → 403
  // ------------------------------------------------------------------
  it('solicitante sem acesso ao pai → 403', async () => {
    const dono = await makeUser('USER', 'dono');
    const forasteiro = await makeUser('USER', 'forasteiro');
    const flowPai = await makeFlow('HIRING', [{ order: 0 }]);
    const flowFilho = await makeFlow('PURCHASE', [{ order: 0 }]);

    // Pai pertence exclusivamente ao dono (forasteiro não envolvido)
    const pai = await makeRequest(flowPai.id, dono.id, 'Vaga sigilosa');

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(forasteiro.id)))
      .send({ flowId: flowFilho.id, title: 'Tentativa de filho', parentRequestId: pai.id });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Sem acesso à solicitação pai');
  });

  // ------------------------------------------------------------------
  // GET /:id do pai expõe children; do filho expõe parentRequestId
  // ------------------------------------------------------------------
  it('GET do pai expõe children com id/title/status/flow.type; GET do filho expõe parentRequestId', async () => {
    const usuario = await makeUser('USER');
    const flowPai = await makeFlow('HIRING', [{ order: 0 }]);
    const flowFilho = await makeFlow('PURCHASE', [{ order: 0 }]);

    const pai = await makeRequest(flowPai.id, usuario.id, 'Vaga RH');
    const filho = await prisma.request.create({
      data: { flowId: flowFilho.id, initiatorId: usuario.id, title: 'Compra uniforme', status: 'IN_PROGRESS', currentStep: 0, parentRequestId: pai.id },
    });

    const resPai = await request(app)
      .get(`/api/requests/${pai.id}`)
      .set(auth(tokenFor(usuario.id)));

    expect(resPai.status).toBe(200);
    expect(Array.isArray(resPai.body.children)).toBe(true);
    expect(resPai.body.children).toHaveLength(1);
    const c = resPai.body.children[0];
    expect(c.id).toBe(filho.id);
    expect(c.title).toBe('Compra uniforme');
    expect(c.status).toBe('IN_PROGRESS');
    expect(c.flow?.type).toBe('PURCHASE');

    const resFilho = await request(app)
      .get(`/api/requests/${filho.id}`)
      .set(auth(tokenFor(usuario.id)));

    expect(resFilho.status).toBe(200);
    expect(resFilho.body.parentRequestId).toBe(pai.id);
  });

  // ------------------------------------------------------------------
  // Regressão: criar sem parentRequestId funciona como antes
  // ------------------------------------------------------------------
  it('regressão: criar sem parentRequestId → 201, parentRequestId nulo, sem audit SUBFLOW_OPENED', async () => {
    const usuario = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }]);

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(usuario.id)))
      .send({ flowId: flow.id, title: 'Pedido simples' });

    expect(res.status).toBe(201);
    expect(res.body.parentRequestId).toBeNull();

    const auditSubflow = await prisma.auditLog.findFirst({
      where: { requestId: res.body.id, action: 'SUBFLOW_OPENED' },
    });
    expect(auditSubflow).toBeNull();
  });
});
