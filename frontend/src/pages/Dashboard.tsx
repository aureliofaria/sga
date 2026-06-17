import { useMemo, useState } from 'react';
import { useDashboard, useMe } from '../api/hooks';
import type { DashboardFilters, DashboardReport } from '../api/types';
import { formatDate } from '../lib/format';

const ALLOWED_ROLES = ['ADMIN', 'DIRETOR', 'MANAGER'];

const FLOW_TYPES = ['ONBOARDING', 'OFFBOARDING', 'PAYMENT'];

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-400',
  IN_PROGRESS: 'bg-blue-400',
  COMPLETED: 'bg-green-500',
  REJECTED: 'bg-red-500',
  CANCELLED: 'bg-slate-400',
};

const SLA_SEGMENTS: { key: keyof DashboardReport['sla']; label: string; color: string }[] = [
  { key: 'onTime', label: 'No prazo', color: 'bg-green-500' },
  { key: 'late', label: 'Atrasado', color: 'bg-red-500' },
  { key: 'pendingOnTrack', label: 'Pendente no prazo', color: 'bg-amber-400' },
  { key: 'overduePending', label: 'Pendente vencida', color: 'bg-red-800' },
  { key: 'noSla', label: 'Sem SLA', color: 'bg-slate-400' },
];

function KpiCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${
          highlight ? 'text-red-600' : 'text-slate-800'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBars({ counts }: { counts: DashboardReport['statusCounts'] }) {
  const entries = Object.entries(counts) as [keyof typeof counts, number][];
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="space-y-2">
      {entries.map(([status, count]) => (
        <div key={status} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-slate-600">
            {STATUS_LABELS[status] ?? status}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <div
              className={`h-full ${STATUS_BAR_COLORS[status] ?? 'bg-slate-400'}`}
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-medium text-slate-700">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

function SlaBreakdown({ sla }: { sla: DashboardReport['sla'] }) {
  const total =
    sla.onTime + sla.late + sla.pendingOnTrack + sla.overduePending + sla.noSla;
  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded bg-slate-100">
        {total > 0 &&
          SLA_SEGMENTS.map((seg) => {
            const value = sla[seg.key] as number;
            if (!value) return null;
            return (
              <div
                key={seg.key}
                className={seg.color}
                style={{ width: `${(value / total) * 100}%` }}
                title={`${seg.label}: ${value}`}
              />
            );
          })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {SLA_SEGMENTS.map((seg) => (
          <li key={seg.key} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-sm ${seg.color}`} />
            <span className="text-slate-600">{seg.label}</span>
            <span className="ml-auto font-medium text-slate-700">
              {sla[seg.key] as number}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowTypeList({ items }: { items: DashboardReport['byFlowType'] }) {
  if (!items.length)
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.type} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-slate-600">
            {item.name}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <div
              className="h-full bg-brand"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-medium text-slate-700">
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function ThroughputChart({
  data,
}: {
  data: DashboardReport['throughput'];
}) {
  if (!data.length)
    return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  const max = Math.max(
    1,
    ...data.map((d) => Math.max(d.created, d.completed))
  );
  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 140 }}>
        {data.map((d) => (
          <div
            key={d.date}
            className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-0.5"
            title={`${formatDate(d.date)} — Criadas: ${d.created} · Concluídas: ${d.completed}`}
          >
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <div
                className="w-1/2 rounded-t bg-brand"
                style={{ height: `${(d.created / max) * 100}%` }}
              />
              <div
                className="w-1/2 rounded-t bg-green-500"
                style={{ height: `${(d.completed / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-brand" /> Criadas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-green-500" /> Concluídas
        </span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: me } = useMe();
  const isAllowed = me ? ALLOWED_ROLES.includes(me.role) : false;

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flowType, setFlowType] = useState('');

  const filters = useMemo<DashboardFilters>(
    () => ({
      from: from || undefined,
      to: to || undefined,
      flowType: flowType || undefined,
    }),
    [from, to, flowType]
  );

  const { data, isLoading, isError } = useDashboard(filters, isAllowed);

  if (me && !isAllowed) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold text-slate-800">Acesso restrito</h1>
        <p className="mt-2 text-sm text-slate-600">
          Você não tem permissão para visualizar o painel de relatórios.
        </p>
      </div>
    );
  }

  const compliance =
    data?.sla.complianceRate == null
      ? '—'
      : `${Math.round(data.sla.complianceRate * 100) / 100}%`;
  const avgHours =
    data?.sla.avgCompletionHours == null
      ? '—'
      : `${Math.round(data.sla.avgCompletionHours)}h`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Painel de Relatórios</h1>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              Tipo de fluxo
            </span>
            <select
              value={flowType}
              onChange={(e) => setFlowType(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="">Todas</option>
              {FLOW_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Carregando...</p>}
      {isError && (
        <p className="text-red-600">Erro ao carregar o painel.</p>
      )}

      {!isLoading && !isError && data && (
        <>
          <div className="text-sm text-slate-500">
            Período: {formatDate(data.range.from)} — {formatDate(data.range.to)}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Total de solicitações"
              value={String(data.totals.requests)}
            />
            <KpiCard label="Em aberto" value={String(data.totals.open)} />
            <KpiCard
              label="Concluídas"
              value={String(data.totals.completed)}
            />
            <KpiCard
              label="Rejeitadas"
              value={String(data.totals.rejected)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard label="Conformidade SLA" value={compliance} />
            <KpiCard label="Tempo médio de conclusão" value={avgHours} />
            <KpiCard
              label="Pendentes vencidas"
              value={String(data.sla.overduePending)}
              highlight={data.sla.overduePending > 0}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase text-slate-500">
                Distribuição por status
              </h2>
              <StatusBars counts={data.statusCounts} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase text-slate-500">
                Análise de SLA
              </h2>
              <SlaBreakdown sla={data.sla} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase text-slate-500">
                Por tipo de fluxo
              </h2>
              <FlowTypeList items={data.byFlowType} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase text-slate-500">
                Volume diário (criadas vs concluídas)
              </h2>
              <ThroughputChart data={data.throughput} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
