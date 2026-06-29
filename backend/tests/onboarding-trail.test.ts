// ===========================================================================
// Fase 1 — Trilha de Admissão/Onboarding (espinha dorsal).
//
// Cobre os pontos de risco da CONFIGURAÇÃO (sem toque no motor):
//  1. isStepComplete com 2 FlowSteps no MESMO order (paralelo): um completo e
//     outro pendente → false; ambos completos → true.
//  2. Branch via conditions no avanço: NOVA → 10 (Diretoria); SUBSTITUICAO
//     (não-match) cai no fallback ALWAYS → 20 (pula o 10).
//  3. Checklist com condition fieldValue NÃO satisfeita não bloqueia a conclusão.
//  4. PII (CPF) mascarado para função TI e intacto para função RH na trilha.
// ===========================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { advanceRequest, createRequestTasks, isStepComplete } from '../src/services/workflow';
import { checklistUnmet } from '../src/lib/checklist';
import { maskDynamicFieldValues } from '../src/lib/fieldMasking';
import { makeFlow, makeUser, resetDb } from './factory';

describe('Fase 1 — Trilha de Admissão/Onboarding (config)', () => {
  beforeEach(resetDb);

  // -------------------------------------------------------------------------
  // 1. Paralelismo: isStepComplete exige TODAS as tarefas do order.
  // -------------------------------------------------------------------------
  it('isStepComplete: 2 FlowSteps no mesmo order — só conclui quando AMBOS estão completos', async () => {
    const initiator = await makeUser('USER');
    // Dois steps no order 40 (paralelo), nenhuma alçada → tarefa por step.
    const flow = await makeFlow('ONBOARDING', [
      { order: 40, requiredRole: null },
      { order: 40, requiredRole: null },
      { order: 50, requiredRole: null },
    ]);
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 40 },
    });
    await createRequestTasks(req.id, flow.id, 40);

    const tasks = await prisma.requestTask.findMany({ where: { requestId: req.id }, orderBy: { createdAt: 'asc' } });
    expect(tasks.length).toBe(2); // uma por FlowStep paralelo

    // Conclui apenas UMA tarefa → etapa ainda incompleta.
    await prisma.requestTask.update({ where: { id: tasks[0].id }, data: { status: 'COMPLETED' } });
    expect(await isStepComplete(req.id, 40)).toBe(false);

    // Conclui a segunda → etapa completa.
    await prisma.requestTask.update({ where: { id: tasks[1].id }, data: { status: 'COMPLETED' } });
    expect(await isStepComplete(req.id, 40)).toBe(true);

    // E o avanço só ocorre com ambas concluídas.
    await advanceRequest(req.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(50);
  });

  // -------------------------------------------------------------------------
  // 2. Branch: NOVA → 10 (Diretoria); SUBSTITUICAO/demais → 20 (fallback ALWAYS).
  // -------------------------------------------------------------------------
  // Receita do order 0: conditions ordenadas com a regra específica ANTES do
  // ALWAYS (evaluateNextOrder itera o array e o ALWAYS retorna incondicional).
  const ORDER0_CONDITIONS = [
    { field: 'vacancyType', op: 'EQUALS', value: 'NOVA', targetOrder: 10 },
    { field: 'always', op: 'ALWAYS', value: null, targetOrder: 20 },
  ];

  async function buildBranchFlow() {
    return makeFlow('ONBOARDING', [
      { order: 0, requiredRole: null, conditions: ORDER0_CONDITIONS },
      { order: 10, requiredRole: null },
      { order: 20, requiredRole: null },
    ]);
  }

  it('branch: vaga NOVA roteia para a Diretoria (order 10)', async () => {
    const initiator = await makeUser('USER');
    const flow = await buildBranchFlow();
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 'nova', status: 'IN_PROGRESS', currentStep: 0, vacancyType: 'NOVA' },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await prisma.requestTask.updateMany({ where: { requestId: req.id }, data: { status: 'COMPLETED' } });
    await advanceRequest(req.id);

    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(10);
  });

  it('branch: SUBSTITUICAO pula a Diretoria e vai direto ao RH (order 20)', async () => {
    const initiator = await makeUser('USER');
    const flow = await buildBranchFlow();
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 'sub', status: 'IN_PROGRESS', currentStep: 0, vacancyType: 'SUBSTITUICAO' },
    });
    await createRequestTasks(req.id, flow.id, 0);
    await prisma.requestTask.updateMany({ where: { requestId: req.id }, data: { status: 'COMPLETED' } });
    await advanceRequest(req.id);

    expect((await prisma.request.findUniqueOrThrow({ where: { id: req.id } })).currentStep).toBe(20);
  });

  // -------------------------------------------------------------------------
  // 3. Checklist: item com condition fieldValue NÃO satisfeita não bloqueia.
  // -------------------------------------------------------------------------
  it('checklist: item obrigatório com condition fieldValue não satisfeita não bloqueia a conclusão', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 0, requiredRole: null }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 0 } });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 0 },
    });

    // Campo needs_notebook na etapa, e um item de checklist condicionado a 'sim'.
    const field = await prisma.formField.create({
      data: { flowStepId: step.id, key: 'needs_notebook', label: 'Notebook?', type: 'SELECT', options: JSON.stringify(['sim', 'nao']) },
    });
    await prisma.checklistItem.create({
      data: {
        flowStepId: step.id,
        label: 'Verificar estoque de notebook',
        required: true,
        condition: JSON.stringify({ type: 'fieldValue', fieldKey: 'needs_notebook', equals: 'sim' }),
      },
    });
    // Item incondicional obrigatório, marcado como concluído.
    const always = await prisma.checklistItem.create({
      data: { flowStepId: step.id, label: 'Definir: comprar ou usar estoque', required: true, condition: null },
    });
    await prisma.requestChecklistItem.create({ data: { requestId: req.id, itemId: always.id, checked: true } });

    // Sem valor (ou valor 'nao'): o item condicionado NÃO é aplicável → não bloqueia.
    await prisma.requestFieldValue.create({ data: { requestId: req.id, fieldId: field.id, value: 'nao' } });
    expect(await checklistUnmet(step.id, req.id)).toEqual([]);

    // Com valor 'sim': o item passa a ser aplicável e, não marcado, bloqueia.
    await prisma.requestFieldValue.update({
      where: { requestId_fieldId: { requestId: req.id, fieldId: field.id } },
      data: { value: 'sim' },
    });
    expect(await checklistUnmet(step.id, req.id)).toContain('Verificar estoque de notebook');
  });

  // -------------------------------------------------------------------------
  // 4. PII: CPF mascarado para função TI; intacto para função RH.
  // -------------------------------------------------------------------------
  it('PII: CPF mascarado para TI e intacto para RH', async () => {
    const initiator = await makeUser('USER');
    const flow = await makeFlow('ONBOARDING', [{ order: 60, requiredRole: 'RH' }]);
    const step = await prisma.flowStep.findFirstOrThrow({ where: { flowTemplateId: flow.id, order: 60 } });
    const req = await prisma.request.create({
      data: { flowId: flow.id, initiatorId: initiator.id, title: 't', status: 'IN_PROGRESS', currentStep: 60 },
    });
    const cpfField = await prisma.formField.create({
      data: { flowStepId: step.id, key: 'employee_cpf', label: 'CPF', type: 'CPF', required: true, sensitiveType: 'CPF' },
    });
    await prisma.requestFieldValue.create({ data: { requestId: req.id, fieldId: cpfField.id, value: '529.982.247-25' } });

    const fieldValues = await prisma.requestFieldValue.findMany({
      where: { requestId: req.id },
      include: { field: true },
    });

    // Espectador da FUNÇÃO RH (setor 'RH'): vê o CPF intacto.
    const rhUser = await makeUser('USER', 'rh-viewer');
    const setorRH = await prisma.sector.create({ data: { name: 'RH' } });
    await prisma.sectorMember.create({ data: { sectorId: setorRH.id, userId: rhUser.id, role: 'PROTETOR', level: 'MEMBRO' } });
    const seenByRh = await maskDynamicFieldValues(rhUser, fieldValues);
    expect(seenByRh.find((v) => v.field.key === 'employee_cpf')?.value).toBe('529.982.247-25');

    // Espectador da FUNÇÃO TI (setor 'TI, Dados e Infra'): recebe o CPF MASCARADO.
    const tiUser = await makeUser('USER', 'ti-viewer');
    const setorTI = await prisma.sector.create({ data: { name: 'TI, Dados e Infra' } });
    await prisma.sectorMember.create({ data: { sectorId: setorTI.id, userId: tiUser.id, role: 'PROTETOR', level: 'MEMBRO' } });
    const seenByTi = await maskDynamicFieldValues(tiUser, fieldValues);
    const masked = seenByTi.find((v) => v.field.key === 'employee_cpf')?.value;
    expect(masked).toBe('***.***.***-**');
    expect(masked).not.toContain('529');
  });
});
