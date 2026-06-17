import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { flowsApi } from '../services/api';
import { FlowTypeBadge } from '../components/StatusBadge';
import Header from '../components/Header';
import toast from 'react-hot-toast';

export default function FlowTemplates() {
  const qc = useQueryClient();
  const { data: flows = [], isLoading } = useQuery({ queryKey: ['flows'], queryFn: () => flowsApi.getAll() });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => flowsApi.update(id, { isActive }),
    onSuccess: () => { toast.success('Fluxo atualizado'); qc.invalidateQueries({ queryKey: ['flows'] }); },
    onError: () => toast.error('Erro ao atualizar fluxo'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => flowsApi.delete(id),
    onSuccess: () => { toast.success('Fluxo removido'); qc.invalidateQueries({ queryKey: ['flows'] }); },
    onError: () => toast.error('Erro ao remover fluxo'),
  });

  return (
    <div>
      <Header
        title="Modelos de Fluxo"
        subtitle="Configure os fluxos de aprovação do sistema"
        actions={
          <Link to="/flows/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            + Criar Fluxo
          </Link>
        }
      />

      {isLoading && <div className="text-center py-12 text-gray-500 text-sm">Carregando...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {flows.map((flow) => (
          <div key={flow.id} className={`bg-white rounded-xl border p-5 ${flow.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <div className="flex items-start justify-between mb-3">
              <FlowTypeBadge type={flow.type} />
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={flow.isActive}
                  onChange={(e) => toggleMutation.mutate({ id: flow.id, isActive: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{flow.name}</h3>
            {flow.description && <p className="text-sm text-gray-500 mb-3">{flow.description}</p>}
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-gray-400">{flow._count?.steps || 0} etapas</span>
              <div className="flex gap-2">
                <Link to={`/flows/${flow.id}/edit`} className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50">
                  Editar
                </Link>
                <button
                  onClick={() => { if (confirm('Remover este fluxo?')) deleteMutation.mutate(flow.id); }}
                  className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50"
                >
                  Remover
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!isLoading && flows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">Nenhum fluxo cadastrado</p>
          <Link to="/flows/new" className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            Criar Primeiro Fluxo
          </Link>
        </div>
      )}
    </div>
  );
}
