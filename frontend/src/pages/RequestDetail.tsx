import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { requestsApi, inventoryApi } from '../services/api';
import { StatusBadge, FlowTypeBadge, roleLabel } from '../components/StatusBadge';
import FileUpload from '../components/FileUpload';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const formatCurrency = (cents?: number) =>
  cents != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) : '-';

const resourceTypeLabel = (type?: string) =>
  ({ EQUIPMENT: 'Equipamento', SYSTEM_ACCESS: 'Acesso a sistema', OTHER: 'Outro' } as Record<string, string>)[type ?? ''] ?? type ?? '-';

// Linha de recurso da solicitação, com vínculo opcional a uma unidade física do
// inventário (cumprimento físico — Fase 2). Só oferece o vínculo para itens
// físicos (EQUIPMENT) em fluxos de admissão/desligamento ainda pendentes.
function ResourceRow({ requestId, requestType, resource }: { requestId: string; requestType?: string; resource: any }) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const isPhysical = resource.resourceItem?.type === 'EQUIPMENT';
  const allocates = requestType === 'ONBOARDING' || requestType === 'PURCHASE';
  const linkable = isPhysical && resource.status === 'PENDING' && (allocates || requestType === 'OFFBOARDING');

  const { data: assets = [] } = useQuery({
    queryKey: ['link-assets', requestId, resource.id],
    queryFn: () => inventoryApi.getAssets({ status: allocates ? 'DISPONIVEL' : 'ATIVO' }),
    enabled: picking,
  });

  const link = useMutation({
    mutationFn: (assetId: string | null) => requestsApi.linkAsset(requestId, resource.id, assetId),
    onSuccess: () => { toast.success('Inventário atualizado!'); qc.invalidateQueries({ queryKey: ['request', requestId] }); setPicking(false); },
    onError: () => toast.error('Não foi possível vincular o ativo'),
  });

  return (
    <div className="p-3 border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-900">{resource.resourceItem?.name}{resource.quantity > 1 ? ` (×${resource.quantity})` : ''}</p>
          <p className="text-xs text-gray-500">
            {resourceTypeLabel(resource.resourceItem?.type)}
            {resource.resourceItem?.sector ? ` · ${resource.resourceItem.sector.name}` : ''}
            {resource.asset ? ` · 🏷️ ${resource.asset.tag || resource.asset.item?.name || 'unidade vinculada'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={resource.status} />
          {linkable && !resource.assetId && (
            <button onClick={() => setPicking((v) => !v)} className="text-xs text-golplus-blue-600 hover:text-golplus-blue-800 font-medium">
              {picking ? 'Fechar' : 'Vincular ativo'}
            </button>
          )}
          {resource.assetId && resource.status === 'PENDING' && (
            <button onClick={() => link.mutate(null)} className="text-xs text-gray-400 hover:text-red-600">Desvincular</button>
          )}
        </div>
      </div>
      {picking && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <select
            onChange={(e) => e.target.value && link.mutate(e.target.value)}
            defaultValue=""
            className="flex-1 min-w-[200px] px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-golplus-blue-500"
          >
            <option value="" disabled>{assets.length ? 'Selecione uma unidade…' : 'Nenhuma unidade disponível'}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.tag || a.serialNumber || a.id.slice(0, 8)} — {a.item?.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// Comentários por etapa — colaboração entre os envolvidos na solicitação.
function CommentsTab({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['comments', requestId],
    queryFn: () => requestsApi.getComments(requestId),
  });
  const add = useMutation({
    mutationFn: () => requestsApi.addComment(requestId, text.trim()),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['comments', requestId] }); qc.invalidateQueries({ queryKey: ['request', requestId] }); },
    onError: () => toast.error('Erro ao comentar'),
  });

  return (
    <div>
      <div className="space-y-3 mb-4">
        {isLoading && <p className="text-sm text-gray-400 text-center py-4">Carregando…</p>}
        {!isLoading && comments.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nenhum comentário ainda.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-golplus-blue-100 text-golplus-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {c.author?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm"><span className="font-medium text-gray-900">{c.author?.name}</span> <span className="text-xs text-gray-400">{format(new Date(c.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span></p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add.mutate(); }}
          placeholder="Escreva um comentário…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        />
        <button onClick={() => text.trim() && add.mutate()} disabled={add.isPending || !text.trim()} className="px-4 py-2 bg-golplus-blue-600 text-white rounded-lg text-sm font-medium hover:bg-golplus-blue-700 disabled:opacity-50">
          {add.isPending ? '...' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

function ActionModal({ title, onConfirm, onClose, action }: { title: string; onConfirm: (comments: string) => void; onClose: () => void; action: 'approve' | 'reject' }) {
  const [comments, setComments] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Comentários (opcional)"
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-500"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button
            onClick={() => onConfirm(comments)}
            className={`flex-1 py-2 rounded-lg text-sm text-white font-medium ${action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {action === 'approve' ? 'Confirmar Aprovação' : 'Confirmar Rejeição'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'details' | 'tasks' | 'approvals' | 'attachments' | 'comments' | 'audit'>('details');
  const [modal, setModal] = useState<'approve' | 'reject' | null>(null);

  const { data: request, isLoading } = useQuery({
    queryKey: ['request', id],
    queryFn: () => requestsApi.getById(id!),
  });

  const qc = queryClient;
  const approveMutation = useMutation({
    mutationFn: (comments: string) => requestsApi.approve(id!, comments),
    onSuccess: () => { toast.success('Solicitação aprovada!'); qc.invalidateQueries({ queryKey: ['request', id] }); setModal(null); },
    onError: () => toast.error('Erro ao aprovar solicitação'),
  });
  const rejectMutation = useMutation({
    mutationFn: (comments: string) => requestsApi.reject(id!, comments),
    onSuccess: () => { toast.success('Solicitação rejeitada'); qc.invalidateQueries({ queryKey: ['request', id] }); setModal(null); },
    onError: () => toast.error('Erro ao rejeitar solicitação'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => requestsApi.cancel(id!),
    onSuccess: () => { toast.success('Solicitação cancelada'); navigate('/requests'); },
    onError: () => toast.error('Erro ao cancelar'),
  });

  const handleUpload = async (files: File[]) => {
    try {
      await requestsApi.uploadAttachments(id!, files);
      toast.success('Arquivos enviados com sucesso!');
      qc.invalidateQueries({ queryKey: ['request', id] });
    } catch {
      toast.error('Erro ao enviar arquivos');
    }
  };

  if (isLoading) return <div className="text-center py-12 text-gray-500">Carregando...</div>;
  if (!request) return <div className="text-center py-12 text-gray-500">Solicitação não encontrada</div>;

  const canApprove = ['ADMIN', 'MANAGER', 'FINANCE'].includes(user?.role || '');
  const canCancel = user?.id === request.initiatorId || user?.role === 'ADMIN';
  const isActive = !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(request.status);

  const tabs = [
    { id: 'details', label: 'Detalhes' },
    { id: 'tasks', label: `Tarefas (${request.tasks?.length || 0})` },
    { id: 'approvals', label: `Aprovações (${request.approvals?.length || 0})` },
    { id: 'attachments', label: `Anexos (${request.attachments?.length || 0})` },
    { id: 'comments', label: 'Comentários' },
    { id: 'audit', label: 'Histórico' },
  ] as const;

  return (
    <div>
      {modal && (
        <ActionModal
          title={modal === 'approve' ? 'Aprovar Solicitação' : 'Rejeitar Solicitação'}
          action={modal}
          onClose={() => setModal(null)}
          onConfirm={(comments) => modal === 'approve' ? approveMutation.mutate(comments) : rejectMutation.mutate(comments)}
        />
      )}

      <div className="mb-6">
        <Link to="/requests" className="text-sm text-golplus-blue-600 hover:text-golplus-blue-800 flex items-center gap-1 mb-4">
          ← Voltar para Solicitações
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{request.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StatusBadge status={request.status} size="md" />
              <FlowTypeBadge type={request.flow?.type} />
              <span className="text-sm text-gray-500">por {request.initiator?.name}</span>
              <span className="text-sm text-gray-400">{format(new Date(request.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {canApprove && isActive && (
              <>
                <button onClick={() => setModal('approve')} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Aprovar</button>
                <button onClick={() => setModal('reject')} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Rejeitar</button>
              </>
            )}
            {canCancel && isActive && (
              <button onClick={() => { if (confirm('Deseja cancelar esta solicitação?')) cancelMutation.mutate(); }} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancelar</button>
            )}
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Progresso do Fluxo</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {request.flow?.steps?.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-2 flex-shrink-0">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                idx < request.currentStep ? 'bg-green-100 text-green-800' :
                idx === request.currentStep ? 'bg-golplus-blue-100 text-golplus-blue-800 font-medium' :
                'bg-gray-100 text-gray-500'
              }`}>
                <span>{idx < request.currentStep ? '✓' : idx === request.currentStep ? '→' : `${idx + 1}`}</span>
                <span>{step.name}</span>
              </div>
              {idx < (request.flow?.steps?.length || 0) - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-golplus-blue-600 text-golplus-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'details' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Informações Gerais</h3>
                <dl className="space-y-2">
                  <div className="flex"><dt className="text-sm text-gray-500 w-32 flex-shrink-0">Fluxo:</dt><dd className="text-sm text-gray-900">{request.flow?.name}</dd></div>
                  <div className="flex"><dt className="text-sm text-gray-500 w-32 flex-shrink-0">Solicitante:</dt><dd className="text-sm text-gray-900">{request.initiator?.name}</dd></div>
                  <div className="flex"><dt className="text-sm text-gray-500 w-32 flex-shrink-0">Etapa atual:</dt><dd className="text-sm text-gray-900">{request.currentStep + 1} de {request.flow?.steps?.length}</dd></div>
                  {request.description && <div className="flex"><dt className="text-sm text-gray-500 w-32 flex-shrink-0">Descrição:</dt><dd className="text-sm text-gray-900">{request.description}</dd></div>}
                </dl>
              </div>
              {(request.targetEmployee || request.amountCents != null) && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    {request.targetEmployee ? 'Dados do Colaborador' : 'Dados Financeiros'}
                  </h3>
                  <dl className="space-y-2">
                    {request.targetEmployee && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Colaborador:</dt><dd className="text-sm text-gray-900">{request.targetEmployee}</dd></div>}
                    {request.targetDepartment && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Departamento:</dt><dd className="text-sm text-gray-900">{request.targetDepartment}</dd></div>}
                    {request.startDate && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Data início:</dt><dd className="text-sm text-gray-900">{request.startDate}</dd></div>}
                    {request.amountCents != null && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Valor:</dt><dd className="text-sm font-semibold text-gray-900">{formatCurrency(request.amountCents)}</dd></div>}
                    {request.supplier && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Fornecedor:</dt><dd className="text-sm text-gray-900">{request.supplier}</dd></div>}
                    {request.costCenter && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Centro de custo:</dt><dd className="text-sm text-gray-900">{request.costCenter}</dd></div>}
                    {request.justification && <div className="flex"><dt className="text-sm text-gray-500 w-36 flex-shrink-0">Justificativa:</dt><dd className="text-sm text-gray-900">{request.justification}</dd></div>}
                  </dl>
                </div>
              )}
              {request.resources && request.resources.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Recursos / Inventário</h3>
                  <div className="space-y-2">
                    {request.resources.map((r) => (
                      <ResourceRow key={r.id} requestId={request.id} requestType={request.flow?.type} resource={r} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {request.tasks?.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nenhuma tarefa</p>}
              {request.tasks?.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{task.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Responsável: {task.assignee?.name} · Etapa: {task.step?.name}</p>
                    {task.notes && <p className="text-xs text-gray-400 mt-1">{task.notes}</p>}
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'approvals' && (
            <div className="space-y-3">
              {request.approvals?.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nenhuma aprovação registrada</p>}
              {request.approvals?.map((approval) => (
                <div key={approval.id} className={`p-4 rounded-lg border ${approval.decision === 'APPROVED' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{approval.approver?.name} <span className="text-gray-500">({roleLabel(approval.approver?.role)})</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">{format(new Date(approval.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                      {approval.comments && <p className="text-sm text-gray-700 mt-1">"{approval.comments}"</p>}
                    </div>
                    <span className={`text-sm font-semibold ${approval.decision === 'APPROVED' ? 'text-green-700' : 'text-red-700'}`}>
                      {approval.decision === 'APPROVED' ? '✓ Aprovado' : '✗ Rejeitado'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="space-y-4">
              <FileUpload onUpload={handleUpload} />
              {request.attachments?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Arquivos Anexados</h4>
                  <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                    {request.attachments.map((att) => (
                      <li key={att.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{att.originalName}</p>
                            <p className="text-xs text-gray-500">{(att.fileSize / 1024).toFixed(1)} KB · {format(new Date(att.createdAt), 'dd/MM/yyyy')}</p>
                          </div>
                        </div>
                        <a href={`/uploads/${att.fileName}`} target="_blank" rel="noopener noreferrer" className="text-golplus-blue-600 hover:text-golplus-blue-800 text-sm">Baixar</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'comments' && <CommentsTab requestId={request.id} />}

          {activeTab === 'audit' && (
            <div className="space-y-3">
              {request.auditLogs?.map((log) => (
                <div key={log.id} className="flex gap-4">
                  <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-golplus-blue-400"></div>
                  <div>
                    <p className="text-sm text-gray-900"><span className="font-medium">{log.userName}</span> · {log.action}</p>
                    {log.details && <p className="text-xs text-gray-500 mt-0.5">{log.details}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(log.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
