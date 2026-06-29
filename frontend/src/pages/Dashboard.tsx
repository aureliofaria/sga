import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { requestsApi, tasksApi, reportsApi } from '../services/api';
import { StatusBadge, FlowTypeBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const canSeeReports = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const { data: requests = [] } = useQuery({ queryKey: ['requests'], queryFn: () => requestsApi.getAll() });
  const { data: tasks = [] } = useQuery({ queryKey: ['myTasks'], queryFn: () => tasksApi.getMy() });
  const { data: report } = useQuery({ queryKey: ['reportDashboard'], queryFn: () => reportsApi.dashboard(), enabled: canSeeReports });

  const stats = {
    total: requests.length,
    pending: requests.filter((r) => ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'].includes(r.status)).length,
    approved: requests.filter((r) => ['APPROVED', 'COMPLETED'].includes(r.status)).length,
    myTasks: tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'REJECTED').length,
  };

  const recent = requests.slice(0, 5);
  const pendingTasks = tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'REJECTED').slice(0, 5);

  return (
    <div>
      <Header title="Dashboard" subtitle="Visão geral do sistema" />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total de Solicitações', value: stats.total, color: 'bg-golplus-blue-50 text-golplus-blue-700', icon: '📋' },
          { label: 'Em Andamento', value: stats.pending, color: 'bg-yellow-50 text-yellow-700', icon: '⏳' },
          { label: 'Aprovadas/Concluídas', value: stats.approved, color: 'bg-green-50 text-green-700', icon: '✅' },
          { label: 'Minhas Tarefas', value: stats.myTasks, color: 'bg-purple-50 text-purple-700', icon: '📌' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xl">{stat.icon}</span>
              <span className={`text-3xl font-bold ${stat.color.split(' ')[1]}`}>{stat.value}</span>
            </div>
            <p className="text-sm text-gray-600">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* SLA / Relatórios (gestão) */}
      {canSeeReports && report && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Indicadores de SLA <span className="text-gray-400 font-normal">· últimos 30 dias</span></h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">{report.sla.complianceRate != null ? `${report.sla.complianceRate}%` : '—'}</div>
              <div className="text-sm text-gray-500 mt-1">Conformidade de prazo</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-2xl font-bold text-red-600">{report.sla.overduePending}</div>
              <div className="text-sm text-gray-500 mt-1">Tarefas vencidas em aberto</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-2xl font-bold text-golplus-blue-700">{report.sla.avgCompletionHours != null ? `${report.sla.avgCompletionHours}h` : '—'}</div>
              <div className="text-sm text-gray-500 mt-1">Tempo médio de conclusão</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{report.totals.completed}</div>
              <div className="text-sm text-gray-500 mt-1">Concluídas no período</div>
            </div>
          </div>
          {report.byFlowType.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Volume por tipo de fluxo</h3>
              <div className="space-y-2">
                {report.byFlowType.map((f) => {
                  const max = Math.max(...report.byFlowType.map((x) => x.count));
                  return (
                    <div key={f.type} className="flex items-center gap-3">
                      <span className="w-40 flex-shrink-0"><FlowTypeBadge type={f.type} /></span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                        <div className="bg-golplus-blue-500 h-2.5 rounded-full" style={{ width: `${max ? (f.count / max) * 100 : 0}%` }} />
                      </div>
                      <span className="text-sm text-gray-600 w-8 text-right">{f.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Requests */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Solicitações Recentes</h2>
            <Link to="/requests" className="text-sm text-golplus-blue-600 hover:text-golplus-blue-800">Ver todas</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recent.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">Nenhuma solicitação encontrada</p>
            )}
            {recent.map((req) => (
              <Link key={req.id} to={`/requests/${req.id}`} className="block px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{req.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{req.initiator?.name} · {req.flow?.name}</p>
                  </div>
                  <div className="ml-4 flex items-center gap-2 flex-shrink-0">
                    {req.statusLabel
                      ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-golplus-blue-100 text-golplus-blue-800" title={req.status}>{req.statusLabel}</span>
                      : <StatusBadge status={req.status} />}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Minhas Tarefas Pendentes</h2>
            <Link to="/tasks" className="text-sm text-golplus-blue-600 hover:text-golplus-blue-800">Ver todas</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingTasks.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">Nenhuma tarefa pendente</p>
            )}
            {pendingTasks.map((task) => {
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
              return (
                <Link key={task.id} to={`/requests/${task.requestId}`} className="block px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{task.request?.title}</p>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      {isOverdue && (
                        <span className="text-xs text-red-600 font-medium">Atrasada</span>
                      )}
                      <StatusBadge status={task.status} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
