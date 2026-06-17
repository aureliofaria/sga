import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRequest } from '../api/hooks';
import { formatCents, formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value ?? '-'}</dd>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: req, isLoading, isError } = useRequest(id);

  if (isLoading) return <p className="text-slate-500">Carregando...</p>;
  if (isError || !req)
    return <p className="text-red-600">Erro ao carregar a solicitação.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/requests"
          className="text-sm text-brand-700 hover:underline"
        >
          &larr; Voltar
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{req.title}</h1>
          <StatusBadge status={req.status} />
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
          Dados
        </h2>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Fluxo" value={req.flow?.name} />
          <Field label="Solicitante" value={req.initiator?.name} />
          <Field label="Valor" value={formatCents(req.amountCents)} />
          <Field label="Etapa atual" value={req.currentStep} />
          <Field label="Fornecedor" value={req.supplier} />
          <Field label="Centro de Custo" value={req.costCenter} />
          <Field label="Criado em" value={formatDate(req.createdAt)} />
        </dl>
        {req.description && (
          <div className="mt-4">
            <dt className="text-xs uppercase text-slate-400">Descrição</dt>
            <dd className="text-sm text-slate-800">{req.description}</dd>
          </div>
        )}
        {req.justification && (
          <div className="mt-4">
            <dt className="text-xs uppercase text-slate-400">Justificativa</dt>
            <dd className="text-sm text-slate-800">{req.justification}</dd>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
          Tarefas
        </h2>
        {!req.tasks?.length ? (
          <p className="text-sm text-slate-500">Nenhuma tarefa.</p>
        ) : (
          <ul className="space-y-2">
            {req.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-slate-800">{t.title}</span>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
          Aprovações
        </h2>
        {!req.approvals?.length ? (
          <p className="text-sm text-slate-500">Nenhuma aprovação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {req.approvals.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.decision} />
                  <span className="text-slate-700">
                    {a.approver?.name ?? '—'}
                  </span>
                  <span className="text-slate-400">
                    {formatDate(a.createdAt)}
                  </span>
                </div>
                {a.comments && (
                  <p className="ml-1 mt-0.5 text-slate-600">{a.comments}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
          Histórico
        </h2>
        {!req.auditLogs?.length ? (
          <p className="text-sm text-slate-500">Sem registros.</p>
        ) : (
          <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
            {req.auditLogs.map((log) => (
              <li key={log.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand" />
                <div className="font-medium text-slate-800">{log.action}</div>
                {log.message && (
                  <div className="text-slate-600">{log.message}</div>
                )}
                <div className="text-xs text-slate-400">
                  {log.actor?.name ? `${log.actor.name} · ` : ''}
                  {formatDate(log.createdAt)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
