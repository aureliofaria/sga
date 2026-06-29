import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi, flowsApi, type PaymentRecurrence } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { PAYMENT_CATEGORIES, RECURRING_CATEGORIES, getCategory } from '../lib/paymentCategories';

const fmtBRL = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const toDateInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const emptyForm = {
  title: '',
  paymentCategory: 'RECORRENCIA',
  amount: '',
  supplier: '',
  costCenter: '',
  justification: '',
  intervalUnit: 'MONTH',
  intervalCount: '1',
  nextRunAt: '',
};

export default function PaymentRecurrences() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  // null = criando; id = editando aquela recorrência.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const isEditing = editingId !== null;

  const { data: recurrences = [], isLoading } = useQuery({
    queryKey: ['payment-recurrences'],
    queryFn: paymentsApi.listRecurrences,
  });
  const { data: flows = [] } = useQuery({ queryKey: ['flows'], queryFn: () => flowsApi.getAll() });
  const paymentFlows = flows.filter((f) => f.type === 'PAYMENT' && f.isActive);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['payment-recurrences'] });

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm({ ...emptyForm }); };

  const openCreate = () => {
    if (showForm && !isEditing) { closeForm(); return; }
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true);
  };

  const startEdit = (rec: PaymentRecurrence) => {
    setEditingId(rec.id);
    setForm({
      title: rec.title,
      paymentCategory: rec.paymentCategory,
      amount: (rec.amountCents / 100).toFixed(2),
      supplier: rec.supplier ?? '',
      costCenter: rec.costCenter ?? '',
      justification: rec.justification ?? '',
      intervalUnit: rec.intervalUnit,
      intervalCount: String(rec.intervalCount),
      nextRunAt: toDateInput(rec.nextRunAt),
    });
    setShowForm(true);
  };

  // Cria ou edita conforme editingId. A categoria não é editável (o backend não
  // a altera): só entra na criação.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const reais = parseFloat(form.amount.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(reais) || reais <= 0) throw new Error('Valor inválido');
      const cat = getCategory(form.paymentCategory);
      if (cat?.requiresSupplier && !form.supplier.trim()) throw new Error('Fornecedor é obrigatório para esta categoria');
      const amountCents = Math.round(reais * 100);
      const intervalCount = Math.max(1, parseInt(form.intervalCount, 10) || 1);
      const nextRunAt = form.nextRunAt ? new Date(form.nextRunAt).toISOString() : undefined;

      if (isEditing) {
        return paymentsApi.updateRecurrence(editingId!, {
          title: form.title,
          amountCents,
          supplier: form.supplier,
          costCenter: form.costCenter,
          justification: form.justification,
          intervalUnit: form.intervalUnit,
          intervalCount,
          ...(nextRunAt ? { nextRunAt } : {}),
        });
      }
      const flow = paymentFlows[0];
      if (!flow) throw new Error('Nenhum fluxo de pagamento ativo');
      return paymentsApi.createRecurrence({
        flowId: flow.id,
        title: form.title,
        paymentCategory: form.paymentCategory,
        amountCents,
        supplier: form.supplier || undefined,
        costCenter: form.costCenter,
        justification: form.justification,
        intervalUnit: form.intervalUnit,
        intervalCount,
        nextRunAt,
      });
    },
    onSuccess: () => { toast.success(isEditing ? 'Recorrência atualizada' : 'Recorrência criada'); closeForm(); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.message || 'Erro ao salvar recorrência'),
  });

  const toggleMutation = useMutation({
    mutationFn: (rec: PaymentRecurrence) => paymentsApi.updateRecurrence(rec.id, { isActive: !rec.isActive }),
    onSuccess: (rec) => { toast.success(rec.isActive ? 'Recorrência ativada' : 'Recorrência pausada'); invalidate(); },
    onError: () => toast.error('Erro ao atualizar'),
  });

  const runMutation = useMutation({
    mutationFn: paymentsApi.runRecurrences,
    onSuccess: (r) => { toast.success(`${r.created} solicitação(ões) gerada(s)`); invalidate(); qc.invalidateQueries({ queryKey: ['requests'] }); },
    onError: () => toast.error('Erro ao processar recorrências'),
  });

  const formValid = form.title.trim() && form.amount.trim() && form.costCenter.trim() && form.justification.trim();

  return (
    <div>
      <Header
        title="Recorrências de Pagamento"
        subtitle="Pagamentos periódicos que geram solicitações automaticamente (aluguel, assinaturas, folha...)"
        actions={
          <>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {runMutation.isPending ? 'Processando...' : 'Gerar vencidas agora'}
            </button>
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700"
            >
              {showForm && !isEditing ? 'Cancelar' : '+ Nova recorrência'}
            </button>
          </>
        }
      />

      {paymentFlows.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-4 mb-4 text-sm">
          Nenhum fluxo de pagamento ativo. Crie um fluxo do tipo PAYMENT antes de cadastrar recorrências.
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEditing ? 'Editar Recorrência' : 'Nova Recorrência'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Título *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Ex: Aluguel da sede" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria *</label>
              <select
                value={form.paymentCategory}
                onChange={(e) => setForm({ ...form, paymentCategory: e.target.value })}
                disabled={isEditing}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-500"
              >
                {PAYMENT_CATEGORIES.filter((c) => RECURRING_CATEGORIES.includes(c.code)).map((c) => (
                  <option key={c.code} value={c.code}>{c.icon} {c.label}</option>
                ))}
              </select>
              {isEditing && <p className="text-xs text-gray-400 mt-1">A categoria não pode ser alterada.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$) *</label>
              <input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0,00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fornecedor{getCategory(form.paymentCategory)?.requiresSupplier ? ' *' : ''}</label>
              <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Nome do fornecedor" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Centro de Custo *</label>
              <input value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Ex: ADM-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Periodicidade *</label>
              <div className="flex gap-2">
                <input type="number" min="1" value={form.intervalCount} onChange={(e) => setForm({ ...form, intervalCount: e.target.value })} className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <select value={form.intervalUnit} onChange={(e) => setForm({ ...form, intervalUnit: e.target.value })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="MONTH">mês(es)</option>
                  <option value="WEEK">semana(s)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{isEditing ? 'Próxima execução' : 'Primeira execução'}</label>
              <input type="date" value={form.nextRunAt} onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <p className="text-xs text-gray-400 mt-1">{isEditing ? 'Data do próximo disparo.' : 'Em branco = agora.'}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Justificativa *</label>
              <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Justifique a recorrência..." />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={closeForm} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancelar
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!formValid || saveMutation.isPending || (!isEditing && paymentFlows.length === 0)}
              className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar recorrência'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Carregando...</div>
        ) : recurrences.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Nenhuma recorrência cadastrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Título</th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-right px-4 py-3">Valor</th>
                  <th className="text-left px-4 py-3">Periodicidade</th>
                  <th className="text-left px-4 py-3">Próxima</th>
                  <th className="text-left px-4 py-3">Situação</th>
                  <th className="text-right px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recurrences.map((rec) => {
                  const cat = getCategory(rec.paymentCategory);
                  return (
                    <tr key={rec.id} className={rec.isActive ? '' : 'opacity-60'}>
                      <td className="px-4 py-3 font-medium text-gray-900">{rec.title}</td>
                      <td className="px-4 py-3">{cat ? `${cat.icon} ${cat.label}` : rec.paymentCategory}</td>
                      <td className="px-4 py-3 text-right text-golplus-blue-700 font-medium">{fmtBRL(rec.amountCents)}</td>
                      <td className="px-4 py-3">a cada {rec.intervalCount} {rec.intervalUnit === 'WEEK' ? 'semana(s)' : 'mês(es)'}</td>
                      <td className="px-4 py-3">{fmtDate(rec.nextRunAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rec.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {rec.isActive ? 'Ativa' : 'Pausada'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(rec)} className="text-golplus-blue-600 hover:underline mr-3">
                          Editar
                        </button>
                        <button onClick={() => toggleMutation.mutate(rec)} className="text-gray-600 hover:underline">
                          {rec.isActive ? 'Pausar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
