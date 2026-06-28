// ============================================================================
// Mascaramento de campos sensíveis (LGPD) — Fase 0 · Passo 4
//
// FUNDAÇÃO do motor de mascaramento. Hoje NÃO há coluna estruturada de PII
// (CPF/RG/salário) no schema: esses dados chegam como campos dinâmicos no
// Passo 7 (FormField com flag de sensibilidade). Este módulo entrega:
//  • o motor PURO de mascaramento (`maskValue`/`maskFields`), sem dependência
//    de banco, que o Passo 7 vai consumir nos valores de formulário;
//  • a RESOLUÇÃO de acesso por papel/função (espelha o estilo de visibility.ts);
//  • a AUDITORIA de acesso (LGPD), gravada em AuditLog quando há revelação.
//
// Política confirmada (SPEC Parte V): veem SEM máscara quem tem função RH
// (role legado 'HR' OU membro de setor cuja função inclui 'RH' via
// SECTOR_FUNCTIONS) OU papel DIRETORIA OU papel ADMIN. Todos os demais recebem
// o valor mascarado. A política mora numa estrutura por tipo, fácil de afinar.
//
// Acesso por PAPEL GLOBAL, não por setor: o acesso a PII segue o papel global
// (ADMIN/DIRETORIA) + a função RH — exatamente como visibility.ts chaveia a
// visão global por PAPEL, não por filiação de setor. Ser membro do *setor*
// "Diretoria" (cuja função de fluxo é DIRETORIA) NÃO concede acesso a PII por
// si só; é preciso o papel global DIRETORIA. Por isso a função 'DIRETORIA'
// deliberadamente NÃO consta de nenhuma regra da política (só a função 'RH').
// ============================================================================

import prisma from './prisma';
import { SECTOR_FUNCTIONS, FunctionRole } from './org';

type Db = typeof prisma;

// Tipos de dado sensível reconhecidos pelo motor.
export type SensitiveType = 'CPF' | 'RG' | 'SALARY' | 'EMAIL_PERSONAL' | 'PHONE_PERSONAL';

// Liberação de um tipo sensível: papéis globais e funções de fluxo que o veem
// sem máscara. A presença de qualquer um destes no espectador libera o tipo.
interface AccessRule {
  // Papéis globais / legados que liberam (ex.: 'ADMIN', 'DIRETORIA', 'HR').
  roles: string[];
  // Funções de fluxo (SECTOR_FUNCTIONS) que liberam (ex.: 'RH').
  functions: FunctionRole[];
}

// Conjunto-base RH + DIRETORIA + ADMIN, aplicado a todos os tipos por enquanto.
// Para afinar por tipo no futuro, basta editar a entrada do tipo desejado.
const RH_DIRETORIA_ADMIN: AccessRule = {
  // 'HR' é o papel legado equivalente à função RH; ADMIN/DIRETORIA são globais.
  roles: ['ADMIN', 'DIRETORIA', 'HR'],
  functions: ['RH'],
};

// Política declarativa por tipo sensível.
export const SENSITIVE_POLICY: Record<SensitiveType, AccessRule> = {
  CPF: RH_DIRETORIA_ADMIN,
  RG: RH_DIRETORIA_ADMIN,
  SALARY: RH_DIRETORIA_ADMIN,
  EMAIL_PERSONAL: RH_DIRETORIA_ADMIN,
  PHONE_PERSONAL: RH_DIRETORIA_ADMIN,
};

export const SENSITIVE_TYPES = Object.keys(SENSITIVE_POLICY) as SensitiveType[];

// Representação mascarada por tipo: preserva o FORMATO reconhecível sem revelar
// nenhum dígito/caractere do dado original.
const MASK_BY_TYPE: Record<SensitiveType, string> = {
  CPF: '***.***.***-**',
  RG: '**.***.***-*',
  SALARY: 'R$ ••••••',
  EMAIL_PERSONAL: '•••••@•••••',
  PHONE_PERSONAL: '(••) •••••-••••',
};

// Máscara genérica fail-safe: usada se um tipo desconhecido chegar em runtime
// (ex.: valor dinâmico do Passo 7 cujo tipo não esteja tipado por TS). Garante
// que NUNCA se devolve o valor cru nem `undefined` (que apagaria o campo).
const GENERIC_MASK = '••••••';

// Mascara um valor de tipo sensível. Valor nulo/indefinido/vazio -> ''.
// NUNCA revela parte do dado: a saída é uma constante por tipo. Tipo
// desconhecido (defensivo, fora do contrato TS) -> máscara genérica fail-safe.
export function maskValue(type: SensitiveType, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' ? String(value) : value;
  if (raw.trim() === '') return '';
  return MASK_BY_TYPE[type] ?? GENERIC_MASK;
}

// --- Resolução de acesso (espelha o estilo de visibility.ts) ----------------

export interface Viewer {
  id: string;
  role?: string | null;
}

// Conjunto de tipos sensíveis que o espectador pode ver SEM máscara.
// • ADMIN/DIRETORIA: todos (papéis globais).
// • role 'HR': todos os tipos que listam a função 'RH' (= todos hoje).
// • senão: consulta SectorMember, mapeia sector.name -> funções via
//   SECTOR_FUNCTIONS; se reunir a função 'RH', libera os tipos de RH.
export async function resolveViewerSensitiveAccess(user: Viewer, db: Db = prisma): Promise<Set<SensitiveType>> {
  const role = (user.role ?? '') as string;

  // ADMIN/DIRETORIA: papéis globais — liberam tudo.
  if (role === 'ADMIN' || role === 'DIRETORIA') {
    return new Set(SENSITIVE_TYPES);
  }

  // Funções de fluxo reunidas pelo espectador (a partir do papel + filiações).
  const fns = new Set<FunctionRole>();

  // Papel legado 'HR' equivale à função RH.
  if (role === 'HR') fns.add('RH');

  // Filiações de setor do espectador -> funções do setor (SECTOR_FUNCTIONS).
  const memberships = await db.sectorMember.findMany({
    where: { userId: user.id },
    select: { sector: { select: { name: true } } },
  });
  for (const m of memberships) {
    const sectorFns = SECTOR_FUNCTIONS[m.sector.name as keyof typeof SECTOR_FUNCTIONS];
    if (sectorFns) for (const f of sectorFns) fns.add(f);
  }

  // Libera um tipo se o espectador reúne algum papel/função exigido por ele.
  const allowed = new Set<SensitiveType>();
  for (const type of SENSITIVE_TYPES) {
    const rule = SENSITIVE_POLICY[type];
    const byRole = rule.roles.includes(role);
    const byFunction = rule.functions.some((f) => fns.has(f));
    if (byRole || byFunction) allowed.add(type);
  }
  return allowed;
}

// --- Motor puro de mascaramento de registros --------------------------------

// Aplica mascaramento sobre os campos registrados de um registro, conforme o
// conjunto de tipos liberados. Devolve uma CÓPIA (não muta o original) e a
// lista dos campos efetivamente revelados (para auditoria LGPD).
export function maskFields<T extends Record<string, any>>(
  record: T,
  fieldTypes: Partial<Record<keyof T, SensitiveType>>,
  allowed: Set<SensitiveType>
): { masked: T; revealed: Array<{ field: string; type: SensitiveType }> } {
  // Cópia rasa: não mutamos o original; só sobrescrevemos campos mascarados.
  const masked: T = { ...record };
  const revealed: Array<{ field: string; type: SensitiveType }> = [];

  for (const key of Object.keys(fieldTypes) as Array<keyof T>) {
    const type = fieldTypes[key];
    if (!type) continue;
    if (allowed.has(type)) {
      // Liberado: mantém intacto e registra a revelação para auditoria.
      revealed.push({ field: String(key), type });
    } else {
      // Sem permissão: substitui pelo valor mascarado.
      (masked as Record<string, any>)[key as string] = maskValue(type, record[key]);
    }
  }
  return { masked, revealed };
}

// --- Mascaramento de VALORES DE CAMPOS DINÂMICOS (Passo 7) ------------------

// Forma mínima de um RequestFieldValue com o FormField incluído. Aceitamos um
// tipo estrutural (não o tipo gerado do Prisma) para manter o módulo desacoplado
// do client e facilmente testável.
export interface DynamicFieldValue {
  value: string;
  field: { key: string; sensitiveType?: string | null };
  // Demais colunas (id, requestId, ...) são preservadas via genérico.
  [k: string]: any;
}

// ATIVAÇÃO DO MASCARAMENTO (ponto LGPD-crítico do Passo 7).
// Para cada valor cujo `field.sensitiveType` está setado:
//  • se o tipo ∈ `allowed` → mantém o valor e registra a revelação (auditoria);
//  • senão → substitui `value` por `maskValue(sensitiveType, value)`.
// Valores sem `sensitiveType` NUNCA são tocados. Ao fim, grava o AuditLog de
// acesso sensível (o `field` no details = o `key` do FormField). Devolve a
// lista de valores (mascarados quando for o caso) — CÓPIAS, sem mutar o original.
//
// `allowed` é opcional: quando não informado, resolve uma vez via
// resolveViewerSensitiveAccess (REF.3 permite injetar para evitar 2ª consulta).
export async function maskDynamicFieldValues<T extends DynamicFieldValue>(
  user: { id: string; name?: string | null; role?: string | null },
  fieldValues: T[],
  db: Db = prisma,
  allowed?: Set<SensitiveType>
): Promise<T[]> {
  const allow = allowed ?? (await resolveViewerSensitiveAccess(user, db));
  const revealed: Array<{ field: string; type: SensitiveType }> = [];

  const out = fieldValues.map((fv) => {
    const st = fv.field?.sensitiveType as SensitiveType | null | undefined;
    if (!st) return fv; // campo não sensível: intacto.
    if (allow.has(st)) {
      // Liberado: mantém intacto e registra a revelação (key do FormField).
      revealed.push({ field: fv.field.key, type: st });
      return fv;
    }
    // Sem permissão: substitui o valor pela máscara por tipo (cópia rasa).
    return { ...fv, value: maskValue(st, fv.value) };
  });

  // Requeremos um requestId para auditar. Todos os valores de uma mesma
  // listagem pertencem à mesma Request; pegamos o primeiro disponível.
  const requestId = (fieldValues[0] as any)?.requestId;
  if (requestId) {
    await recordSensitiveAccess(db, { user, requestId, revealed });
  }
  return out;
}

// --- Auditoria de acesso (LGPD) ---------------------------------------------

// Grava UM AuditLog 'SENSITIVE_VIEW' quando o espectador efetivamente vê campos
// sensíveis sem máscara. Sem revelação, não grava nada. Falha de auditoria não
// quebra a resposta (try/catch interno; apenas loga no console).
export async function recordSensitiveAccess(
  db: Db,
  args: {
    user: { id: string; name?: string | null };
    requestId: string;
    revealed: Array<{ field: string; type: SensitiveType }>;
  }
): Promise<void> {
  if (!args.revealed.length) return;
  try {
    await db.auditLog.create({
      data: {
        requestId: args.requestId,
        userId: args.user.id,
        userName: args.user.name ?? '',
        action: 'SENSITIVE_VIEW',
        details: JSON.stringify({ fields: args.revealed }),
      },
    });
  } catch (err) {
    // Auditoria é melhor-esforço: nunca deve impedir a entrega da resposta.
    console.error('Falha ao registrar auditoria de acesso sensível (LGPD):', err);
  }
}
