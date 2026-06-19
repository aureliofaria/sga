import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { flowsApi, requestsApi, resourcesApi } from '../services/api';
import { FlowTypeBadge } from '../components/StatusBadge';
import FileUpload from '../components/FileUpload';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import type { FlowTemplate } from '../types';

const flowTypes = [
  { type: 'ONBOARDING', label: 'Admissão de Colaborador', desc: 'Processo de admissão de novo funcionário', icon: '👤', color: 'border-green-200 hover:border-green-400' },
  { type: 'OFFBOARDING', label: 'Desligamento de Colaborador', desc: 'Processo de offboarding', icon: '🚪', color: 'border-red-200 hover:border-red-400' },
  { type: 'PAYMENT', label: 'Solicitação de Pagamento', desc: 'Aprovação de pagamentos', icon: '💳', color: 'border-golplus-blue-200 hover:border-golplus-blue-400' },
  { type: 'PURCHASE', label: 'Solicitação de Compra', desc: 'Aprovação de compras e aquisições', icon: '🛒', color: 'border-purple-200 hover:border-purple-400' },
];

export default function NewRequest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // ADMIN ou requestPermissions null/undefined = todos os tipos liberados
  const allowedTypes = user && user.role !== 'ADMIN' && user.requestPermissions != null
    ? flowTypes.filter((ft) => user.requestPermissions!.includes(ft.type))
    : flowTypes;
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState('');
  const [selectedFlow, setSelectedFlow] = useState<FlowTemplate | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    targetEmployee: '',
    targetDepartment: '',
    startDate: '',
    amount: '',
    supplier: '',
    costCenter: '',
    justification: '',
  });

  const [vacancyType, setVacancyType] = useState('');
  const [replacementName, setReplacementName] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);

  const { data: flows = [] } = useQuery({ queryKey: ['flows'], queryFn: () => flowsApi.getAll() });
  const filteredFlows = flows.filter((f) => f.type === selectedType && f.isActive);
  const { data: activeResources = [] } = useQuery({ queryKey: ['resources-active'], queryFn: resourcesApi.getActive, enabled: selectedType === 'ONBOARDING' });

  const resourcesBySector = activeResources.reduce<Record<string, typeof activeResources>>((acc, r) => {
    const key = r.sector?.name || 'Geral';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const toggleResource = (id: string) => {
    setSelectedResourceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const data: any = {
        flowId: selectedFlow!.id,
        title: form.title,
        description: form.description,
      };
      if (['ONBOARDING', 'OFFBOARDING'].includes(selectedType)) {
        data.targetEmployee = form.targetEmployee;
        data.targetDepartment = form.targetDepartment;
        data.startDate = form.startDate;
      }
      if (selectedType === 'ONBOARDING') {
        data.vacancyType = vacancyType || undefined;
        data.replacementName = vacancyType === 'REPLACEMENT' ? replacementName : undefined;
        data.resourceIds = selectedResourceIds.length > 0 ? selectedResourceIds : undefined;
      }
      if (['PAYMENT', 'PURCHASE'].includes(selectedType)) {
        const reais = form.amount ? parseFloat(form.amount.replace(/[^0-9.]/g, '')) : NaN;
        data.amountCents = Number.isFinite(reais) ? Math.round(reais * 100) : undefined;
        data.supplier = form.supplier;
        data.costCenter = form.costCenter;
        data.justification = form.justification;
      }
      const req = await requestsApi.create(data);
      if (pendingFiles.length > 0) {
        await requestsApi.uploadAttachments(req.id, pendingFiles);
      }
      return req;
    },
    onSuccess: (req) => {
      toast.success('Solicitação criada com sucesso!');
      navigate(`/requests/${req.id}`);
    },
    onError: () => toast.error('Erro ao criar solicitação'),
  });

  const totalSteps = 5;
  const isHR = ['ONBOARDING', 'OFFBOARDING'].includes(selectedType);
  const isFinancial = ['PAYMENT', 'PURCHASE'].includes(selectedType);

  const canNext = () => {
    if (step === 1) return !!selectedType;
    if (step === 2) return !!selectedFlow;
    if (step === 3) {
      if (!form.title) return false;
      return true;
    }
    return true;
  };

  return (
    <div>
      <Header title="Nova Solicitação" subtitle="Crie uma nova solicitação de aprovação" />

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${n < step ? 'bg-golplus-blue-600 text-white' : n === step ? 'bg-golplus-blue-600 text-white ring-4 ring-golplus-blue-100' : 'bg-gray-200 text-gray-500'}`}>
              {n < step ? '✓' : n}
            </div>
            {n < totalSteps && <div className={`h-0.5 w-8 ${n < step ? 'bg-golplus-blue-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
        <div className="ml-4 text-sm text-gray-500">
          {['Tipo de Fluxo', 'Selecionar Modelo', 'Detalhes', 'Anexos', 'Confirmação'][step - 1]}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Step 1: Choose type */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Selecione o Tipo de Solicitação</h2>
            {allowedTypes.length === 0 && (
              <p className="text-sm text-amber-600 text-center py-8">Você não possui permissão para abrir nenhum tipo de solicitação. Contate um administrador.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {allowedTypes.map((ft) => (
                <button
                  key={ft.type}
                  onClick={() => { setSelectedType(ft.type); setSelectedFlow(null); }}
                  className={`p-5 border-2 rounded-xl text-left transition-all ${selectedType === ft.type ? 'border-golplus-blue-500 bg-golplus-blue-50' : ft.color + ' bg-white'}`}
                >
                  <div className="text-3xl mb-3">{ft.icon}</div>
                  <div className="font-semibold text-gray-900">{ft.label}</div>
                  <div className="text-sm text-gray-500 mt-1">{ft.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Choose template */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Selecione o Modelo de Fluxo</h2>
            {filteredFlows.length === 0 && <p className="text-sm text-gray-500 text-center py-8">Nenhum fluxo disponível para este tipo</p>}
            <div className="space-y-3">
              {filteredFlows.map((flow) => (
                <button
                  key={flow.id}
                  onClick={() => setSelectedFlow(flow)}
                  className={`w-full p-4 border-2 rounded-xl text-left transition-all ${selectedFlow?.id === flow.id ? 'border-golplus-blue-500 bg-golplus-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="font-medium text-gray-900">{flow.name}</div>
                  {flow.description && <div className="text-sm text-gray-500 mt-1">{flow.description}</div>}
                  <div className="flex items-center gap-3 mt-2">
                    <FlowTypeBadge type={flow.type} />
                    <span className="text-xs text-gray-400">{flow._count?.steps || flow.steps?.length || 0} etapas</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Fill details */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Detalhes da Solicitação</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
                  placeholder="Título da solicitação"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
                  placeholder="Descreva a solicitação..."
                />
              </div>
              {isHR && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Colaborador</label>
                    <input type="text" value={form.targetEmployee} onChange={(e) => setForm({ ...form, targetEmployee: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome completo" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
                    <input type="text" value={form.targetDepartment} onChange={(e) => setForm({ ...form, targetDepartment: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Departamento de destino" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Início</label>
                    <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" />
                  </div>
                </>
              )}
              {selectedType === 'ONBOARDING' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Vaga</label>
                    <select value={vacancyType} onChange={(e) => setVacancyType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500">
                      <option value="">— Selecionar —</option>
                      <option value="NEW">Nova vaga</option>
                      <option value="REPLACEMENT">Substituição</option>
                      <option value="REALLOCATION">Realocação de setor</option>
                      <option value="PROMOTION">Promoção</option>
                    </select>
                  </div>
                  {vacancyType === 'REPLACEMENT' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nome do colaborador a ser substituído</label>
                      <input type="text" value={replacementName} onChange={(e) => setReplacementName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome completo" />
                    </div>
                  )}
                  {vacancyType && activeResources.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Recursos e Sistemas Necessários</label>
                      <div className="space-y-3">
                        {Object.entries(resourcesBySector).map(([sectorName, resources]) => (
                          <div key={sectorName} className="border border-gray-200 rounded-lg p-3">
                            <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{sectorName}</div>
                            <div className="space-y-1.5">
                              {resources.map((r) => (
                                <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedResourceIds.includes(r.id)}
                                    onChange={() => toggleResource(r.id)}
                                    className="rounded border-gray-300 text-golplus-blue-600"
                                  />
                                  <span className="text-sm text-gray-700">{r.name}</span>
                                  <span className="text-xs text-gray-400">{r.type === 'EQUIPMENT' ? 'Equipamento' : r.type === 'SYSTEM_ACCESS' ? 'Acesso a sistema' : 'Outro'}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {isFinancial && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$) *</label>
                    <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="0,00" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fornecedor</label>
                    <input type="text" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome do fornecedor" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Centro de Custo</label>
                    <input type="text" value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Ex: TI-001" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Justificativa *</label>
                    <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Justifique a necessidade..." />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Attachments */}
        {step === 4 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Anexar Documentos</h2>
            <p className="text-sm text-gray-500 mb-4">Adicione documentos relevantes (opcional). Você também poderá adicionar depois.</p>
            <FileUpload
              onUpload={async (files) => { setPendingFiles((prev) => [...prev, ...files]); toast.success(`${files.length} arquivo(s) selecionado(s)`); }}
              label="Arraste documentos ou clique para selecionar"
            />
            {pendingFiles.length > 0 && (
              <p className="text-sm text-green-600 mt-3">{pendingFiles.length} arquivo(s) prontos para envio</p>
            )}
          </div>
        )}

        {/* Step 5: Confirm */}
        {step === 5 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Confirmação</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Tipo:</span><FlowTypeBadge type={selectedType} /></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Fluxo:</span><span className="font-medium">{selectedFlow?.name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Título:</span><span className="font-medium">{form.title}</span></div>
              {form.amount && <div className="flex justify-between text-sm"><span className="text-gray-500">Valor:</span><span className="font-medium text-golplus-blue-700">R$ {parseFloat(form.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>}
              {form.targetEmployee && <div className="flex justify-between text-sm"><span className="text-gray-500">Colaborador:</span><span className="font-medium">{form.targetEmployee}</span></div>}
              {pendingFiles.length > 0 && <div className="flex justify-between text-sm"><span className="text-gray-500">Anexos:</span><span className="font-medium">{pendingFiles.length} arquivo(s)</span></div>}
            </div>
            <p className="text-sm text-gray-500 mt-4">Ao confirmar, a solicitação será criada e enviada para aprovação.</p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 1}
            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Voltar
          </button>
          {step < totalSteps ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
              className="px-5 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Próximo
            </button>
          ) : (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar Solicitação'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
