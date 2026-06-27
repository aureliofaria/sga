// Espelho (frontend) das regras de categoria de pagamento validadas pelo backend
// (backend/src/lib/payments.ts). Mantém a UI alinhada às validações do servidor.
// Fonte de verdade continua sendo o backend; isto é só para guiar o formulário.

export interface PaymentCategoryDef {
  code: string;
  label: string;
  icon: string;
  desc: string;
  requiresSupplier: boolean;
  attachmentHint: string;
}

export const PAYMENT_CATEGORIES: PaymentCategoryDef[] = [
  { code: 'COMPRA', label: 'Compra', icon: '🛒', desc: 'Aquisição de bens/materiais', requiresSupplier: true, attachmentHint: 'Anexe a nota fiscal ou o orçamento.' },
  { code: 'SERVICO', label: 'Serviço', icon: '🔧', desc: 'Prestação de serviço pontual', requiresSupplier: true, attachmentHint: 'Anexe o contrato ou a nota de serviço.' },
  { code: 'ASSINATURA', label: 'Assinatura', icon: '🔁', desc: 'Licença / SaaS periódico', requiresSupplier: true, attachmentHint: 'Anexe o comprovante/contrato da assinatura.' },
  { code: 'RECORRENCIA', label: 'Recorrência', icon: '📅', desc: 'Pagamento periódico (aluguel, utilities)', requiresSupplier: true, attachmentHint: 'Anexe o contrato base.' },
  { code: 'SALARIO', label: 'Salário', icon: '💼', desc: 'Folha / pró-labore', requiresSupplier: false, attachmentHint: 'Anexe a folha/holerite.' },
  { code: 'REEMBOLSO', label: 'Reembolso', icon: '🧾', desc: 'Ressarcimento de despesa do colaborador', requiresSupplier: false, attachmentHint: 'Anexe o comprovante da despesa (obrigatório).' },
];

export function getCategory(code: string): PaymentCategoryDef | undefined {
  return PAYMENT_CATEGORIES.find((c) => c.code === code);
}

// Categorias adequadas a recorrências (default sugerido na UI de recorrência).
export const RECURRING_CATEGORIES = ['RECORRENCIA', 'ASSINATURA', 'SALARIO'];
