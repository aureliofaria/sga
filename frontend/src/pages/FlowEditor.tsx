import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { flowsApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { FlowStep, AuthorizationLevel } from '../types';

const roles = ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'];
const roleLabels: Record<string, string> = { ADMIN: 'Administrador', MANAGER: 'Gestor', FINANCE: 'Financeiro', HR: 'RH', USER: 'Usuário' };
const flowTypes = [
  { value: 'ONBOARDING', label: 'Admissão' },
  { value: 'OFFBOARDING', label: 'Desligamento' },
  { value: 'PAYMENT', label: 'Pagamento' },
  { value: 'PURCHASE', label: 'Compra' },
];

export default function FlowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = !id;

  const { data: existingFlow } = useQuery({
    queryKey: ['flow', id],
    queryFn: () => flowsApi.getById(id!),
    enabled: !!id,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('ONBOARDING');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingFlow) {
      setName(existingFlow.name);
      setDescription(existingFlow.description || '');
      setType(existingFlow.type);
      setIsActive(existingFlow.isActive);
      setSteps(existingFlow.steps || []);
    }
  }, [existingFlow]);

  const addStep = () => {
    setSteps([...steps, {
      _local: true,
      id: `local-${Date.now()}`,
      name: '',
      description: '',
      requiredRole: 'USER',
      requiresAttachment: false,
      deadlineHours: '',
      order: steps.length,
      authLevels: [],
    }]);
  };

  const removeStep = (idx: number) => setSteps(steps.filter((_, i) => i !== idx));

  const updateStep = (idx: number, field: string, value: any) => {
    setSteps(steps.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newSteps = [...steps];
    const swap = idx + dir;
    if (swap < 0 || swap >= newSteps.length) return;
    [newSteps[idx], newSteps[swap]] = [newSteps[swap], newSteps[idx]];
    setSteps(newSteps.map((s, i) => ({ ...s, order: i })));
  };

  const addAuthLevel = (stepIdx: number) => {
    const newSteps = [...steps];
    newSteps[stepIdx].authLevels = [
      ...(newSteps[stepIdx].authLevels || []),
      { _local: true, id: `local-${Date.now()}`, name: '', minValue: '', maxValue: '', requiredApprovers: 1, approverRole: 'MANAGER', deadlineHours: '' },
    ];
    setSteps(newSteps);
  };

  const updateAuthLevel = (stepIdx: number, lvlIdx: number, field: string, value: any) => {
    const newSteps = [...steps];
    newSteps[stepIdx].authLevels[lvlIdx] = { ...newSteps[stepIdx].authLevels[lvlIdx], [field]: value };
    setSteps(newSteps);
  };

  const removeAuthLevel = (stepIdx: number, lvlIdx: number) => {
    const newSteps = [...steps];
    newSteps[stepIdx].authLevels = newSteps[stepIdx].authLevels.filter((_: any, i: number) => i !== lvlIdx);
    setSteps(newSteps);
  };

  const handleSave = async () => {
    if (!name) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      let flowId = id;
      if (isNew) {
        const flow = await flowsApi.create({ name, description, type, isActive });
        flowId = flow.id;
      } else {
        await flowsApi.update(id!, { name, description, type, isActive });
      }

      // Handle steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepData = {
          name: step.name,
          description: step.description,
          requiredRole: step.requiredRole,
          requiresAttachment: step.requiresAttachment,
          deadlineHours: step.deadlineHours ? parseInt(step.deadlineHours) : null,
          order: i,
        };

        let stepId = step.id;
        if (step._local) {
          const created = await flowsApi.addStep(flowId!, stepData);
          stepId = created.id;
        } else {
          await flowsApi.updateStep(flowId!, step.id, stepData);
        }

        // Handle auth levels
        for (let j = 0; j < (step.authLevels || []).length; j++) {
          const lvl = step.authLevels[j];
          const lvlData = {
            name: lvl.name,
            minValue: lvl.minValue !== '' ? parseFloat(lvl.minValue) : null,
            maxValue: lvl.maxValue !== '' ? parseFloat(lvl.maxValue) : null,
            requiredApprovers: parseInt(lvl.requiredApprovers) || 1,
            approverRole: lvl.approverRole,
            deadlineHours: lvl.deadlineHours ? parseInt(lvl.deadlineHours) : null,
          };
          if (lvl._local) {
            await flowsApi.addAuthLevel(flowId!, stepId, lvlData);
          } else {
            await flowsApi.updateAuthLevel(flowId!, stepId, lvl.id, lvlData);
          }
        }
      }

      toast.success(isNew ? 'Fluxo criado com sucesso!' : 'Fluxo atualizado!');
      qc.invalidateQueries({ queryKey: ['flows'] });
      navigate('/flows');
    } catch {
      toast.error('Erro ao salvar fluxo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Header title={isNew ? 'Criar Fluxo' : 'Editar Fluxo'} subtitle="Configure as etapas e níveis de autorização" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Informações Gerais</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nome do fluxo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {flowTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Descrição do fluxo..." />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-gray-300 text-blue-600" />
            <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Fluxo ativo</label>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Etapas do Fluxo</h2>
          <button onClick={addStep} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">+ Adicionar Etapa</button>
        </div>

        {steps.length === 0 && <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhuma etapa. Clique em "Adicionar Etapa".</div>}

        {steps.map((step, idx) => (
          <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">{idx + 1}</span>
              <h3 className="font-medium text-gray-900 flex-1">{step.name || 'Nova etapa'}</h3>
              <div className="flex gap-1">
                <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">↑</button>
                <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">↓</button>
                <button onClick={() => removeStep(idx)} className="p-1 text-red-400 hover:text-red-600">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome da Etapa *</label>
                <input type="text" value={step.name} onChange={(e) => updateStep(idx, 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil Responsável</label>
                <select value={step.requiredRole || 'USER'} onChange={(e) => updateStep(idx, 'requiredRole', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <input type="text" value={step.description || ''} onChange={(e) => updateStep(idx, 'description', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prazo (horas)</label>
                <input type="number" value={step.deadlineHours || ''} onChange={(e) => updateStep(idx, 'deadlineHours', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ex: 48" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id={`att-${idx}`} checked={step.requiresAttachment} onChange={(e) => updateStep(idx, 'requiresAttachment', e.target.checked)} className="rounded border-gray-300 text-blue-600" />
                <label htmlFor={`att-${idx}`} className="text-sm text-gray-700">Requer anexo</label>
              </div>
            </div>

            {/* Auth Levels */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600">Alçadas de Autorização</span>
                <button onClick={() => addAuthLevel(idx)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Adicionar Alçada</button>
              </div>
              <div className="space-y-3">
                {(step.authLevels || []).map((lvl: any, lvlIdx: number) => (
                  <div key={lvl.id} className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2 relative">
                    <button onClick={() => removeAuthLevel(idx, lvlIdx)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs">✕</button>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nome</label>
                      <input type="text" value={lvl.name} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'name', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Ex: Até R$ 5.000" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Valor mín.</label>
                      <input type="number" value={lvl.minValue} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'minValue', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Valor máx.</label>
                      <input type="number" value={lvl.maxValue} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'maxValue', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="ilimitado" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Aprovadores</label>
                      <input type="number" min="1" value={lvl.requiredApprovers} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'requiredApprovers', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Perfil aprovador</label>
                      <select value={lvl.approverRole} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'approverRole', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                        {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Prazo (h)</label>
                      <input type="number" value={lvl.deadlineHours || ''} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'deadlineHours', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={() => navigate('/flows')} className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancelar</button>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Salvando...' : isNew ? 'Criar Fluxo' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
}
