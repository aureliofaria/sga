import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { flowsApi, requestsApi, resourcesApi } from '../services/api';
import { FlowTypeBadge } from '../components/StatusBadge';
import DynamicField from '../components/DynamicField';
import FileUpload from '../components/FileUpload';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import type { FlowTemplate } from '../types';
import { PAYMENT_CATEGORIES, getCategory } from '../lib/paymentCategories';

// Tipos de vaga da trilha de admissão. O branch do fluxo compara contra o valor
// de 1ª classe `vacancyType` (servidor): só 'NOVA' segue o caminho de definição
// de compra/estoque; os demais seguem o fluxo padrão.
const VACANCY_TYPES = [
  { value: 'NOVA', label: 'Nova vaga', desc: 'Aumento de quadro (headcount novo)' },
  { value: 'SUBSTITUICAO', label: 'Substituição', desc: 'Reposição de colaborador que saiu' },
  { value: 'REALOCACAO', label: 'Realocação de setor', desc: 'Movimentação interna' },
  { value: 'PROMOCAO', label: 'Promoção', desc: 'Mudança de função/nível' },
];

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
  const [paymentCategory, setPaymentCategory] = useState('');
  // Valores dos campos dinâmicos da etapa 0 (trilha de admissão), por fieldId.
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>({});

  const { data: flows = [] } = useQuery({ queryKey: ['flows'], queryFn: () => flowsApi.getAll() });
  const filteredFlows = flows.filter((f) => f.type === selectedType && f.isActive);
  const { data: activeResources = [] } = useQuery({ queryKey: ['resources-active'], queryFn: resourcesApi.getActive, enabled: selectedType === 'ONBOARDING' });

  // Carrega o fluxo COMPLETO (com etapas/campos dinâmicos) ao selecionar um modelo.
  const { data: fullFlow } = useQuery({
    queryKey: ['flow-full', selectedFlow?.id],
    queryFn: () => flowsApi.getById(selectedFlow!.id),
    enabled: !!selectedFlow?.id,
  });
  // Campos dinâmicos da etapa de abertura (order 0) — a trilha de admissão os define.
  const step0 = fullFlow?.steps?.find((s) => s.order === 0);
  const dynamicFields = (step0?.formFields ?? []).slice().sort((a, b) => a.order - b.order);
  const hasDynamicFields = dynamicFields.length > 0;
  // Os campos legados "Precisa de…" (needs_*) deixam de aparecer na vaga: a seleção
  // passa a ser feita pelos TIPOS DE ATIVO. Seus valores são derivados da seleção
  // no envio (mapa abaixo) para manter os checklists das etapas de TI/Admin.
  const visibleDynamicFields = dynamicFields.filter((f) => !f.key?.startsWith('needs_'));
  const NEEDS_FROM_ASSET: Record<string, string> = { Notebook: 'needs_notebook', Computador: 'needs_desktop', 'Acesso ao ERP': 'needs_erp' };

  // Tipos de ativo ordenados; os dependentes (ex.: "Suporte para notebook") só
  // aparecem quando o item-pai (ex.: "Notebook") está selecionado.
  const assetTypes = activeResources.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const visibleAssetTypes = assetTypes.filter((r) => !r.dependsOnId || selectedResourceIds.includes(r.dependsOnId));

  // Seleção com regras de catálogo: grupo de exclusão (escolher só um) e
  // dependência (ao desmarcar o pai, remove os dependentes).
  const toggleResource = (item: typeof activeResources[number]) => {
    setSelectedResourceIds((prev) => {
      const dependentsOf = (id: string) => activeResources.filter((r) => r.dependsOnId === id).map((r) => r.id);
      if (prev.includes(item.id)) {
        const drop = new Set([item.id, ...dependentsOf(item.id)]);
        return prev.filter((x) => !drop.has(x));
      }
      let next = [...prev];
      if (item.selectionGroup) {
        // Remove os outros itens do mesmo grupo de exclusão (e seus dependentes).
        const mates = activeResources.filter((r) => r.selectionGroup === item.selectionGroup && r.id !== item.id).map((r) => r.id);
        const mateDeps = activeResources.filter((r) => r.dependsOnId && mates.includes(r.dependsOnId)).map((r) => r.id);
        const drop = new Set([...mates, ...mateDeps]);
        next = next.filter((x) => !drop.has(x));
      }
      next.push(item.id);
      return next;
    });
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
        data.replacementName = vacancyType === 'SUBSTITUICAO' ? replacementName : undefined;
        data.resourceIds = selectedResourceIds.length > 0 ? selectedResourceIds : undefined;
      }
      if (['PAYMENT', 'PURCHASE'].includes(selectedType)) {
        const reais = form.amount ? parseFloat(form.amount.replace(/[^0-9.]/g, '')) : NaN;
        data.amountCents = Number.isFinite(reais) ? Math.round(reais * 100) : undefined;
        data.supplier = form.supplier;
        data.costCenter = form.costCenter;
        data.justification = form.justification;
        // Categoria só se aplica a PAGAMENTO (o backend a exige nesse fluxo).
        if (selectedType === 'PAYMENT') data.paymentCategory = paymentCategory || undefined;
      }
      const req = await requestsApi.create(data);
      // Grava os valores dos campos dinâmicos da etapa de abertura (order 0).
      if (hasDynamicFields) {
        // Deriva os campos needs_* a partir dos TIPOS DE ATIVO selecionados, para
        // que os checklists das etapas de TI/Administrativo continuem aplicáveis.
        const selectedNames = activeResources.filter((r) => selectedResourceIds.includes(r.id)).map((r) => r.name);
        const derivedKeys = new Set(selectedNames.map((n) => NEEDS_FROM_ASSET[n]).filter(Boolean));
        const values = dynamicFields
          .map((f) => {
            if (f.key?.startsWith('needs_')) {
              return { fieldId: f.id, value: derivedKeys.has(f.key) ? 'sim' : 'nao' };
            }
            return { fieldId: f.id, value: (dynamicValues[f.id] ?? '').trim() };
          })
          .filter((v) => v.value !== '');
        if (values.length > 0) {
          await requestsApi.saveFields(req.id, 0, values);
        }
      }
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
  const isPayment = selectedType === 'PAYMENT';
  const categoryDef = getCategory(paymentCategory);

  const canNext = () => {
    if (step === 1) return !!selectedType;
    if (step === 2) return !!selectedFlow;
    if (step === 3) {
      if (!form.title.trim()) return false;
      if (isPayment) {
        // Espelha as validações do backend (lib/payments.ts): categoria, valor>0,
        // centro de custo, justificativa e fornecedor quando a categoria exige.
        if (!paymentCategory) return false;
        const reais = form.amount ? parseFloat(form.amount.replace(/[^0-9.]/g, '')) : NaN;
        if (!Number.isFinite(reais) || reais <= 0) return false;
        if (!form.costCenter.trim()) return false;
        if (!form.justification.trim()) return false;
        if (categoryDef?.requiresSupplier && !form.supplier.trim()) return false;
      }
      // Bloqueia avanço se algum campo dinâmico obrigatório (visível) estiver vazio.
      for (const f of visibleDynamicFields) {
        if (f.required && !(dynamicValues[f.id] ?? '').trim()) return false;
      }
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Vaga</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {VACANCY_TYPES.map((vt) => (
                        <button
                          key={vt.value}
                          type="button"
                          onClick={() => setVacancyType(vt.value)}
                          className={`p-3 border-2 rounded-xl text-left transition-all ${vacancyType === vt.value ? 'border-golplus-blue-500 bg-golplus-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                        >
                          <div className="font-medium text-sm text-gray-900">{vt.label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{vt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {vacancyType === 'SUBSTITUICAO' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nome do colaborador a ser substituído</label>
                      <input type="text" value={replacementName} onChange={(e) => setReplacementName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome completo" />
                    </div>
                  )}
                  {/* Campos dinâmicos da etapa de abertura (trilha de admissão). */}
                  {hasDynamicFields && (
                    <div className="border-t border-gray-100 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">Dados da Abertura de Vaga</h3>
                      <div className="space-y-4">
                        {visibleDynamicFields.map((f) => (
                          <DynamicField
                            key={f.id}
                            field={f}
                            value={dynamicValues[f.id] ?? ''}
                            onChange={(v) => setDynamicValues((prev) => ({ ...prev, [f.id]: v }))}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {vacancyType && assetTypes.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Equipamentos solicitados</label>
                      <p className="text-xs text-gray-500 mb-2">Selecione os itens que a vaga precisa. Cada item é encaminhado ao setor responsável.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {visibleAssetTypes.map((r) => {
                          const selected = selectedResourceIds.includes(r.id);
                          const isGrouped = !!r.selectionGroup;
                          const isDependent = !!r.dependsOnId;
                          return (
                            <button
                              type="button"
                              key={r.id}
                              onClick={() => toggleResource(r)}
                              className={`flex items-center gap-2 p-3 border-2 rounded-lg text-left transition-all ${selected ? 'border-golplus-blue-500 bg-golplus-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'} ${isDependent ? 'sm:col-span-2 ml-4' : ''}`}
                            >
                              <span className={`flex-shrink-0 w-4 h-4 border-2 flex items-center justify-center ${isGrouped ? 'rounded-full' : 'rounded'} ${selected ? 'border-golplus-blue-600 bg-golplus-blue-600' : 'border-gray-300'}`}>
                                {selected && <span className="text-white text-[10px] leading-none">✓</span>}
                              </span>
                              <span className="text-sm text-gray-800">{r.name}</span>
                              {isDependent && <span className="text-[10px] text-gray-400">(acessório)</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
              {isPayment && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Categoria do Pagamento *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PAYMENT_CATEGORIES.map((c) => (
                      <button
                        type="button"
                        key={c.code}
                        onClick={() => setPaymentCategory(c.code)}
                        className={`p-3 border-2 rounded-lg text-left transition-all ${paymentCategory === c.code ? 'border-golplus-blue-500 bg-golplus-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="text-xl">{c.icon}</div>
                        <div className="text-sm font-medium text-gray-900">{c.label}</div>
                        <div className="text-xs text-gray-500">{c.desc}</div>
                      </button>
                    ))}
                  </div>
                  {categoryDef && (
                    <p className="text-xs text-amber-600 mt-2">{categoryDef.attachmentHint} (anexe na próxima etapa)</p>
                  )}
                </div>
              )}
              {isFinancial && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$) *</label>
                    <input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="0,00" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fornecedor{isPayment && categoryDef?.requiresSupplier ? ' *' : ''}</label>
                    <input type="text" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500" placeholder="Nome do fornecedor" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Centro de Custo{isPayment ? ' *' : ''}</label>
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
              {isPayment && categoryDef && <div className="flex justify-between text-sm"><span className="text-gray-500">Categoria:</span><span className="font-medium">{categoryDef.icon} {categoryDef.label}</span></div>}
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
