import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateRequest, useFlowTemplates } from '../api/hooks';
import { parseReaisToCents } from '../lib/format';

export default function NewRequest() {
  const navigate = useNavigate();
  const { data: flows, isLoading: flowsLoading } = useFlowTemplates();
  const createRequest = useCreateRequest();

  const [flowId, setFlowId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!flowId || !title.trim()) {
      setError('Selecione um fluxo e informe um título.');
      return;
    }
    try {
      const created = await createRequest.mutateAsync({
        flowId,
        title: title.trim(),
        description: description.trim() || undefined,
        amountCents: amount ? parseReaisToCents(amount) : undefined,
        supplier: supplier.trim() || undefined,
        costCenter: costCenter.trim() || undefined,
        justification: justification.trim() || undefined,
      });
      navigate(`/requests/${created.id}`);
    } catch {
      setError('Não foi possível criar a solicitação.');
    }
  }

  const inputCls =
    'w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand';

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-800">
        Nova Solicitação
      </h1>

      {error && (
        <div className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Fluxo</span>
          <select
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            disabled={flowsLoading}
            className={inputCls}
            required
          >
            <option value="">Selecione um fluxo...</option>
            {flows?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.type ? ` (${f.type})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Título</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Descrição
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputCls}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Valor (R$)
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
            className={inputCls}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Fornecedor
            </span>
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Centro de Custo
            </span>
            <input
              value={costCenter}
              onChange={(e) => setCostCenter(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Justificativa
          </span>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={createRequest.isPending}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {createRequest.isPending ? 'Enviando...' : 'Criar Solicitação'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/requests')}
            className="rounded px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
