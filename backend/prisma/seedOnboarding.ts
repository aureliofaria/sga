// ===========================================================================
// Fase 1 — Trilha de Admissão/Onboarding (espinha dorsal / caminho feliz).
//
// CONFIG-FIRST: esta trilha é PURA CONFIGURAÇÃO sobre o motor existente. Nenhum
// toque em advanceRequest/isStepComplete/createRequestTasks. O branch da etapa 0
// (NOVA → Diretoria; SUBSTITUICAO/demais → RH) usa as `conditions` que o
// evaluateNextOrder já suporta:
//   • { field:'vacancyType', op:'EQUALS', value:'NOVA', targetOrder:10 }  (1º)
//   • { field:'always', op:'ALWAYS', value:null, targetOrder:20 }          (fallback, por último)
// A ordem importa: evaluateNextOrder itera o array e o 'ALWAYS' retorna
// incondicionalmente — por isso a regra específica (NOVA) vem ANTES do fallback.
// Etapas paralelas = vários FlowSteps no MESMO `order`; isStepComplete exige que
// TODAS concluam. O salto de order é levado por UM dos steps do order (basta um
// carregar a condition).
//
// IDEMPOTÊNCIA: FlowTemplate/FlowStep não têm unique natural → findFirst+create.
// FormField tem @@unique[flowStepId,key] → upsert por (flowStepId,key).
// ChecklistItem não tem unique → findFirst (flowStepId,label) + create.
// NÃO altera o ONBOARDING antigo ('Admissão de Colaborador'): coexistem por nome.
// ===========================================================================

import { PrismaClient } from '@prisma/client';

type Db = PrismaClient;

const FLOW_NAME = 'Trilha de Admissão/Onboarding';

// Helpers de tipo para as receitas declarativas das etapas.
interface FormFieldSpec {
  key: string;
  label: string;
  type: string; // TEXT|TEXTAREA|NUMBER|DATE|SELECT|EMAIL|CPF|RG|MONEY|PHONE
  required?: boolean;
  options?: string[];
  sensitiveType?: string | null;
}

interface ChecklistSpec {
  label: string;
  required?: boolean;
  // Condição fieldValue: o item só é aplicável quando o campo == valor.
  fieldEquals?: { fieldKey: string; equals: string };
}

interface StepSpec {
  order: number;
  name: string;
  requiredRole?: string | null;
  handlingSectorName?: string | null;
  statusLabel?: string | null;
  // Ramo de devolução: order para onde a correção devolve (0 = volta ao solicitante).
  returnStepOrder?: number | null;
  deadlineHours?: number | null;
  slaExpiry?: string;
  collectsResources?: boolean;
  conditions?: Array<{ field: string; op: string; value: string | null; targetOrder: number }>;
  escalationDay1?: number | null;
  escalationDay2?: number | null;
  escalationDay3?: number | null;
  formFields?: FormFieldSpec[];
  checklist?: ChecklistSpec[];
}

const SIM_NAO = ['sim', 'nao'];

// ---------------------------------------------------------------------------
// RECEITA DA TRILHA (orders espaçados para permitir branch por salto).
// ---------------------------------------------------------------------------
const STEPS: StepSpec[] = [
  // order 0 — Abertura de Vaga (self-submission do iniciador). Branch por vacancyType.
  {
    order: 0,
    name: 'Abertura de Vaga',
    requiredRole: null,
    statusLabel: 'Aguardando análise',
    conditions: [
      { field: 'vacancyType', op: 'EQUALS', value: 'NOVA', targetOrder: 10 },
      { field: 'always', op: 'ALWAYS', value: null, targetOrder: 20 },
    ],
    formFields: [
      { key: 'vacancy_sector', label: 'Setor da vaga', type: 'SELECT', required: true, options: [] },
      { key: 'vacancy_leader', label: 'Líder responsável', type: 'TEXT', required: true },
      { key: 'headcount_justification', label: 'Justificativa de headcount', type: 'TEXTAREA' },
      { key: 'needs_notebook', label: 'Precisa de notebook?', type: 'SELECT', options: SIM_NAO },
      { key: 'needs_desktop', label: 'Precisa de desktop?', type: 'SELECT', options: SIM_NAO },
      { key: 'needs_phone', label: 'Precisa de celular/chip?', type: 'SELECT', options: SIM_NAO },
      { key: 'needs_powerbi', label: 'Precisa de Power BI?', type: 'SELECT', options: SIM_NAO },
      { key: 'needs_erp', label: 'Precisa de acesso ao ERP?', type: 'SELECT', options: SIM_NAO },
      { key: 'needs_badge', label: 'Precisa de crachá/acesso físico?', type: 'SELECT', options: SIM_NAO },
    ],
  },
  // order 10 — Diretoria (somente NOVA vaga). Vai para o RH (20) ao concluir.
  {
    order: 10,
    name: 'Diretoria — Aprovação de Nova Vaga',
    requiredRole: 'DIRETORIA',
    handlingSectorName: 'Diretoria',
    statusLabel: 'Aguardando Diretoria',
    deadlineHours: 48,
    slaExpiry: 'TRANSFER_TO_LEADER',
    // Devolução: ao solicitar correção, volta ao solicitante (Abertura de Vaga).
    returnStepOrder: 0,
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 20 }],
  },
  // order 20 — RH avalia e define prazo.
  {
    order: 20,
    name: 'RH — Avaliação e Prazo',
    requiredRole: 'RH',
    handlingSectorName: 'RH',
    statusLabel: 'RH avaliando vaga',
    deadlineHours: 24,
    // Devolução: ao solicitar correção, volta ao solicitante (Abertura de Vaga).
    returnStepOrder: 0,
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 30 }],
    formFields: [
      { key: 'expected_start_date', label: 'Data prevista de início', type: 'DATE', required: true },
      { key: 'rh_observation', label: 'Observação do RH', type: 'TEXTAREA' },
    ],
  },
  // order 30 — RH confirma e dispara provisionamento.
  {
    order: 30,
    name: 'RH — Confirma e Dispara Provisionamento',
    requiredRole: 'RH',
    handlingSectorName: 'RH',
    statusLabel: 'RH confirmando prazo',
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 40 }],
  },
  // order 40 — PARALELO (TI + Administrativo). Basta UM step carregar o salto.
  {
    order: 40,
    name: 'TI — Avaliação de Equipamentos',
    requiredRole: 'TI',
    handlingSectorName: 'TI, Dados e Infra',
    statusLabel: 'TI e Administrativo em avaliação',
    deadlineHours: 24,
    collectsResources: true,
    checklist: [
      { label: 'Verificar estoque de notebook', required: true, fieldEquals: { fieldKey: 'needs_notebook', equals: 'sim' } },
      { label: 'Verificar estoque de desktop', required: true, fieldEquals: { fieldKey: 'needs_desktop', equals: 'sim' } },
      { label: 'Verificar estoque de celular/chip', required: true, fieldEquals: { fieldKey: 'needs_phone', equals: 'sim' } },
      { label: 'Definir: comprar ou usar estoque', required: true },
    ],
  },
  {
    order: 40,
    name: 'Administrativo — Avaliação de Infraestrutura',
    requiredRole: 'ADMINISTRATIVO',
    handlingSectorName: 'Administrativo',
    statusLabel: 'TI e Administrativo em avaliação',
    deadlineHours: 24,
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 50 }],
    checklist: [
      { label: 'Verificar mesa/cadeira', required: true, fieldEquals: { fieldKey: 'needs_badge', equals: 'sim' } },
      { label: 'Definir: comprar ou usar estoque', required: true },
    ],
  },
  // order 50 — RH seleção em andamento.
  {
    order: 50,
    name: 'RH — Seleção em Andamento',
    requiredRole: 'RH',
    handlingSectorName: 'RH',
    statusLabel: 'Seleção em andamento',
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 60 }],
  },
  // order 60 — RH coleta dados do candidato (PII).
  {
    order: 60,
    name: 'RH — Dados do Candidato (PII)',
    requiredRole: 'RH',
    handlingSectorName: 'RH',
    statusLabel: 'RH coletando dados do colaborador',
    deadlineHours: 24,
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 70 }],
    formFields: [
      { key: 'employee_name', label: 'Nome do colaborador', type: 'TEXT', required: true },
      { key: 'employee_cpf', label: 'CPF', type: 'CPF', required: true, sensitiveType: 'CPF' },
      { key: 'employee_rg', label: 'RG', type: 'RG', required: true, sensitiveType: 'RG' },
      { key: 'employee_email_personal', label: 'E-mail pessoal', type: 'EMAIL', required: true, sensitiveType: 'EMAIL_PERSONAL' },
      { key: 'employee_start_date', label: 'Data de início', type: 'DATE', required: true },
      { key: 'employee_phone', label: 'Telefone pessoal', type: 'PHONE', sensitiveType: 'PHONE_PERSONAL' },
    ],
  },
  // order 70 — PARALELO (TI + Sistemas + Administrativo + Dados). Execução.
  {
    order: 70,
    name: 'TI — Configurar Equipamentos',
    requiredRole: 'TI',
    handlingSectorName: 'TI, Dados e Infra',
    statusLabel: 'Provisionamento em execução',
    deadlineHours: 24,
    escalationDay1: 1, escalationDay2: 2, escalationDay3: 5,
    checklist: [
      { label: 'Notebook configurado', required: true, fieldEquals: { fieldKey: 'needs_notebook', equals: 'sim' } },
      { label: 'Desktop configurado', required: true, fieldEquals: { fieldKey: 'needs_desktop', equals: 'sim' } },
      { label: 'Celular/chip configurado', required: true, fieldEquals: { fieldKey: 'needs_phone', equals: 'sim' } },
      { label: 'E-mail corporativo criado', required: true },
      { label: 'Equipamento entregue', required: true },
    ],
  },
  {
    order: 70,
    name: 'Sistemas — Acessos de Aplicação',
    requiredRole: 'SISTEMAS',
    handlingSectorName: 'TI, Dados e Infra',
    statusLabel: 'Provisionamento em execução',
    deadlineHours: 24,
    escalationDay1: 1, escalationDay2: 2, escalationDay3: 5,
    checklist: [
      { label: 'Acesso ERP', required: true, fieldEquals: { fieldKey: 'needs_erp', equals: 'sim' } },
      { label: 'Licença Office 365', required: true },
      { label: 'Usuário no AD/Azure', required: true },
    ],
  },
  {
    order: 70,
    name: 'Administrativo — Infraestrutura Física',
    requiredRole: 'ADMINISTRATIVO',
    handlingSectorName: 'Administrativo',
    statusLabel: 'Provisionamento em execução',
    deadlineHours: 24,
    escalationDay1: 1, escalationDay2: 2, escalationDay3: 5,
    conditions: [{ field: 'always', op: 'ALWAYS', value: null, targetOrder: 80 }],
    checklist: [
      { label: 'Estação de trabalho preparada', required: true },
      { label: 'Crachá emitido', required: true, fieldEquals: { fieldKey: 'needs_badge', equals: 'sim' } },
      { label: 'Acesso físico liberado', required: true, fieldEquals: { fieldKey: 'needs_badge', equals: 'sim' } },
    ],
  },
  {
    order: 70,
    name: 'Dados — Acesso a Analytics',
    requiredRole: 'DADOS',
    handlingSectorName: 'TI, Dados e Infra',
    statusLabel: 'Provisionamento em execução',
    deadlineHours: 24,
    escalationDay1: 1, escalationDay2: 2, escalationDay3: 5,
    checklist: [
      { label: 'Acesso Power BI provisionado', required: true, fieldEquals: { fieldKey: 'needs_powerbi', equals: 'sim' } },
      // QUIRK aceitável do piloto: se needs_powerbi=nao, NENHUM item obrigatório
      // se torna aplicável → a tarefa de Dados fecha sem ação. Documentado.
      { label: 'Workspace compartilhado', required: false, fieldEquals: { fieldKey: 'needs_powerbi', equals: 'sim' } },
    ],
  },
  // order 80 — RH confirma conclusão. Sem conditions → advanceRequest conclui (COMPLETED).
  {
    order: 80,
    name: 'RH — Confirmar Onboarding Concluído',
    requiredRole: 'RH',
    handlingSectorName: 'RH',
    statusLabel: 'Onboarding concluído — aguardando confirmação RH',
  },
];

// ---------------------------------------------------------------------------
// Semeadura idempotente.
// ---------------------------------------------------------------------------
export async function seedOnboardingFlow(prisma: Db): Promise<void> {
  // Resolve sectorIds por nome (os setores são semeados em seed.ts ANTES daqui).
  const sectorRows = await prisma.sector.findMany({ select: { id: true, name: true } });
  const sectorIdByName = new Map(sectorRows.map((s) => [s.name, s.id]));

  // FlowTemplate (sem unique natural → findFirst+create).
  let flow = await prisma.flowTemplate.findFirst({ where: { name: FLOW_NAME } });
  if (!flow) {
    flow = await prisma.flowTemplate.create({
      data: {
        name: FLOW_NAME,
        description: 'Trilha de admissão/onboarding ponta a ponta (Fase 1).',
        type: 'ONBOARDING',
        scope: 'INTER',
        isActive: true,
      },
    });
  }

  for (const spec of STEPS) {
    const handlingSectorId = spec.handlingSectorName
      ? sectorIdByName.get(spec.handlingSectorName) ?? null
      : null;

    // FlowStep: chave de identidade idempotente = (flowTemplateId, order, name).
    // O `name` distingue os steps paralelos do mesmo `order`.
    let step = await prisma.flowStep.findFirst({
      where: { flowTemplateId: flow.id, order: spec.order, name: spec.name },
    });
    if (!step) {
      step = await prisma.flowStep.create({
        data: {
          flowTemplateId: flow.id,
          order: spec.order,
          name: spec.name,
          requiredRole: spec.requiredRole ?? null,
          handlingSectorId,
          statusLabel: spec.statusLabel ?? null,
          returnStepOrder: spec.returnStepOrder ?? null,
          deadlineHours: spec.deadlineHours ?? null,
          slaExpiry: spec.slaExpiry ?? undefined,
          collectsResources: spec.collectsResources ?? false,
          conditions: spec.conditions ? JSON.stringify(spec.conditions) : null,
          escalationDay1: spec.escalationDay1 ?? null,
          escalationDay2: spec.escalationDay2 ?? null,
          escalationDay3: spec.escalationDay3 ?? null,
        },
      });
    }

    // FormFields (upsert por @@unique[flowStepId,key]).
    let fieldOrder = 0;
    for (const f of spec.formFields ?? []) {
      await prisma.formField.upsert({
        where: { flowStepId_key: { flowStepId: step.id, key: f.key } },
        update: {
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          options: f.options ? JSON.stringify(f.options) : null,
          order: fieldOrder,
          sensitiveType: f.sensitiveType ?? null,
        },
        create: {
          flowStepId: step.id,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          options: f.options ? JSON.stringify(f.options) : null,
          order: fieldOrder,
          sensitiveType: f.sensitiveType ?? null,
        },
      });
      fieldOrder++;
    }

    // ChecklistItems (sem unique → findFirst por (flowStepId,label) + create).
    let itemOrder = 0;
    for (const c of spec.checklist ?? []) {
      const existing = await prisma.checklistItem.findFirst({
        where: { flowStepId: step.id, label: c.label },
      });
      const condition = c.fieldEquals
        ? JSON.stringify({ type: 'fieldValue', fieldKey: c.fieldEquals.fieldKey, equals: c.fieldEquals.equals })
        : null;
      if (!existing) {
        await prisma.checklistItem.create({
          data: {
            flowStepId: step.id,
            label: c.label,
            order: itemOrder,
            required: c.required ?? true,
            condition,
          },
        });
      }
      itemOrder++;
    }
  }

  console.log(`Trilha "${FLOW_NAME}" garantida (Fase 1) — ${STEPS.length} etapa(s) configurada(s).`);
}
