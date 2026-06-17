import { useMemo, useState } from 'react';
import { exportAuditLogs, useAuditActions, useAuditLogs, useMe } from '../api/hooks';
import type { AuditLogFilters } from '../api/types';
import { formatDate } from '../lib/format';

const ALLOWED_ROLES = ['ADMIN', 'DIRETOR'];
const DEFAULT_LIMIT = 200;

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Criada',
  STEP_STARTED: 'Etapa iniciada',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  COMMENT_ADDED: 'Comentário',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export default function AuditLog() {
  const { data: me } = useMe();
  const isAllowed = me ? ALLOWED_ROLES.includes(me.role) : false;

  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [requestId, setRequestId] = useState('');
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const filters = useMemo<AuditLogFilters>(
    () => ({
      action: action || undefined,
      from: from || undefined,
      to: to || undefined,
      requestId: requestId.trim() || undefined,
      limit,
    }),
    [action, from, to, requestId, limit]
  );

  const { data: actions } = useAuditActions(isAllowed);
  const { data: logs, isLoading, isError } = useAuditLogs(filters, isAllowed);

  async function handleExport() {
    setExportError(false);
    setIsExporting(true);
    try {
      await exportAuditLogs(filters);
    } catch {
      setExportError(true);
    } finally {
      setIsExporting(false);
    }
  }

  if (me && !isAllowed) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold text-slate-800">Acesso restrito</h1>
        <p className="mt-2 text-sm text-slate-600">
          Você não tem permissão para visualizar a trilha de auditoria.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Auditoria</h1>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {isExporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
      </div>

      {exportError && (
        <p className="mb-3 text-sm text-red-600">Erro ao exportar.</p>
      )}

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Ação</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">Todas</option>
              {actions?.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">De</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Até</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">
              ID da Solicitação
            </span>
            <input
              type="text"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder="opcional"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Limite</span>
            <input
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || DEFAULT_LIMIT)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Carregando...</p>}
      {isError && (
        <p className="text-red-600">Erro ao carregar registros de auditoria.</p>
      )}

      {!isLoading && !isError && !logs?.length && (
        <p className="text-slate-500">Nenhum registro encontrado.</p>
      )}

      {!isLoading && !isError && !!logs?.length && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Data/Hora</th>
                <th className="px-4 py-2">Solicitação</th>
                <th className="px-4 py-2">Usuário</th>
                <th className="px-4 py-2">Ação</th>
                <th className="px-4 py-2">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {log.request?.title ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {log.userName ?? '-'}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {log.details ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
