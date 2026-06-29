interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const statusMap: Record<string, { label: string; className: string }> = {
  // Request statuses
  DRAFT: { label: 'Rascunho', className: 'bg-gray-100 text-gray-700' },
  PENDING: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-800' },
  IN_PROGRESS: { label: 'Em Andamento', className: 'bg-golplus-blue-100 text-golplus-blue-800' },
  AWAITING_APPROVAL: { label: 'Aguardando Aprovação', className: 'bg-orange-100 text-orange-800' },
  APPROVED: { label: 'Aprovado', className: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rejeitado', className: 'bg-red-100 text-red-800' },
  COMPLETED: { label: 'Concluído', className: 'bg-emerald-100 text-emerald-800' },
  ALLOCATED: { label: 'Alocado', className: 'bg-teal-100 text-teal-800' },
  RETURNED: { label: 'Devolvido', className: 'bg-amber-100 text-amber-800' },
  CANCELLED: { label: 'Cancelado', className: 'bg-gray-100 text-gray-500' },
  // Task statuses (some overlap)
  CHANGES_REQUESTED: { label: 'Revisão Solicitada', className: 'bg-amber-100 text-amber-800' },
};

const flowTypeMap: Record<string, { label: string; className: string }> = {
  ONBOARDING: { label: 'Admissão', className: 'bg-green-100 text-green-800' },
  OFFBOARDING: { label: 'Desligamento', className: 'bg-red-100 text-red-800' },
  PAYMENT: { label: 'Pagamento', className: 'bg-golplus-blue-100 text-golplus-blue-800' },
  PURCHASE: { label: 'Compra', className: 'bg-purple-100 text-purple-800' },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const info = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${info.className} ${sizeClass}`}>
      {info.label}
    </span>
  );
}

export function FlowTypeBadge({ type }: { type: string }) {
  const info = flowTypeMap[type] || { label: type, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
      {info.label}
    </span>
  );
}

export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    // Aplicação
    ADMIN: 'Administrador',
    DIRETORIA: 'Diretoria',
    // Funções (usadas pelos fluxos/trilha)
    RH: 'RH',
    FINANCEIRO: 'Financeiro',
    TI: 'TI',
    DADOS: 'Dados',
    SISTEMAS: 'Sistemas',
    ADMINISTRATIVO: 'Administrativo',
    // Genérico / legado
    MANAGER: 'Gestor',
    FINANCE: 'Financeiro',
    HR: 'RH',
    USER: 'Usuário',
  };
  return map[role] || role;
}
