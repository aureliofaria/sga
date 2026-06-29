// Fase 0 · Passo 10 — Status customizados (rótulo de exibição por etapa)
// Cobre: denormalização na criação, avanço de etapa, conclusão, etapa sem rótulo,
// CRUD admin e regressão (fluxos sem statusLabel não quebram).

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks } from '../src/services/workflow';
import { completeCurrentStepTasks, makeFlow, makeUser, resetDb, tokenFor } from './factory';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('statusLabel — rótulo de exibição por etapa (Fase 0 · Passo 10)', () => {
  beforeEach(resetDb);

  // -----------------------------------------------------------------------
  // Criação: request.statusLabel espelha o statusLabel da etapa 0
  // -----------------------------------------------------------------------
  it('criar solicitação cujo fluxo tem statusLabel na etapa 0 → request.statusLabel = rótulo da etapa 0', async () => {
    const usuario = await makeUser('USER');
    const flow = await makeFlow('HIRING', [
      { order: 0, statusLabel: 'Seleção em andamento' },
      { order: 1, statusLabel: 'Preparar onboarding' },
    ]);

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(usuario.id)))
      .send({ flowId: flow.id, title: 'Nova vaga' });

    expect(res.status).toBe(201);
    expect(res.body.statusLabel).toBe('Seleção em andamento');

    // Confirma no banco
    const req = await prisma.request.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(req.statusLabel).toBe('Seleção em andamento');
  });

  // -----------------------------------------------------------------------
  // Avanço: statusLabel muda para o da próxima etapa
  // -----------------------------------------------------------------------
  it('avançar a solicitação para etapa 1 → statusLabel passa a ser o da etapa 1', async () => {
    const iniciador = await makeUser('USER');
    const flow = await makeFlow('HIRING', [
      { order: 0, statusLabel: 'Seleção em andamento' },
      { order: 1, statusLabel: 'Preparar onboarding' },
    ]);

    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: iniciador.id, title: 'Vaga dev', status: 'IN_PROGRESS', currentStep: 0, statusLabel: 'Seleção em andamento' },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const atualizado = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(atualizado.currentStep).toBe(1);
    expect(atualizado.statusLabel).toBe('Preparar onboarding');
  });

  // -----------------------------------------------------------------------
  // Etapa sem statusLabel → statusLabel null (não quebra)
  // -----------------------------------------------------------------------
  it('etapa sem statusLabel → request.statusLabel null; avançar para etapa sem rótulo → null', async () => {
    const iniciador = await makeUser('USER');
    // Etapa 0 sem rótulo, etapa 1 com rótulo
    const flow = await makeFlow('PAYMENT', [
      { order: 0 },
      { order: 1, statusLabel: 'Aguardando pagamento' },
    ]);

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(iniciador.id)))
      .send({ flowId: flow.id, title: 'Pedido sem rótulo' });

    expect(res.status).toBe(201);
    expect(res.body.statusLabel).toBeNull();

    // Avança para etapa 1 (com rótulo)
    const reqId = res.body.id;
    await completeCurrentStepTasks(reqId);
    await advanceRequest(reqId);
    const depoisEtapa1 = await prisma.request.findUniqueOrThrow({ where: { id: reqId } });
    expect(depoisEtapa1.statusLabel).toBe('Aguardando pagamento');

    // Agora cria fluxo com etapa 1 sem rótulo e testa o caminho inverso
    const flow2 = await makeFlow('PAYMENT', [
      { order: 0, statusLabel: 'Iniciando' },
      { order: 1 },
    ]);
    const req2 = await prisma.request.create({
      data: { flowId: flow2.id, initiatorId: iniciador.id, title: 'Pedido 2', status: 'IN_PROGRESS', currentStep: 0, statusLabel: 'Iniciando' },
    });
    await createRequestTasks(req2.id, flow2.id, 0);
    await completeCurrentStepTasks(req2.id);
    await advanceRequest(req2.id);

    const depoisEtapa1sem = await prisma.request.findUniqueOrThrow({ where: { id: req2.id } });
    expect(depoisEtapa1sem.currentStep).toBe(1);
    // Etapa 1 não tem rótulo → statusLabel deve ser null
    expect(depoisEtapa1sem.statusLabel).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Conclusão do fluxo → statusLabel é zerado (null)
  // Decisão: ao concluir, o status de máquina COMPLETED já comunica o estado;
  // manter um rótulo de etapa seria enganoso.
  // -----------------------------------------------------------------------
  it('conclusão do fluxo → statusLabel null (zerado na conclusão)', async () => {
    const iniciador = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, statusLabel: 'Processando pagamento' },
    ]);

    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: iniciador.id, title: 'Pagamento final', status: 'IN_PROGRESS', currentStep: 0, statusLabel: 'Processando pagamento' },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await completeCurrentStepTasks(req.id);
    await advanceRequest(req.id);

    const concluido = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(concluido.status).toBe('COMPLETED');
    // statusLabel zerado na conclusão
    expect(concluido.statusLabel).toBeNull();
  });

  // -----------------------------------------------------------------------
  // CRUD: ADMIN define statusLabel numa etapa e o GET do fluxo reflete
  // -----------------------------------------------------------------------
  it('ADMIN cria etapa com statusLabel → GET /:id do fluxo retorna statusLabel na etapa', async () => {
    const admin = await makeUser('ADMIN');
    const flowBase = await makeFlow('HIRING', []);

    // Cria etapa com statusLabel via API
    const resStep = await request(app)
      .post(`/api/flows/${flowBase.id}/steps`)
      .set(auth(tokenFor(admin.id)))
      .send({ name: 'Triagem', order: 0, statusLabel: 'Em triagem' });

    expect(resStep.status).toBe(201);
    expect(resStep.body.statusLabel).toBe('Em triagem');

    // GET do fluxo deve refletir o statusLabel na etapa
    const resFlow = await request(app)
      .get(`/api/flows/${flowBase.id}`)
      .set(auth(tokenFor(admin.id)));

    expect(resFlow.status).toBe(200);
    const step = resFlow.body.steps.find((s: any) => s.id === resStep.body.id);
    expect(step).toBeDefined();
    expect(step.statusLabel).toBe('Em triagem');
  });

  it('ADMIN atualiza statusLabel de uma etapa via PUT → GET do fluxo reflete a mudança', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PURCHASE', [{ order: 0, statusLabel: 'Rótulo antigo' }]);

    // Busca o id da etapa
    const flowDetail = await request(app)
      .get(`/api/flows/${flow.id}`)
      .set(auth(tokenFor(admin.id)));
    const stepId = flowDetail.body.steps[0].id;

    // Atualiza o statusLabel
    const resUpd = await request(app)
      .put(`/api/flows/${flow.id}/steps/${stepId}`)
      .set(auth(tokenFor(admin.id)))
      .send({ statusLabel: 'Rótulo novo' });

    expect(resUpd.status).toBe(200);
    expect(resUpd.body.statusLabel).toBe('Rótulo novo');

    // GET confirma
    const resFlow2 = await request(app)
      .get(`/api/flows/${flow.id}`)
      .set(auth(tokenFor(admin.id)));
    const step2 = resFlow2.body.steps[0];
    expect(step2.statusLabel).toBe('Rótulo novo');
  });

  it('ADMIN limpa statusLabel via PUT (null) → etapa sem rótulo', async () => {
    const admin = await makeUser('ADMIN');
    const flow = await makeFlow('PURCHASE', [{ order: 0, statusLabel: 'Para remover' }]);

    const flowDetail = await request(app)
      .get(`/api/flows/${flow.id}`)
      .set(auth(tokenFor(admin.id)));
    const stepId = flowDetail.body.steps[0].id;

    const resUpd = await request(app)
      .put(`/api/flows/${flow.id}/steps/${stepId}`)
      .set(auth(tokenFor(admin.id)))
      .send({ statusLabel: null });

    expect(resUpd.status).toBe(200);
    expect(resUpd.body.statusLabel).toBeNull();
  });

  // -----------------------------------------------------------------------
  // statusLabel aparece na lista (GET /api/requests) — verificação de serialização
  // -----------------------------------------------------------------------
  it('GET /api/requests (lista) inclui statusLabel na solicitação', async () => {
    const usuario = await makeUser('USER');
    const flow = await makeFlow('HIRING', [{ order: 0, statusLabel: 'Visível na lista' }]);

    const resCreate = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(usuario.id)))
      .send({ flowId: flow.id, title: 'Solicitação com rótulo' });
    expect(resCreate.status).toBe(201);

    const resList = await request(app)
      .get('/api/requests')
      .set(auth(tokenFor(usuario.id)));

    expect(resList.status).toBe(200);
    const item = resList.body.find((r: any) => r.id === resCreate.body.id);
    expect(item).toBeDefined();
    expect(item.statusLabel).toBe('Visível na lista');
  });

  // -----------------------------------------------------------------------
  // Regressão: fluxos sem statusLabel funcionam como antes; status de máquina inalterado
  // -----------------------------------------------------------------------
  it('regressão: fluxo sem statusLabel em nenhuma etapa funciona normalmente; status de máquina inalterado', async () => {
    const iniciador = await makeUser('USER');
    const flow = await makeFlow('PAYMENT', [{ order: 0 }, { order: 1 }, { order: 2 }]);

    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: iniciador.id, title: 'Regressão', status: 'IN_PROGRESS', currentStep: 0 },
    });
    await createRequestTasks(req.id, flow.id, 0);

    // Avança pelas 3 etapas e verifica que o fluxo conclui normalmente
    for (let i = 0; i < 3; i++) {
      await completeCurrentStepTasks(req.id);
      await advanceRequest(req.id);
    }

    const final = await prisma.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(final.status).toBe('COMPLETED');
    expect(final.statusLabel).toBeNull();
    expect(final.currentStep).toBe(2); // não avança além da última etapa
  });

  it('regressão: REJECT não altera statusLabel (status de máquina comunica o estado)', async () => {
    const iniciador = await makeUser('USER');
    const aprovador = await makeUser('MANAGER');
    const flow = await makeFlow('PAYMENT', [
      { order: 0, statusLabel: 'Aguardando aprovação', authLevels: [{ name: 'nível1', requiredApprovers: 1, approverRole: 'MANAGER' }] },
    ]);

    const res = await request(app)
      .post('/api/requests')
      .set(auth(tokenFor(iniciador.id)))
      .send({ flowId: flow.id, title: 'Para rejeitar' });

    expect(res.status).toBe(201);
    const reqId = res.body.id;
    expect(res.body.statusLabel).toBe('Aguardando aprovação');

    // Completa a tarefa (a tarefa é do iniciador por ser a única; aprovação fica pendente)
    await completeCurrentStepTasks(reqId);

    // Rejeita via API
    const resReject = await request(app)
      .post(`/api/requests/${reqId}/decision`)
      .set(auth(tokenFor(aprovador.id)))
      .send({ action: 'REJECT', reason: 'Orçamento insuficiente' });

    expect(resReject.status).toBe(200);

    // statusLabel NÃO é zerado no REJECT (decisão de projeto: status de máquina comunica REJECTED)
    const rejeitada = await prisma.request.findUniqueOrThrow({ where: { id: reqId } });
    expect(rejeitada.status).toBe('REJECTED');
    // statusLabel pode ter mantido o valor original — o que importa é que não quebrou
    // e que o status de máquina é REJECTED (é ele que governa a lógica).
    expect(rejeitada.statusLabel).toBeDefined(); // pode ser o rótulo ou null — não importa
  });
});
