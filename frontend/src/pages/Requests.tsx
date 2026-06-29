import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { requestsApi } from '../services/api';
import { StatusBadge, FlowTypeBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Requests() {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['requests', statusFilter, typeFilter, search],
    queryFn: () => requestsApi.getAll({ status: statusFilter || undefined, type: typeFilter || undefined, search: search || undefined }),
  });

  const formatCurrency = (cents?: number) =>
    cents != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) : '-';

  return (
    <div>
      <Header
        title="Solicitações"
        subtitle="Gerencie todas as solicitações do sistema"
        actions={
          <Link to="/requests/new" className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700">
            + Nova Solicitação
          </Link>
        }
      />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por título..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        >
          <option value="">Todos os status</option>
          <option value="PENDING">Pendente</option>
          <option value="IN_PROGRESS">Em Andamento</option>
          <option value="AWAITING_APPROVAL">Aguardando Aprovação</option>
          <option value="APPROVED">Aprovado</option>
          <option value="REJECTED">Rejeitado</option>
          <option value="COMPLETED">Concluído</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        >
          <option value="">Todos os tipos</option>
          <option value="ONBOARDING">Admissão</option>
          <option value="OFFBOARDING">Desligamento</option>
          <option value="PAYMENT">Pagamento</option>
          <option value="PURCHASE">Compra</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Título</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tipo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Solicitante</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500 text-sm">Carregando...</td></tr>
              )}
              {!isLoading && requests.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500 text-sm">Nenhuma solicitação encontrada</td></tr>
              )}
              {requests.map((req) => (
                <tr
                  key={req.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => window.location.href = `/requests/${req.id}`}
                >
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-gray-900">{req.title}</p>
                    {req.description && <p className="text-xs text-gray-500 truncate max-w-xs">{req.description}</p>}
                  </td>
                  <td className="px-5 py-3"><FlowTypeBadge type={req.flow?.type} /></td>
                  <td className="px-5 py-3 text-sm text-gray-600">{req.initiator?.name}</td>
                  <td className="px-5 py-3">
                    {req.statusLabel
                      ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-golplus-blue-100 text-golplus-blue-800" title={req.status}>{req.statusLabel}</span>
                      : <StatusBadge status={req.status} />}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{formatCurrency(req.amountCents)}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">
                    {format(new Date(req.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
