import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tasksApi } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { format, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function CompleteModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => tasksApi.complete(taskId, notes),
    onSuccess: () => { toast.success('Tarefa concluída!'); qc.invalidateQueries({ queryKey: ['myTasks'] }); onClose(); },
    onError: () => toast.error('Erro ao concluir tarefa'),
  });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Concluir Tarefa</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional)" rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {mutation.isPending ? 'Salvando...' : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyTasks() {
  const [statusFilter, setStatusFilter] = useState('');
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['myTasks'], queryFn: () => tasksApi.getMy() });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => tasksApi.reject(id, 'Rejeitado pelo responsável'),
    onSuccess: () => { toast.success('Tarefa rejeitada'); qc.invalidateQueries({ queryKey: ['myTasks'] }); },
    onError: () => toast.error('Erro ao rejeitar tarefa'),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => tasksApi.update(id, { status: 'IN_PROGRESS' }),
    onSuccess: () => { toast.success('Tarefa iniciada'); qc.invalidateQueries({ queryKey: ['myTasks'] }); },
    onError: () => toast.error('Erro ao iniciar tarefa'),
  });

  const filtered = tasks.filter((t) => !statusFilter || t.status === statusFilter);

  return (
    <div>
      {completeTaskId && <CompleteModal taskId={completeTaskId} onClose={() => setCompleteTaskId(null)} />}
      <Header title="Minhas Tarefas" subtitle="Tarefas atribuídas a você" />

      <div className="flex gap-3 mb-6">
        {['', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {s === '' ? 'Todas' : s === 'PENDING' ? 'Pendentes' : s === 'IN_PROGRESS' ? 'Em Andamento' : s === 'COMPLETED' ? 'Concluídas' : 'Rejeitadas'}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500 text-sm">Carregando tarefas...</div>}

      <div className="space-y-3">
        {filtered.length === 0 && !isLoading && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-sm">Nenhuma tarefa encontrada</p>
          </div>
        )}
        {filtered.map((task) => {
          const overdue = task.dueDate && isPast(new Date(task.dueDate)) && task.status !== 'COMPLETED';
          return (
            <div key={task.id} className={`bg-white rounded-xl border p-5 ${overdue ? 'border-red-200' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">{task.title}</h3>
                    <StatusBadge status={task.status} />
                    {overdue && <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full">Atrasada</span>}
                  </div>
                  <Link to={`/requests/${task.requestId}`} className="text-xs text-blue-600 hover:text-blue-800 mt-1 inline-block">
                    {task.request?.title}
                  </Link>
                  {task.description && <p className="text-xs text-gray-500 mt-1">{task.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    {task.dueDate && (
                      <span className={overdue ? 'text-red-500' : ''}>
                        Prazo: {format(new Date(task.dueDate), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                      </span>
                    )}
                    {task.notes && <span>Obs: {task.notes}</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {task.status === 'PENDING' && (
                    <button onClick={() => startMutation.mutate(task.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                      Iniciar
                    </button>
                  )}
                  {(task.status === 'PENDING' || task.status === 'IN_PROGRESS') && (
                    <>
                      <button onClick={() => setCompleteTaskId(task.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                        Concluir
                      </button>
                      <button onClick={() => { if (confirm('Deseja rejeitar esta tarefa?')) rejectMutation.mutate(task.id); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">
                        Rejeitar
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
