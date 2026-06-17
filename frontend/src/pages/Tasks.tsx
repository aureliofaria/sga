import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCreateApproval, useMyTasks } from '../api/hooks';
import { formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';

export default function Tasks() {
  const { data: tasks, isLoading, isError } = useMyTasks();
  const approval = useCreateApproval();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  function approve(requestId: string) {
    approval.mutate({ requestId, decision: 'APPROVED' });
  }

  function submitReject(requestId: string) {
    if (!reason.trim()) return;
    approval.mutate(
      { requestId, decision: 'REJECTED', comments: reason.trim() },
      {
        onSuccess: () => {
          setRejecting(null);
          setReason('');
        },
      }
    );
  }

  if (isLoading) return <p className="text-slate-500">Carregando...</p>;
  if (isError) return <p className="text-red-600">Erro ao carregar tarefas.</p>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-800">Minhas Tarefas</h1>

      {!tasks?.length && (
        <p className="text-slate-500">Nenhuma tarefa pendente.</p>
      )}

      <ul className="space-y-3">
        {tasks?.map((task) => (
          <li
            key={task.id}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  to={`/requests/${task.request.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {task.title}
                </Link>
                <div className="mt-1 text-sm text-slate-500">
                  Solicitação: {task.request.title}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                  <StatusBadge status={task.status} />
                  {task.dueDate && (
                    <span>Prazo: {formatDate(task.dueDate)}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => approve(task.request.id)}
                  disabled={approval.isPending}
                  className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => {
                    setRejecting(task.id);
                    setReason('');
                  }}
                  disabled={approval.isPending}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Rejeitar
                </button>
              </div>
            </div>

            {rejecting === task.id && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Motivo da rejeição (obrigatório)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => submitReject(task.request.id)}
                    disabled={!reason.trim() || approval.isPending}
                    className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    Confirmar rejeição
                  </button>
                  <button
                    onClick={() => setRejecting(null)}
                    className="rounded px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
