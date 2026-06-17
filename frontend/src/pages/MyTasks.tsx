import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tasksApi } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { format, isPast, formatDistanceToNow, differenceInHours } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { RequestTask } from '../types';

function slaInfo(task: RequestTask) {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  const done = task.status === 'COMPLETED' || task.status === 'REJECTED';
  if (done) return null;
  const overdue = isPast(due);
  const hoursLeft = differenceInHours(due, new Date());
  const warning = !overdue && hoursLeft <= 4;
  return { overdue, warning, hoursLeft, due };
}

function SlaBadge({ task }: { task: RequestTask }) {
  const info = slaInfo(task);
  if (!info) return null;
  if (task.slaEscalated && info.overdue) {
    return (
      <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-200">
        SLA expirado — escalado
      </span>
    );
  }
  if (info.overdue) {
    return (
      <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-200">
        Atrasada {formatDistanceToNow(info.due, { locale: ptBR, addSuffix: false })}
      </span>
    );
  }
  if (info.warning) {
    return (
      <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
        Vence em {info.hoursLeft}h
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-400">
      Prazo: {format(info.due, 'dd/MM HH:mm', { locale: ptBR })}
    </span>
  );
}

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
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional)" rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
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

function BatchCompleteModal({ taskIds, onClose }: { taskIds: string[]; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => tasksApi.batchComplete(taskIds, notes || undefined),
    onSuccess: (data) => {
      toast.success(`${data.completed} tarefa(s) concluída(s)!`);
      qc.invalidateQueries({ queryKey: ['myTasks'] });
      onClose();
    },
    onError: () => toast.error('Erro ao concluir tarefas em lote'),
  });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Concluir em Lote</h3>
        <p className="text-sm text-gray-500 mb-4">{taskIds.length} tarefa(s) selecionada(s)</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional — aplicadas a todas)" rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {mutation.isPending ? 'Processando...' : `Concluir ${taskIds.length} tarefa(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyTasks() {
  const [statusFilter, setStatusFilter] = useState('');
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const filtered = useMemo(
    () => tasks.filter((t) => !statusFilter || t.status === statusFilter),
    [tasks, statusFilter],
  );

  const activeFiltered = filtered.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const allActiveSelected = activeFiltered.length > 0 && activeFiltered.every((t) => selected.has(t.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allActiveSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(activeFiltered.map((t) => t.id)));
    }
  };

  const selectedIds = [...selected];

  return (
    <div>
      {completeTaskId && <CompleteModal taskId={completeTaskId} onClose={() => setCompleteTaskId(null)} />}
      {showBatchModal && <BatchCompleteModal taskIds={selectedIds} onClose={() => { setShowBatchModal(false); setSelected(new Set()); }} />}

      <Header title="Minhas Tarefas" subtitle="Tarefas atribuídas a você" />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {['', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setSelected(new Set()); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-golplus-blue text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {s === '' ? 'Todas' : s === 'PENDING' ? 'Pendentes' : s === 'IN_PROGRESS' ? 'Em Andamento' : s === 'COMPLETED' ? 'Concluídas' : 'Rejeitadas'}
          </button>
        ))}
      </div>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-golplus-blue-50 border border-golplus-blue-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-golplus-blue-800">{selected.size} tarefa(s) selecionada(s)</span>
          <button
            onClick={() => setShowBatchModal(true)}
            className="ml-auto px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            Concluir selecionadas
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-white"
          >
            Cancelar
          </button>
        </div>
      )}

      {isLoading && <div className="text-center py-12 text-gray-500 text-sm">Carregando tarefas...</div>}

      <div className="space-y-3">
        {/* Select-all row */}
        {activeFiltered.length > 1 && (
          <div className="flex items-center gap-2 px-1 mb-1">
            <input
              type="checkbox"
              checked={allActiveSelected}
              onChange={toggleSelectAll}
              className="rounded border-gray-300 text-golplus-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-500">Selecionar todas as tarefas ativas</span>
          </div>
        )}

        {filtered.length === 0 && !isLoading && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-sm">Nenhuma tarefa encontrada</p>
          </div>
        )}

        {filtered.map((task) => {
          const info = slaInfo(task);
          const isActive = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
          const isChecked = selected.has(task.id);

          return (
            <div
              key={task.id}
              className={`bg-white rounded-xl border p-5 transition-colors ${
                info?.overdue ? 'border-red-200' : info?.warning ? 'border-amber-200' : 'border-gray-200'
              } ${isChecked ? 'ring-2 ring-golplus-blue-300' : ''}`}
            >
              <div className="flex items-start gap-3">
                {isActive && (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(task.id)}
                    className="mt-1 rounded border-gray-300 text-golplus-blue-600 cursor-pointer flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">{task.title}</h3>
                    <StatusBadge status={task.status} />
                    <SlaBadge task={task} />
                  </div>
                  <Link to={`/requests/${task.requestId}`} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 mt-1 inline-block">
                    {task.request?.title}
                  </Link>
                  {task.description && <p className="text-xs text-gray-500 mt-1">{task.description}</p>}
                  {task.notes && <p className="text-xs text-gray-400 mt-1 italic">Obs: {task.notes}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {task.status === 'PENDING' && (
                    <button onClick={() => startMutation.mutate(task.id)} className="px-3 py-1.5 bg-golplus-blue text-white rounded-lg text-xs font-medium hover:bg-golplus-blue-800">
                      Iniciar
                    </button>
                  )}
                  {isActive && (
                    <>
                      <button onClick={() => setCompleteTaskId(task.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                        Concluir
                      </button>
                      <button
                        onClick={() => { if (confirm('Deseja rejeitar esta tarefa?')) rejectMutation.mutate(task.id); }}
                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                      >
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
