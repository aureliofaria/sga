import axios from 'axios';
import type { User, Department, Sector, SectorMember, FlowTemplate, Request, RequestTask, Attachment, AuditLog, ResourceItem, InventoryItem, Asset, AssetMovement, Warehouse, DashboardReport, Comment, Notification, NotificationPreference } from '../types';

const api = axios.create({
  // Mesma origem por padrão (`/api`) — funciona em produção atrás de proxy ou
  // servido pelo próprio backend, e em dev via proxy do Vite. Pode-se
  // sobrescrever com VITE_API_URL (ex.: backend em host/porta separados).
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('aprova_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('aprova_token');
      localStorage.removeItem('aprova_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User }>('/auth/login', { email, password }).then((r) => r.data),
  register: (data: { name: string; email: string; password: string; role?: string; departmentId?: string }) =>
    api.post<{ token: string; user: User }>('/auth/register', data).then((r) => r.data),
  me: () => api.get<User>('/auth/me').then((r) => r.data),
};

// Users
export const usersApi = {
  getAll: () => api.get<User[]>('/users').then((r) => r.data),
  getById: (id: string) => api.get<User>(`/users/${id}`).then((r) => r.data),
  create: (data: Partial<User> & { password: string }) =>
    api.post<User>('/users', data).then((r) => r.data),
  update: (id: string, data: Partial<User> & { password?: string }) =>
    api.put<User>(`/users/${id}`, data).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

// Departments
export const departmentsApi = {
  getAll: () => api.get<Department[]>('/departments').then((r) => r.data),
  getById: (id: string) => api.get<Department>(`/departments/${id}`).then((r) => r.data),
  create: (name: string) => api.post<Department>('/departments', { name }).then((r) => r.data),
  update: (id: string, name: string) => api.put<Department>(`/departments/${id}`, { name }).then((r) => r.data),
  delete: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
};

// Sectors
export const sectorsApi = {
  getAll: () => api.get<Sector[]>('/sectors').then((r) => r.data),
  getById: (id: string) => api.get<Sector>(`/sectors/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string }) =>
    api.post<Sector>('/sectors', data).then((r) => r.data),
  update: (id: string, data: { name?: string; description?: string; isActive?: boolean }) =>
    api.put<Sector>(`/sectors/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/sectors/${id}`).then((r) => r.data),
  // Adiciona OU atualiza (upsert por userId) um membro com nível e reporta-a.
  // level: LIDER_1 (Líder I, 1 por setor) | LIDER_2 (Líder II) | MEMBRO.
  addMember: (sectorId: string, payload: { userId: string; level: 'LIDER_1' | 'LIDER_2' | 'MEMBRO'; reportsToId?: string | null }) =>
    api.post<SectorMember>(`/sectors/${sectorId}/members`, payload).then((r) => r.data),
  removeMember: (sectorId: string, memberId: string) =>
    api.delete(`/sectors/${sectorId}/members/${memberId}`).then((r) => r.data),
  updateMember: (sectorId: string, memberId: string, data: { level?: 'LIDER_1' | 'LIDER_2' | 'MEMBRO'; reportsToId?: string | null }) =>
    api.put<SectorMember>(`/sectors/${sectorId}/members/${memberId}`, data).then((r) => r.data),
  availableUsers: (sectorId: string) =>
    api.get<User[]>(`/sectors/${sectorId}/available-users`).then((r) => r.data),
};

// Flows
export const flowsApi = {
  getAll: () => api.get<FlowTemplate[]>('/flows').then((r) => r.data),
  getById: (id: string) => api.get<FlowTemplate>(`/flows/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; type: string; scope?: string; sectorId?: string; isActive?: boolean }) =>
    api.post<FlowTemplate>('/flows', data).then((r) => r.data),
  update: (id: string, data: Partial<FlowTemplate>) =>
    api.put<FlowTemplate>(`/flows/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/flows/${id}`).then((r) => r.data),
  addStep: (flowId: string, data: any) =>
    api.post(`/flows/${flowId}/steps`, data).then((r) => r.data),
  updateStep: (flowId: string, stepId: string, data: any) =>
    api.put(`/flows/${flowId}/steps/${stepId}`, data).then((r) => r.data),
  deleteStep: (flowId: string, stepId: string) =>
    api.delete(`/flows/${flowId}/steps/${stepId}`).then((r) => r.data),
  addAuthLevel: (flowId: string, stepId: string, data: any) =>
    api.post(`/flows/${flowId}/steps/${stepId}/auth-levels`, data).then((r) => r.data),
  updateAuthLevel: (flowId: string, stepId: string, levelId: string, data: any) =>
    api.put(`/flows/${flowId}/steps/${stepId}/auth-levels/${levelId}`, data).then((r) => r.data),
  deleteAuthLevel: (flowId: string, stepId: string, levelId: string) =>
    api.delete(`/flows/${flowId}/steps/${stepId}/auth-levels/${levelId}`).then((r) => r.data),
};

// Requests
export const requestsApi = {
  getAll: (params?: { status?: string; type?: string; search?: string }) =>
    api.get<Request[]>('/requests', { params }).then((r) => r.data),
  getById: (id: string) => api.get<Request>(`/requests/${id}`).then((r) => r.data),
  create: (data: any) => api.post<Request>('/requests', data).then((r) => r.data),
  update: (id: string, data: any) => api.put<Request>(`/requests/${id}`, data).then((r) => r.data),
  cancel: (id: string) => api.delete(`/requests/${id}`).then((r) => r.data),
  approve: (id: string, comments?: string) =>
    api.post(`/requests/${id}/approve`, { comments }).then((r) => r.data),
  reject: (id: string, comments?: string) =>
    api.post(`/requests/${id}/reject`, { comments }).then((r) => r.data),
  // Decisão rica do aprovador (Fase 1): DEFER | REJECT | REQUEST_CORRECTION | REQUEST_INFO | FORWARD.
  decision: (
    id: string,
    payload: { action: string; reason?: string; forwardToUserId?: string; forwardToRole?: string },
  ) => api.post(`/requests/${id}/decision`, payload).then((r) => r.data),
  // Reenvio pelo iniciador quando a solicitação está AWAITING_CORRECTION.
  resubmit: (id: string) => api.post(`/requests/${id}/resubmit`).then((r) => r.data),
  // Grava valores de campos dinâmicos de uma etapa (resposta não ecoa valores).
  saveFields: (id: string, stepOrder: number, values: { fieldId: string; value: string }[]) =>
    api.post<{ ok: boolean; count: number; savedFieldIds: string[] }>(`/requests/${id}/fields`, { stepOrder, values }).then((r) => r.data),
  // Marca/desmarca um item de checklist (somente assignee da etapa/ADMIN).
  toggleChecklist: (id: string, itemId: string, checked: boolean) =>
    api.post<{ ok: boolean; checked: boolean; itemId: string }>(`/requests/${id}/checklist/${itemId}`, { checked }).then((r) => r.data),
  uploadAttachments: (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    return api.post<Attachment[]>(`/requests/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  getAttachments: (id: string) => api.get<Attachment[]>(`/requests/${id}/attachments`).then((r) => r.data),
  getAuditLog: (id: string) => api.get<AuditLog[]>(`/requests/${id}/audit`).then((r) => r.data),
  // Vincula/desvincula uma unidade física do inventário a uma linha de recurso.
  linkAsset: (id: string, resourceId: string, assetId: string | null) =>
    api.post(`/requests/${id}/resources/${resourceId}/asset`, { assetId }).then((r) => r.data),
  // Comentários por etapa
  getComments: (id: string) => api.get<Comment[]>(`/requests/${id}/comments`).then((r) => r.data),
  addComment: (id: string, body: string, stepOrder?: number | null) =>
    api.post<Comment>(`/requests/${id}/comments`, { body, stepOrder }).then((r) => r.data),
};

// Pagamentos — recorrências
export interface PaymentRecurrence {
  id: string;
  flowId: string;
  initiatorId: string;
  title: string;
  paymentCategory: string;
  amountCents: number;
  supplier?: string | null;
  costCenter?: string | null;
  justification?: string | null;
  intervalUnit: string;
  intervalCount: number;
  nextRunAt: string;
  lastRunAt?: string | null;
  isActive: boolean;
  flow?: { id: string; name: string; type: string };
}

export const paymentsApi = {
  listRecurrences: () => api.get<PaymentRecurrence[]>('/payments/recurrences').then((r) => r.data),
  createRecurrence: (data: {
    flowId: string; title: string; paymentCategory: string; amountCents: number;
    supplier?: string; costCenter: string; justification: string;
    intervalUnit: string; intervalCount: number; nextRunAt?: string;
  }) => api.post<PaymentRecurrence>('/payments/recurrences', data).then((r) => r.data),
  updateRecurrence: (id: string, data: Partial<{
    isActive: boolean; title: string; amountCents: number; supplier: string;
    costCenter: string; justification: string; intervalUnit: string; intervalCount: number; nextRunAt: string;
  }>) => api.put<PaymentRecurrence>(`/payments/recurrences/${id}`, data).then((r) => r.data),
  runRecurrences: () => api.post<{ created: number }>('/payments/recurrences/run', {}).then((r) => r.data),
};

// Tasks
export const tasksApi = {
  getMy: () => api.get<RequestTask[]>('/tasks/my').then((r) => r.data),
  getById: (id: string) => api.get<RequestTask>(`/tasks/${id}`).then((r) => r.data),
  update: (id: string, data: any) => api.put<RequestTask>(`/tasks/${id}`, data).then((r) => r.data),
  complete: (id: string, notes?: string) =>
    api.post<RequestTask>(`/tasks/${id}/complete`, { notes }).then((r) => r.data),
  reject: (id: string, notes?: string) =>
    api.post<RequestTask>(`/tasks/${id}/reject`, { notes }).then((r) => r.data),
  // Assumir uma tarefa de fila (dono único). Cancela as irmãs PENDING da etapa.
  claim: (id: string) => api.post<RequestTask>(`/tasks/${id}/claim`).then((r) => r.data),
  // Justificar atraso de uma tarefa (SLA).
  justifyDelay: (id: string, justification: string) =>
    api.post<RequestTask>(`/tasks/${id}/justify-delay`, { justification }).then((r) => r.data),
  batchComplete: (taskIds: string[], notes?: string) =>
    api.post<{ completed: number; tasks: RequestTask[] }>('/tasks/batch-complete', { taskIds, notes }).then((r) => r.data),
  uploadAttachment: (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    return api.post<Attachment[]>(`/tasks/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

// Resources
export const resourcesApi = {
  getAll: () => api.get<ResourceItem[]>('/resources').then(r => r.data),
  getActive: () => api.get<ResourceItem[]>('/resources/active').then(r => r.data),
  create: (data: { name: string; type: string; sectorId?: string; sortOrder?: number }) =>
    api.post<ResourceItem>('/resources', data).then(r => r.data),
  update: (id: string, data: Partial<ResourceItem>) =>
    api.put<ResourceItem>(`/resources/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/resources/${id}`).then(r => r.data),
};

// Auditoria global (somente ADMIN) — trilha filtrável + export Excel
export const auditApi = {
  list: (params?: { requestId?: string; userId?: string; action?: string; from?: string; to?: string; limit?: number }) =>
    api.get<AuditLog[]>('/audit-logs', { params }).then(r => r.data),
  actions: () => api.get<string[]>('/audit-logs/actions').then(r => r.data),
  export: (params?: { action?: string; from?: string; to?: string }) =>
    api.get('/audit-logs/export', { params, responseType: 'blob' }).then(r => r.data as Blob),
};

// Notificações in-app + preferências
export const notificationsApi = {
  list: (status?: string) => api.get<Notification[]>('/notifications', { params: { status } }).then(r => r.data),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count').then(r => r.data.count),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then(r => r.data),
  readAll: () => api.post('/notifications/read-all').then(r => r.data),
  getPreferences: () => api.get<NotificationPreference[]>('/notifications/preferences').then(r => r.data),
  updatePreferences: (preferences: { channel: string; eventType: string; enabled: boolean }[]) =>
    api.put<NotificationPreference[]>('/notifications/preferences', { preferences }).then(r => r.data),
};

// Relatórios / SLA (somente ADMIN/MANAGER)
export const reportsApi = {
  dashboard: (params?: { from?: string; to?: string; flowType?: string }) =>
    api.get<DashboardReport>('/reports/dashboard', { params }).then(r => r.data),
};

// Inventário patrimonial
export const inventoryApi = {
  // Catálogo
  getItems: (params?: { type?: string; category?: string; isActive?: string }) =>
    api.get<InventoryItem[]>('/inventory/items', { params }).then(r => r.data),
  createItem: (data: Partial<InventoryItem>) =>
    api.post<InventoryItem>('/inventory/items', data).then(r => r.data),
  updateItem: (id: string, data: Partial<InventoryItem>) =>
    api.put<InventoryItem>(`/inventory/items/${id}`, data).then(r => r.data),
  deleteItem: (id: string) => api.delete(`/inventory/items/${id}`).then(r => r.data),
  // Ativos
  getAssets: (params?: { status?: string; type?: string; departmentId?: string; userId?: string; search?: string }) =>
    api.get<Asset[]>('/inventory/assets', { params }).then(r => r.data),
  getAsset: (id: string) => api.get<Asset>(`/inventory/assets/${id}`).then(r => r.data),
  createAsset: (data: Partial<Asset>) =>
    api.post<Asset>('/inventory/assets', data).then(r => r.data),
  updateAsset: (id: string, data: Partial<Asset>) =>
    api.put<Asset>(`/inventory/assets/${id}`, data).then(r => r.data),
  registerMovement: (assetId: string, data: Record<string, unknown>) =>
    api.post<AssetMovement>(`/inventory/assets/${assetId}/movements`, data).then(r => r.data),
  // Log global de movimentações
  getMovements: (params?: { type?: string; assetId?: string; requestId?: string }) =>
    api.get<AssetMovement[]>('/inventory/movements', { params }).then(r => r.data),
  // Almoxarifados
  getWarehouses: () => api.get<Warehouse[]>('/inventory/warehouses').then(r => r.data),
};

export default api;
