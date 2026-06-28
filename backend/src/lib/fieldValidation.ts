// ============================================================================
// Validação de valores de campos dinâmicos (Fase 0 · Passo 7).
//
// REFINAMENTO 2 (Maestro) — validação TOLERANTE: CPF/RG/PHONE aceitam COM ou
// SEM pontuação/máscara (ex.: '123.456.789-09' e '12345678909' são ambos
// válidos). Não bloqueamos entrada legítima por formatação. EMAIL/NUMBER/DATE/
// MONEY são validados de forma sensata. O valor é ARMAZENADO como enviado
// (apenas `trim` na rota), pois o mascaramento é por TIPO (constante) e nunca
// vaza independentemente do formato armazenado.
// ============================================================================

import { parseCents } from './money';

// Tipos de campo dinâmico suportados pelo formulário por etapa.
export const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'EMAIL',
  'CPF',
  'RG',
  'MONEY',
  'PHONE',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(t: unknown): t is FieldType {
  return typeof t === 'string' && (FIELD_TYPES as readonly string[]).includes(t);
}

// Só os dígitos do valor (descarta pontuação/máscara). Usado por CPF/RG/PHONE.
function digits(v: string): string {
  return v.replace(/\D/g, '');
}

// Validação de CPF com dígitos verificadores (algoritmo da Receita). Aceita
// com ou sem máscara. Rejeita sequências repetidas (ex.: 11111111111).
function isValidCpf(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const calc = (slice: number): number => {
    let sum = 0;
    for (let i = 0; i < slice; i++) sum += Number(d[i]) * (slice + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

// RG não tem algoritmo nacional único; aceitamos comprimento plausível de
// dígitos (com ou sem máscara/dígito 'X' final comum em SP). Tolerante por design.
function isValidRg(raw: string): boolean {
  const cleaned = raw.replace(/[.\-\s]/g, '').toUpperCase();
  // 5 a 14 caracteres alfanuméricos, opcionalmente terminando em X.
  if (!/^[0-9]{4,13}[0-9X]$/.test(cleaned)) return false;
  return cleaned.length >= 5 && cleaned.length <= 14;
}

// Telefone BR: aceita com ou sem máscara; 10 (fixo c/ DDD) ou 11 (celular c/ DDD)
// dígitos. Tolerante a parênteses/espaços/hífen/+55.
function isValidPhone(raw: string): boolean {
  let d = digits(raw);
  // Tolera prefixo internacional do Brasil (+55).
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11;
}

// E-mail: validação sensata (não exaustiva por RFC, mas bloqueia lixo óbvio).
function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

// Data: aceita ISO (YYYY-MM-DD, com ou sem horário) que o Date reconheça.
function isValidDate(raw: string): boolean {
  // Exige ao menos o formato YYYY-MM-DD para não aceitar texto solto.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return false;
  const t = Date.parse(raw);
  return Number.isFinite(t);
}

// Número genérico: finito (aceita decimais e negativos).
function isValidNumber(raw: string): boolean {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n);
}

// Dinheiro: validado via parseCents (mesma porta monetária do resto do APROVA).
// Aceita números e strings numéricas; rejeita lixo não-numérico.
function isValidMoney(raw: string): boolean {
  const r = parseCents(raw);
  return r.ok && r.value !== null;
}

// Valida um valor para o tipo do campo. Retorna { ok } e, em falha, uma mensagem
// PT-BR. Valor vazio NÃO é validado aqui (a obrigatoriedade é checada à parte,
// pela guarda de campos obrigatórios pré-conclusão).
export function validateFieldValue(type: string, value: string): { ok: boolean; error?: string } {
  const v = (value ?? '').trim();
  if (v === '') return { ok: true }; // vazio: trata-se como "não preenchido"

  switch (type as FieldType) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'SELECT':
      return { ok: true };
    case 'NUMBER':
      return isValidNumber(v) ? { ok: true } : { ok: false, error: 'Número inválido' };
    case 'MONEY':
      return isValidMoney(v) ? { ok: true } : { ok: false, error: 'Valor monetário inválido' };
    case 'DATE':
      return isValidDate(v) ? { ok: true } : { ok: false, error: 'Data inválida (use AAAA-MM-DD)' };
    case 'EMAIL':
      return isValidEmail(v) ? { ok: true } : { ok: false, error: 'E-mail inválido' };
    case 'CPF':
      return isValidCpf(v) ? { ok: true } : { ok: false, error: 'CPF inválido' };
    case 'RG':
      return isValidRg(v) ? { ok: true } : { ok: false, error: 'RG inválido' };
    case 'PHONE':
      return isValidPhone(v) ? { ok: true } : { ok: false, error: 'Telefone inválido' };
    default:
      // Tipo desconhecido não deveria chegar (validado no CRUD), mas é fail-safe:
      // não aceita silenciosamente um tipo fora do contrato.
      return { ok: false, error: 'Tipo de campo desconhecido' };
  }
}
