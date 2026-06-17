import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAddComment, useComments, useRequest } from '../api/hooks';
import { formatCents, formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';
import type { AuditLog, FlowStep, RequestDetail as RequestDetailType } from '../api/types';

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Solicitação criada',
  STEP_STARTED: 'Etapa iniciada',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  COMMENT_ADDED: 'Comentário',
};

const ACTION_DOT_COLORS: Record<string, string> = {
  CREATED: 'bg-brand',
  STEP_STARTED: 'bg-amber-400',
  APPROVED: 'bg-green-500',
  COMPLETED: 'bg-green-500',
  REJECTED: 'bg-red-500',
  CANCELLED: 'bg-red-500',
  COMMENT_ADDED: 'bg-slate-400',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function actionDotColor(action: string): string {
  return ACTION_DOT_COLORS[action] ?? 'bg-slate-300';
}

/** Task fields the request-detail timeline relies on, beyond the base Task type. */
interface StepTask {
  id: string;
  status: string;
  dueDate?: string | null;
  completedAt?: string | null;
  step?: { id?: string; order?: number } | null;
}

type StepState = 'DONE' | 'CURRENT' | 'PENDING' | 'STOPPED';

interface SlaInfo {
  label: string;
  cls: string;
}

const STATE_LABELS: Record<StepState, string> = {
  DONE: 'Concluída',
  CURRENT: 'Em andamento',
  PENDING: 'Pendente',
  STOPPED: 'Interrompida',
};

function earliest(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (!valid.length) return null;
  return valid.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b));
}

function latest(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (!valid.length) return null;
  return valid.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b));
}

function deriveSla(
  state: StepState,
  dueDate: string | null,
  completedAt: string | null
): SlaInfo {
  if (state === 'DONE') {
    if (!dueDate) return { label: 'Sem SLA', cls: 'bg-slate-200 text-slate-700' };
    const onTime = completedAt ? new Date(completedAt) <= new Date(dueDate) : false;
    return onTime
      ? { label: 'No prazo', cls: 'bg-green-100 text-green-800' }
      : { label: 'Atrasado', cls: 'bg-red-100 text-red-800' };
  }
  if (state === 'STOPPED') {
    return { label: '—', cls: 'bg-slate-100 text-slate-500' };
  }
  // CURRENT or PENDING
  if (!dueDate) return { label: '—', cls: 'bg-slate-100 text-slate-500' };
  const overdue = new Date() > new Date(dueDate);
  return overdue
    ? { label: 'Vencido', cls: 'bg-red-100 text-red-800' }
    : { label: 'No prazo', cls: 'bg-green-100 text-green-800' };
}

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

      <StepsTimeline req={req} />

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

      <Comments requestId={req.id} steps={req.flow?.steps} />

      <Timeline logs={req.auditLogs} />
    </div>
  );
}

function Timeline({ logs }: { logs?: AuditLog[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
        Linha do tempo
      </h2>
      {!logs?.length ? (
        <p className="text-sm text-slate-500">Sem registros.</p>
      ) : (
        <ol className="space-y-4 border-l-2 border-slate-100 pl-5">
          {logs.map((log) => (
            <li key={log.id} className="relative text-sm">
              <span
                className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${actionDotColor(
                  log.action
                )}`}
              />
              <div className="font-medium text-slate-800">
                {actionLabel(log.action)}
              </div>
              {log.details && (
                <div className="text-slate-600">{log.details}</div>
              )}
              <div className="text-xs text-slate-400">
                {log.userName ? `${log.userName} · ` : ''}
                {formatDate(log.createdAt)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepsTimeline({ req }: { req: RequestDetailType }) {
  const steps = (req.flow?.steps ?? []) as FlowStep[];
  if (!steps.length) return null;

  const tasks = (req.tasks ?? []) as unknown as StepTask[];
  const currentStep =
    typeof req.currentStep === 'number'
      ? req.currentStep
      : Number(req.currentStep);
  const status = req.status?.toUpperCase();
  const isStopped = status === 'REJECTED' || status === 'CANCELLED';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
        Etapas
      </h2>
      <ol className="space-y-3">
        {steps.map((step, idx) => {
          const order = step.order ?? idx + 1;

          let state: StepState;
          if (
            (!Number.isNaN(currentStep) && currentStep > order) ||
            status === 'COMPLETED'
          ) {
            state = 'DONE';
          } else if (
            !Number.isNaN(currentStep) &&
            currentStep === order &&
            (status === 'PENDING' || status === 'IN_PROGRESS')
          ) {
            state = 'CURRENT';
          } else if (isStopped && !Number.isNaN(currentStep) && order >= currentStep) {
            state = 'STOPPED';
          } else {
            state = 'PENDING';
          }

          const stepTasks = tasks.filter(
            (t) => t.step?.order != null && t.step.order === order
          );
          const dueDate = earliest(stepTasks.map((t) => t.dueDate));
          const completedAt = latest(
            stepTasks
              .filter((t) => t.status?.toUpperCase() === 'COMPLETED')
              .map((t) => t.completedAt)
          );
          const sla = deriveSla(state, dueDate, completedAt);

          return (
            <li
              key={step.id ?? idx}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {order}
                </span>
                <span className="truncate text-slate-800">
                  {step.name ?? `Etapa ${order}`}
                </span>
                <StatusBadge status={STATE_LABELS[state]} />
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${sla.cls}`}
              >
                {sla.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Comments({
  requestId,
  steps,
}: {
  requestId: string;
  steps?: FlowStep[];
}) {
  const { data: comments, isLoading, isError } = useComments(requestId);
  const addComment = useAddComment(requestId);
  const [body, setBody] = useState('');
  const [stepValue, setStepValue] = useState('');

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    const stepOrder = stepValue === '' ? null : Number(stepValue);
    addComment.mutate(
      { body: trimmed, stepOrder },
      {
        onSuccess: () => {
          setBody('');
        },
      }
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">
        Comentários
      </h2>

      {isLoading && <p className="text-sm text-slate-500">Carregando...</p>}
      {isError && (
        <p className="text-sm text-red-600">Erro ao carregar comentários.</p>
      )}

      {!isLoading && !isError && !comments?.length && (
        <p className="text-sm text-slate-500">Nenhum comentário ainda.</p>
      )}

      {!!comments?.length && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">
                  {c.author?.name ?? '—'}
                </span>
                {c.stepOrder != null && (
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                    Etapa {c.stepOrder}
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  {formatDate(c.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-700">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        {!!steps?.length && (
          <select
            value={stepValue}
            onChange={(e) => setStepValue(e.target.value)}
            className="mb-2 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
          >
            <option value="">Geral</option>
            {steps.map((step, idx) => {
              const order = step.order ?? idx + 1;
              return (
                <option key={step.id ?? idx} value={order}>
                  Etapa {order}
                  {step.name ? ` — ${step.name}` : ''}
                </option>
              );
            })}
          </select>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Escreva um comentário..."
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
        />
        <div className="mt-2">
          <button
            onClick={submit}
            disabled={!body.trim() || addComment.isPending}
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            Comentar
          </button>
        </div>
      </div>
    </section>
  );
}
