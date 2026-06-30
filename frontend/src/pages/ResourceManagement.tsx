import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resourcesApi, sectorsApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { ResourceItem } from '../types';

const typeLabel = (type: string) => {
  if (type === 'EQUIPMENT') return 'Equipamento';
  if (type === 'SYSTEM_ACCESS') return 'Acesso a sistema';
  return 'Outro';
};

const typeBadgeClass = (type: string) => {
  if (type === 'EQUIPMENT') return 'bg-blue-100 text-blue-700';
  if (type === 'SYSTEM_ACCESS') return 'bg-purple-100 text-purple-700';
  return 'bg-gray-100 text-gray-600';
};

export default function ResourceManagement() {
  const qc = useQueryClient();

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('EQUIPMENT');
  const [newSectorId, setNewSectorId] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newDependsOnId, setNewDependsOnId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const { data: resources = [], isLoading } = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.getAll });
  const { data: sectors = [] } = useQuery({ queryKey: ['sectors'], queryFn: sectorsApi.getAll });

  const createMutation = useMutation({
    mutationFn: () => resourcesApi.create({ name: newName.trim(), type: newType, sectorId: newSectorId || undefined, selectionGroup: newGroup.trim() || undefined, dependsOnId: newDependsOnId || undefined }),
    onSuccess: () => {
      toast.success('Tipo de ativo criado!');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setNewName('');
      setNewType('EQUIPMENT');
      setNewSectorId('');
      setNewGroup('');
      setNewDependsOnId('');
    },
    onError: () => toast.error('Erro ao criar tipo de ativo'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ResourceItem> }) => resourcesApi.update(id, data),
    onSuccess: () => {
      toast.success('Recurso atualizado!');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setEditingId(null);
    },
    onError: () => toast.error('Erro ao atualizar recurso'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => resourcesApi.delete(id),
    onSuccess: () => {
      toast.success('Recurso removido!');
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: () => toast.error('Erro ao remover recurso'),
  });

  const handleCreate = () => {
    if (!newName.trim()) { toast.error('Nome é obrigatório'); return; }
    createMutation.mutate();
  };

  const handleToggleActive = (r: ResourceItem) => {
    updateMutation.mutate({ id: r.id, data: { isActive: !r.isActive } });
  };

  const handleSaveEdit = (r: ResourceItem) => {
    if (!editingName.trim()) return;
    updateMutation.mutate({ id: r.id, data: { name: editingName.trim() } });
  };

  const resourcesBySector = resources.reduce<Record<string, ResourceItem[]>>((acc, r) => {
    const key = r.sector?.name || 'Geral';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const total = resources.length;
  const active = resources.filter((r) => r.isActive).length;
  const equipmentCount = resources.filter((r) => r.type === 'EQUIPMENT').length;
  const systemCount = resources.filter((r) => r.type === 'SYSTEM_ACCESS').length;

  return (
    <div>
      <Header title="Tipos de Ativo Solicitáveis" subtitle="Itens que aparecem na requisição de vaga — defina o setor responsável, grupos de exclusão e dependências" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{total}</div>
          <div className="text-sm text-gray-500 mt-1">Total de recursos</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{active}</div>
          <div className="text-sm text-gray-500 mt-1">Ativos</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{equipmentCount}</div>
          <div className="text-sm text-gray-500 mt-1">Equipamentos</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-purple-600">{systemCount}</div>
          <div className="text-sm text-gray-500 mt-1">Acessos a sistema</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Adicionar Tipo de Ativo</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex: Notebook"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              <option value="EQUIPMENT">Equipamento</option>
              <option value="SYSTEM_ACCESS">Acesso a sistema</option>
              <option value="OTHER">Outro</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Setor responsável (recebe a tarefa)</label>
            <select value={newSectorId} onChange={(e) => setNewSectorId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              <option value="">Geral (sem setor)</option>
              {sectors.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Grupo de exclusão</label>
            <input
              type="text"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Ex: ESTACAO (Computador x Notebook)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
            />
            <p className="text-[10px] text-gray-400 mt-1">Itens com o mesmo grupo: o solicitante escolhe só um.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Depende de</label>
            <select value={newDependsOnId} onChange={(e) => setNewDependsOnId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              <option value="">— (item independente) —</option>
              {resources.filter((r) => r.isActive).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-400 mt-1">Só aparece na vaga se o item-pai for escolhido.</p>
          </div>
          <div>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="w-full px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Salvando...' : '+ Adicionar'}
            </button>
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-gray-400 text-center py-8">Carregando...</div>}

      {!isLoading && resources.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Nenhum recurso cadastrado. Adicione o primeiro acima.
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(resourcesBySector).map(([sectorName, items]) => (
          <div key={sectorName} className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{sectorName}</span>
              <span className="text-gray-400 text-xs">{items.length} item(s)</span>
            </h3>
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className={`flex items-center gap-3 p-3 rounded-lg border ${r.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                  {editingId === r.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 px-2 py-1 border border-golplus-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-golplus-blue-500"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 text-sm text-gray-800 font-medium">{r.name}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadgeClass(r.type)}`}>
                    {typeLabel(r.type)}
                  </span>
                  {r.sector && (
                    <span className="px-2 py-0.5 bg-golplus-blue-50 text-golplus-blue-700 rounded-full text-xs">
                      {r.sector.name}
                    </span>
                  )}
                  {r.selectionGroup && (
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs" title="Grupo de exclusão (escolher só um)">
                      grupo: {r.selectionGroup}
                    </span>
                  )}
                  {r.dependsOnId && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs" title="Só aparece se o item-pai for escolhido">
                      depende de {resources.find((x) => x.id === r.dependsOnId)?.name ?? '—'}
                    </span>
                  )}
                  <button
                    onClick={() => handleToggleActive(r)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${r.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {r.isActive ? 'Ativo' : 'Inativo'}
                  </button>
                  {editingId === r.id ? (
                    <>
                      <button onClick={() => handleSaveEdit(r)} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">Salvar</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setEditingId(r.id); setEditingName(r.name); }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    onClick={() => deleteMutation.mutate(r.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Excluir
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
