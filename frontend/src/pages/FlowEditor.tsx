import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { flowsApi, sectorsApi } from '../services/api';
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
  const [scope, setScope] = useState<'INTRA' | 'INTER'>('INTRA');
  const [sectorId, setSectorId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: sectors = [] } = useQuery({ queryKey: ['sectors'], queryFn: sectorsApi.getAll });

  useEffect(() => {
    if (existingFlow) {
      setName(existingFlow.name);
      setDescription(existingFlow.description || '');
      setType(existingFlow.type);
      setScope((existingFlow.scope as 'INTRA' | 'INTER') || 'INTRA');
      setSectorId(existingFlow.sectorId || '');
      setIsActive(existingFlow.isActive);
      setSteps((existingFlow.steps || []).map((s) => ({
        ...s,
        conditions: typeof s.conditions === 'string' ? JSON.parse(s.conditions || '[]') : (s.conditions || []),
        // Alçadas vêm em centavos da API; o editor trabalha em reais.
        authLevels: (s.authLevels || []).map((lvl: any) => ({
          ...lvl,
          minValue: lvl.minValueCents != null ? lvl.minValueCents / 100 : '',
          maxValue: lvl.maxValueCents != null ? lvl.maxValueCents / 100 : '',
        })),
      })));
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
      slaExpiry: 'KEEP_WITH_RESPONSIBLE',
      handlingSectorId: '',
      order: steps.length,
      authLevels: [],
      collectsResources: false,
      activateOnSectorId: '',
      conditions: [],
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

  const addCondition = (stepIdx: number) => {
    const newSteps = [...steps];
    newSteps[stepIdx].conditions = [
      ...(newSteps[stepIdx].conditions || []),
      { field: 'always', op: 'ALWAYS', value: '', targetOrder: 0 },
    ];
    setSteps(newSteps);
  };

  const updateCondition = (stepIdx: number, condIdx: number, field: string, value: any) => {
    const newSteps = [...steps];
    newSteps[stepIdx].conditions[condIdx] = { ...newSteps[stepIdx].conditions[condIdx], [field]: value };
    setSteps(newSteps);
  };

  const removeCondition = (stepIdx: number, condIdx: number) => {
    const newSteps = [...steps];
    newSteps[stepIdx].conditions = newSteps[stepIdx].conditions.filter((_: any, i: number) => i !== condIdx);
    setSteps(newSteps);
  };

  const handleSave = async () => {
    if (!name) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      let flowId = id;
      if (isNew) {
        const flow = await flowsApi.create({ name, description, type: type as any, scope, sectorId: sectorId || undefined, isActive });
        flowId = flow.id;
      } else {
        await flowsApi.update(id!, { name, description, type: type as any, scope, sectorId: sectorId || undefined, isActive });
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
          slaExpiry: step.slaExpiry || 'KEEP_WITH_RESPONSIBLE',
          handlingSectorId: step.handlingSectorId || null,
          order: i,
          collectsResources: step.collectsResources ?? false,
          activateOnSectorId: step.activateOnSectorId || null,
          conditions: step.conditions?.length ? JSON.stringify(step.conditions) : null,
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
            // Inputs em reais → persistidos em centavos (inteiro).
            minValueCents: lvl.minValue !== '' && lvl.minValue != null ? Math.round(parseFloat(lvl.minValue) * 100) : null,
            maxValueCents: lvl.maxValue !== '' && lvl.maxValue != null ? Math.round(parseFloat(lvl.maxValue) * 100) : null,
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
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome do fluxo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              {flowTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {/* Escopo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Escopo do Fluxo</label>
            <div className="flex gap-2">
              {[{ v: 'INTRA', label: 'Intra-setor', desc: 'Etapas dentro de um único setor' }, { v: 'INTER', label: 'Inter-setor', desc: 'Etapas cruzam diferentes setores' }].map((s) => (
                <button
                  key={s.v}
                  type="button"
                  onClick={() => setScope(s.v as 'INTRA' | 'INTER')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${scope === s.v ? 'border-golplus-blue bg-golplus-blue-50 text-golplus-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs opacity-70">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
          {/* Setor (para intra) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {scope === 'INTRA' ? 'Setor responsável' : 'Setor de origem'}
            </label>
            <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
              <option value="">— Nenhum (todos os setores) —</option>
              {sectors.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Descrição do fluxo..." />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-gray-300 text-golplus-blue-600" />
            <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Fluxo ativo</label>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Etapas do Fluxo</h2>
          <button onClick={addStep} className="px-3 py-1.5 bg-golplus-blue-600 text-white rounded-lg text-xs font-medium hover:bg-golplus-blue-700">+ Adicionar Etapa</button>
        </div>

        {steps.length === 0 && <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nenhuma etapa. Clique em "Adicionar Etapa".</div>}

        {steps.map((step, idx) => (
          <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-7 h-7 bg-golplus-blue-100 text-golplus-blue-700 rounded-full flex items-center justify-center text-sm font-bold">{idx + 1}</span>
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
                <input type="text" value={step.name} onChange={(e) => updateStep(idx, 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Perfil Responsável</label>
                <select value={step.requiredRole || 'USER'} onChange={(e) => updateStep(idx, 'requiredRole', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
                  {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <input type="text" value={step.description || ''} onChange={(e) => updateStep(idx, 'description', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prazo SLA (horas)</label>
                <input type="number" value={step.deadlineHours || ''} onChange={(e) => updateStep(idx, 'deadlineHours', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Ex: 48" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ação no vencimento SLA</label>
                <select value={step.slaExpiry || 'KEEP_WITH_RESPONSIBLE'} onChange={(e) => updateStep(idx, 'slaExpiry', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
                  <option value="KEEP_WITH_RESPONSIBLE">Manter com responsável</option>
                  <option value="RETURN_TO_REQUESTER">Devolver ao solicitante</option>
                  <option value="TRANSFER_TO_LEADER">Transferir ao líder do setor</option>
                </select>
              </div>
              {scope === 'INTER' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    <span className="text-golplus-orange">⇄</span> Setor desta etapa
                  </label>
                  <select
                    value={step.handlingSectorId || ''}
                    onChange={(e) => updateStep(idx, 'handlingSectorId', e.target.value)}
                    className="w-full px-3 py-2 border border-golplus-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-orange-300"
                  >
                    <option value="">— Qualquer setor —</option>
                    {sectors.filter((s) => s.isActive).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id={`att-${idx}`} checked={step.requiresAttachment} onChange={(e) => updateStep(idx, 'requiresAttachment', e.target.checked)} className="rounded border-gray-300 text-golplus-blue-600" />
                <label htmlFor={`att-${idx}`} className="text-sm text-gray-700">Requer anexo</label>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id={`cr-${idx}`} checked={step.collectsResources || false} onChange={(e) => updateStep(idx, 'collectsResources', e.target.checked)} className="rounded border-gray-300 text-golplus-blue-600" />
                <label htmlFor={`cr-${idx}`} className="text-sm text-gray-700">Esta etapa coleta recursos/sistemas</label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ativar somente se houver recursos do setor</label>
                <select value={step.activateOnSectorId || ''} onChange={(e) => updateStep(idx, 'activateOnSectorId', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
                  <option value="">— Sempre ativar —</option>
                  {sectors.filter((s) => s.isActive).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Routing conditions */}
            <div className="border-t border-gray-100 pt-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600">Regras de roteamento após esta etapa</span>
                <button onClick={() => addCondition(idx)} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">+ Adicionar Regra</button>
              </div>
              <div className="space-y-2">
                {(step.conditions || []).map((cond: any, condIdx: number) => (
                  <div key={condIdx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 relative">
                    <button onClick={() => removeCondition(idx, condIdx)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs">×</button>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Campo</label>
                      <select value={cond.field} onChange={(e) => updateCondition(idx, condIdx, 'field', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500">
                        <option value="always">Sempre</option>
                        <option value="vacancyType">Tipo de vaga (vacancyType)</option>
                        <option value="amount">Valor (amount)</option>
                      </select>
                    </div>
                    {cond.field !== 'always' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Operador</label>
                        <select value={cond.op} onChange={(e) => updateCondition(idx, condIdx, 'op', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500">
                          <option value="EQUALS">Igual a</option>
                          <option value="GT">Maior que</option>
                          <option value="LT">Menor que</option>
                          <option value="GTE">Maior ou igual</option>
                          <option value="LTE">Menor ou igual</option>
                        </select>
                      </div>
                    )}
                    {cond.field !== 'always' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Valor</label>
                        <input type="text" value={cond.value || ''} onChange={(e) => updateCondition(idx, condIdx, 'value', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" placeholder="Ex: REPLACEMENT" />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Ir para etapa de ordem</label>
                      <input type="number" min="0" value={cond.targetOrder ?? 0} onChange={(e) => updateCondition(idx, condIdx, 'targetOrder', parseInt(e.target.value) || 0)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Auth Levels */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600">Alçadas de Autorização</span>
                <button onClick={() => addAuthLevel(idx)} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">+ Adicionar Alçada</button>
              </div>
              <div className="space-y-3">
                {(step.authLevels || []).map((lvl: any, lvlIdx: number) => (
                  <div key={lvl.id} className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2 relative">
                    <button onClick={() => removeAuthLevel(idx, lvlIdx)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs">✕</button>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nome</label>
                      <input type="text" value={lvl.name} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'name', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" placeholder="Ex: Até R$ 5.000" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Valor mín.</label>
                      <input type="number" value={lvl.minValue} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'minValue', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Valor máx.</label>
                      <input type="number" value={lvl.maxValue} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'maxValue', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" placeholder="ilimitado" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Aprovadores</label>
                      <input type="number" min="1" value={lvl.requiredApprovers} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'requiredApprovers', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Perfil aprovador</label>
                      <select value={lvl.approverRole} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'approverRole', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500">
                        {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Prazo (h)</label>
                      <input type="number" value={lvl.deadlineHours || ''} onChange={(e) => updateAuthLevel(idx, lvlIdx, 'deadlineHours', e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500" />
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
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
          {saving ? 'Salvando...' : isNew ? 'Criar Fluxo' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
}
