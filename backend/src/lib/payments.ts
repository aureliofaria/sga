// Domínio de Pagamentos: categorias, campos obrigatórios por categoria e
// validação de valor. Centraliza as regras para que rotas, serviço de
// recorrência e testes compartilhem a MESMA fonte de verdade.

export const PAYMENT_CATEGORIES = [
  'COMPRA',
  'SERVICO',
  'ASSINATURA',
  'RECORRENCIA',
  'SALARIO',
  'REEMBOLSO',
] as const;

export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

// Teto sanitário para barrar overflow / valores absurdos: R$ 100.000.000,00.
export const MAX_PAYMENT_CENTS = 10_000_000_000;

// Campos extras obrigatórios por categoria (além dos comuns: title,
// amountCents>0, costCenter, justification).
const EXTRA_REQUIRED_FIELDS: Record<PaymentCategory, string[]> = {
  COMPRA: ['supplier'],
  SERVICO: ['supplier'],
  ASSINATURA: ['supplier'],
  RECORRENCIA: ['supplier'],
  SALARIO: [],
  REEMBOLSO: [],
};

// Categorias que exigem ao menos um anexo já na etapa de solicitação.
export const CATEGORIES_REQUIRING_ATTACHMENT: ReadonlySet<PaymentCategory> = new Set<PaymentCategory>([
  'COMPRA',
  'SERVICO',
  'ASSINATURA',
  'RECORRENCIA',
  'SALARIO',
  'REEMBOLSO',
]);

export function isPaymentCategory(value: unknown): value is PaymentCategory {
  return typeof value === 'string' && (PAYMENT_CATEGORIES as readonly string[]).includes(value);
}

// Valida o valor de um pagamento (em centavos inteiros). Retorna mensagem de
// erro (string) ou null se válido. Pressupõe que o valor já passou por
// parseCents (inteiro/finito); aqui aplicamos a regra de NEGÓCIO: > 0 e teto.
export function validatePaymentAmount(amountCents: number | null | undefined): string | null {
  if (amountCents == null) return 'O valor do pagamento é obrigatório';
  if (!Number.isInteger(amountCents)) return 'O valor deve estar em centavos inteiros';
  if (amountCents <= 0) return 'O valor do pagamento deve ser maior que zero';
  if (amountCents > MAX_PAYMENT_CENTS) return 'O valor do pagamento excede o limite permitido';
  return null;
}

interface PaymentFields {
  paymentCategory?: unknown;
  amountCents?: number | null;
  costCenter?: unknown;
  justification?: unknown;
  supplier?: unknown;
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

// Validação completa de um pedido de PAGAMENTO na criação. Retorna a primeira
// mensagem de erro encontrada (para resposta 400) ou null se tudo OK.
// NÃO valida anexo aqui (criação e upload são chamadas HTTP distintas) — a
// exigência de anexo é cobrada ao concluir a etapa 0 (requiresAttachment).
export function validatePaymentRequest(fields: PaymentFields): string | null {
  if (!isPaymentCategory(fields.paymentCategory)) {
    return 'Categoria de pagamento inválida ou ausente';
  }
  const amountError = validatePaymentAmount(fields.amountCents);
  if (amountError) return amountError;

  if (!isNonEmpty(fields.costCenter)) return 'O centro de custo é obrigatório';
  if (!isNonEmpty(fields.justification)) return 'A justificativa é obrigatória';

  for (const field of EXTRA_REQUIRED_FIELDS[fields.paymentCategory]) {
    if (!isNonEmpty((fields as any)[field])) {
      return `O campo "${field}" é obrigatório para esta categoria de pagamento`;
    }
  }
  return null;
}
