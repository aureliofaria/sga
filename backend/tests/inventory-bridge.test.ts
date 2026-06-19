import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb } from './factory';

// Cria solicitação de uma etapa com um RequestResource vinculado a um Asset físico.
async function buildWithAsset(flowType: string, assetStatus: string) {
  const initiator = await makeUser('USER');
  const flow = await makeFlow(flowType, [{ order: 0 }]);
  const item = await prisma.resourceItem.create({ data: { name: `res-${flowType}`, type: 'EQUIPMENT' } });
  const invItem = await prisma.inventoryItem.create({ data: { code: `INV-${flowType}-${Date.now()}`, name: 'Notebook', type: 'TI', category: 'HARDWARE' } });
  const asset = await prisma.asset.create({ data: { itemId: invItem.id, status: assetStatus } });
  const req = await prisma.request.create({
    data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
  });
  await prisma.requestResource.create({ data: { requestId: req.id, resourceItemId: item.id, status: 'PENDING', assetId: asset.id } });
  await createRequestTasks(req.id, flow.id, 0);
  return { req, asset };
}

describe('ponte inventário ↔ workflow (Fase 2)', () => {
  beforeEach(resetDb);

  it('admissão aloca a unidade física: Asset → ATIVO + movimentação ALOCACAO vinculada', async () => {
    const { req, asset } = await buildWithAsset('ONBOARDING', 'RESERVADO');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const fresh = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(fresh.status).toBe('ATIVO');

    const mov = await prisma.assetMovement.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(mov.type).toBe('ALOCACAO');
    expect(mov.newStatus).toBe('ATIVO');
    expect(mov.requestId).toBe(req.id); // movimentação rastreável à solicitação
  });

  it('desligamento devolve a unidade física: Asset → DISPONIVEL + movimentação DEVOLUCAO', async () => {
    const { req, asset } = await buildWithAsset('OFFBOARDING', 'ATIVO');
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const fresh = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(fresh.status).toBe('DISPONIVEL');
    expect(fresh.userId).toBeNull();

    const mov = await prisma.assetMovement.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(mov.type).toBe('DEVOLUCAO');
    expect(mov.newStatus).toBe('DISPONIVEL');
  });

  it('linha sem assetId não gera movimentação física (item intangível)', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0 }]);
    const item = await prisma.resourceItem.create({ data: { name: 'Acesso ERP', type: 'SYSTEM_ACCESS' } });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await prisma.requestResource.create({ data: { requestId: req.id, resourceItemId: item.id, status: 'PENDING' } });
    await createRequestTasks(req.id, flow.id, 0);

    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    expect(await prisma.assetMovement.count()).toBe(0);
    const rr = await prisma.requestResource.findFirstOrThrow({ where: { requestId: req.id } });
    expect(rr.status).toBe('ALLOCATED'); // status lógico transiciona normalmente
  });
});
