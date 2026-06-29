// ============================================================================
// Checklist por etapa (Fase 0 · Passo 8).
//
// Tipos, avaliação de condições e gating de conclusão de tarefas.
// Espelha a estrutura de fieldValidation/requiredFieldsUnmet do Passo 7.
// ============================================================================

import { Prisma } from '@prisma/client';
import prisma from './prisma';

// Aceita cliente de transação ou o cliente global.
export type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Tipos de condição fechados
// ---------------------------------------------------------------------------

export type ChecklistCondition =
  | { type: 'resourceItem'; resourceItemId: string }
  | { type: 'fieldValue'; fieldKey: string; equals: string };

// Tenta parsear a string JSON de condição. Retorna null em caso de falha
// ou de payload inválido (fail-safe: item sem condição reconhecida é tratado
// como aplicável na avaliação).
export function parseCondition(json: string | null | undefined): ChecklistCondition | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== 'object') return null;
    if (o.type === 'resourceItem' && typeof o.resourceItemId === 'string') {
      return { type: 'resourceItem', resourceItemId: o.resourceItemId };
    }
    if (o.type === 'fieldValue' && typeof o.fieldKey === 'string' && typeof o.equals === 'string') {
      return { type: 'fieldValue', fieldKey: o.fieldKey, equals: o.equals };
    }
    // Tipo desconhecido: fail-safe permissivo (retorna null → avaliado como true).
    return null;
  } catch {
    return null;
  }
}

// Valida a estrutura do payload de condição vindo da API (POST/PUT de checklist
// items). Retorna { ok } + mensagem de erro em PT-BR quando inválido.
export function validateConditionPayload(
  raw: unknown
): { ok: true; json: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    // Sem condição: sempre aplicável.
    return { ok: true, json: JSON.stringify(null) };
  }
  let o: unknown;
  try {
    o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'condition deve ser JSON válido' };
  }
  if (o === null) return { ok: true, json: JSON.stringify(null) };
  if (typeof o !== 'object' || Array.isArray(o)) {
    return { ok: false, error: 'condition deve ser um objeto JSON' };
  }
  const c = o as Record<string, unknown>;
  if (c.type === 'resourceItem') {
    if (typeof c.resourceItemId !== 'string' || !c.resourceItemId) {
      return { ok: false, error: 'condition.resourceItemId é obrigatório para type=resourceItem' };
    }
    return { ok: true, json: JSON.stringify({ type: 'resourceItem', resourceItemId: c.resourceItemId }) };
  }
  if (c.type === 'fieldValue') {
    if (typeof c.fieldKey !== 'string' || !c.fieldKey) {
      return { ok: false, error: 'condition.fieldKey é obrigatório para type=fieldValue' };
    }
    if (typeof c.equals !== 'string') {
      return { ok: false, error: 'condition.equals é obrigatório para type=fieldValue' };
    }
    return { ok: true, json: JSON.stringify({ type: 'fieldValue', fieldKey: c.fieldKey, equals: c.equals }) };
  }
  return {
    ok: false,
    error: `condition.type inválido ("${String(c.type)}"); use "resourceItem" ou "fieldValue"`,
  };
}

// ---------------------------------------------------------------------------
// Contexto pré-carregado para avaliação em memória (REF.1)
// Evita N+1 no GET /:id carregando uma vez todos os dados da solicitação.
// ---------------------------------------------------------------------------

export interface ApplicabilityContext {
  /** IDs dos resourceItems vinculados à solicitação. */
  resourceItemIds: Set<string>;
  /**
   * Mapa de field.key → CONJUNTO de valores preenchidos para essa key na
   * solicitação. É um Set (não um único valor) porque `FormField.key` é único
   * só por ETAPA: a mesma key pode existir em etapas distintas com valores
   * diferentes. Guardar todos os valores casa com a semântica exists/any do
   * gate (`isItemApplicable`), evitando divergência GET-vs-gating.
   */
  fieldValues: Map<string, Set<string>>;
}

// Avalia se um item é aplicável dado um contexto já carregado (sem queries).
// Usado pelo GET /:id para evitar N+1. Mesma semântica exists/any do gate.
export function evaluateConditionInMemory(
  condition: ChecklistCondition | null,
  ctx: ApplicabilityContext
): boolean {
  if (!condition) return true;
  if (condition.type === 'resourceItem') {
    return ctx.resourceItemIds.has(condition.resourceItemId);
  }
  if (condition.type === 'fieldValue') {
    // exists/any: a key tem ALGUM valor igual ao esperado (em qualquer etapa).
    return ctx.fieldValues.get(condition.fieldKey)?.has(condition.equals) ?? false;
  }
  // Tipo desconhecido: fail-safe permissivo.
  return true;
}

// Avalia aplicabilidade de uma lista de itens em memória e retorna cada item
// anotado com `applicable`. Exportado para uso no GET /:id da rota requests.
export function evaluateApplicabilityInMemory<T extends { condition: string | null }>(
  items: T[],
  ctx: ApplicabilityContext
): (T & { applicable: boolean })[] {
  return items.map((item) => ({
    ...item,
    applicable: evaluateConditionInMemory(parseCondition(item.condition), ctx),
  }));
}

// ---------------------------------------------------------------------------
// isItemApplicable — consulta ao banco (usa-se na escrita/marcar/desmarcar,
// onde o contexto não está pré-carregado).
// ---------------------------------------------------------------------------

export async function isItemApplicable(
  item: { condition: string | null },
  requestId: string,
  db: Db = prisma
): Promise<boolean> {
  const cond = parseCondition(item.condition);
  if (!cond) return true;

  if (cond.type === 'resourceItem') {
    const exists = await (db as typeof prisma).requestResource.count({
      where: { requestId, resourceItemId: cond.resourceItemId },
    });
    return exists > 0;
  }

  if (cond.type === 'fieldValue') {
    const fv = await (db as typeof prisma).requestFieldValue.findFirst({
      where: {
        requestId,
        field: { key: cond.fieldKey },
        value: cond.equals,
      },
    });
    return fv !== null;
  }

  // Tipo desconhecido: fail-safe permissivo.
  return true;
}

// ---------------------------------------------------------------------------
// checklistUnmet — gating de conclusão de tarefa (espelha requiredFieldsUnmet)
// ---------------------------------------------------------------------------

// Retorna os labels dos ChecklistItems OBRIGATÓRIOS da etapa que estão
// aplicáveis e ainda não foram marcados como checked. Lista vazia = ok.
export async function checklistUnmet(
  stepId: string,
  requestId: string,
  db: Db = prisma
): Promise<string[]> {
  const items = await (db as typeof prisma).checklistItem.findMany({
    where: { flowStepId: stepId, required: true },
    select: { id: true, label: true, condition: true },
  });
  if (items.length === 0) return [];

  const pending: string[] = [];
  for (const item of items) {
    const applicable = await isItemApplicable(item, requestId, db);
    if (!applicable) continue;

    const state = await (db as typeof prisma).requestChecklistItem.findUnique({
      where: { requestId_itemId: { requestId, itemId: item.id } },
      select: { checked: true },
    });
    if (!state || !state.checked) {
      pending.push(item.label);
    }
  }
  return pending;
}
