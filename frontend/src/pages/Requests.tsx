import { Link } from 'react-router-dom';
import { useRequests } from '../api/hooks';
import { formatCents, formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';

export default function Requests() {
  const { data: requests, isLoading, isError } = useRequests();

  if (isLoading) return <p className="text-slate-500">Carregando...</p>;
  if (isError)
    return <p className="text-red-600">Erro ao carregar solicitações.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Solicitações</h1>
        <Link
          to="/requests/new"
          className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Nova Solicitação
        </Link>
      </div>

      {!requests?.length && (
        <p className="text-slate-500">Nenhuma solicitação encontrada.</p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Título</th>
              <th className="px-4 py-2">Fluxo</th>
              <th className="px-4 py-2">Valor</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Criado em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests?.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link
                    to={`/requests/${r.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.flow?.name ?? '-'}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {formatCents(r.amountCents)}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {formatDate(r.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
