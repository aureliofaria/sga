import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { requestsApi, tasksApi } from '../services/api';
import { StatusBadge, FlowTypeBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Dashboard() {
  const { data: requests = [] } = useQuery({ queryKey: ['requests'], queryFn: () => requestsApi.getAll() });
  const { data: tasks = [] } = useQuery({ queryKey: ['myTasks'], queryFn: () => tasksApi.getMy() });

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
          { label: 'Total de Solicitações', value: stats.total, color: 'bg-blue-50 text-blue-700', icon: '📋' },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Requests */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Solicitações Recentes</h2>
            <Link to="/requests" className="text-sm text-blue-600 hover:text-blue-800">Ver todas</Link>
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
                    <StatusBadge status={req.status} />
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
            <Link to="/tasks" className="text-sm text-blue-600 hover:text-blue-800">Ver todas</Link>
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
