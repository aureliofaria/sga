// ============================================================================
// Organização & Acessos (Fase 0) — vocabulário canônico.
//
// Dois EIXOS independentes:
//  • POSIÇÃO no setor (hierarquia): Líder I / Líder II / Membro.
//  • FUNÇÃO no fluxo: papel operacional que recebe tarefas (TI, DADOS, ...).
//
// "Solicitante" não é papel: qualquer pessoa de qualquer setor pode abrir
// requisições. Apenas alguns setores possuem função nos fluxos.
// ============================================================================

// --- Setores da empresa (cadastrados pelo ADMIN; semeados na base) ----------
export const SECTORS = [
  'TI, Dados e Infra',
  'Administrativo',
  'RH',
  'Financeiro',
  'Sinistros',
  'Assistência 24H',
  'SAC e Ouvidoria',
  'Cobrança',
  'Comercial Interno',
  'Aceleração de Expansão',
  'Jurídico',
  'Monitoramento e Gestão de Risco',
  'Cadastro',
  'Marketing',
  'Processos',
  'Central de Atendimento',
  'Controladoria',
  'Diretoria',
  'Gestão de Prestadores',
  'Retenção',
] as const;
export type SectorName = (typeof SECTORS)[number];

// --- Posição (hierarquia) dentro do setor -----------------------------------
// LIDER_1: exatamente 1 por setor (obrigatório, único). LIDER_2: 0..n.
// MEMBRO: 0..n, vinculado a um LIDER_2 ou direto ao LIDER_1.
export const SECTOR_LEVELS = ['LIDER_1', 'LIDER_2', 'MEMBRO'] as const;
export type SectorLevel = (typeof SECTOR_LEVELS)[number];

// --- Funções nos fluxos -----------------------------------------------------
// Papéis operacionais que recebem/atuam em tarefas dos fluxos.
export const FUNCTION_ROLES = ['RH', 'FINANCEIRO', 'TI', 'DADOS', 'SISTEMAS', 'ADMINISTRATIVO', 'DIRETORIA'] as const;
export type FunctionRole = (typeof FUNCTION_ROLES)[number];

// Papéis globais da aplicação.
//  • ADMIN: administra a aplicação (setores, usuários, fluxos).
//  • DIRETORIA: super-papel de negócio (vê tudo, intervém, maior alçada,
//    edita parâmetros financeiros) — também é função de aprovação.
export const APP_ROLES = ['ADMIN', 'DIRETORIA'] as const;

// Papéis legados ainda em uso por seeds/fluxos atuais. Mantidos para
// compatibilidade durante a transição (serão migrados para as funções acima):
// HR→RH, FINANCE→FINANCEIRO, MANAGER (aprovador) → hierarquia de líder, USER→Membro.
export const LEGACY_ROLES = ['HR', 'FINANCE', 'MANAGER', 'USER'] as const;

// Conjunto aceito hoje (canônico + legado), usado na validação de cadastro.
export const ALL_ROLES = [...APP_ROLES, ...FUNCTION_ROLES, ...LEGACY_ROLES] as const;
export type Role = (typeof ALL_ROLES)[number];

export function isValidRole(role: string): role is Role {
  return (ALL_ROLES as readonly string[]).includes(role);
}
export function isValidSector(name: string): name is SectorName {
  return (SECTORS as readonly string[]).includes(name);
}

// --- Funções que cada setor concentra ---------------------------------------
// A maioria dos setores não tem função de fluxo (só atua como Solicitante).
// O setor de tecnologia concentra TRÊS funções distintas.
export const SECTOR_FUNCTIONS: Partial<Record<SectorName, FunctionRole[]>> = {
  'TI, Dados e Infra': ['TI', 'DADOS', 'SISTEMAS'],
  Administrativo: ['ADMINISTRATIVO'],
  RH: ['RH'],
  Financeiro: ['FINANCEIRO'],
  Diretoria: ['DIRETORIA'],
};

// Quem pode cadastrar/editar o teto orçamentário e o saldo (override manual).
export const FINANCE_PARAM_EDITORS: Role[] = ['ADMIN', 'DIRETORIA'];
// (Acrescido em runtime do Líder I do setor Financeiro — verificação por hierarquia.)
