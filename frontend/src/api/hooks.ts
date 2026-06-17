import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Approval,
  ApprovalInput,
  AuditLog,
  AuditLogFilters,
  Comment,
  CommentInput,
  CreateRequestInput,
  DashboardFilters,
  DashboardReport,
  Department,
  FlowTemplate,
  Notification,
  NotificationPreference,
  NotificationPreferenceInput,
  RequestDetail,
  RequestSummary,
  Task,
  User,
} from './types';

/** Build an axios params object from defined (non-empty) filter values. */
function buildAuditParams(filters: AuditLogFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (filters.requestId) params.requestId = filters.requestId;
  if (filters.userId) params.userId = filters.userId;
  if (filters.action) params.action = filters.action;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.limit != null) params.limit = filters.limit;
  return params;
}

export function useAuditLogs(filters: AuditLogFilters, enabled = true) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<AuditLog[]>('/audit-logs', {
        params: buildAuditParams(filters),
      });
      return data;
    },
  });
}

export function useAuditActions(enabled = true) {
  return useQuery({
    queryKey: ['audit-logs', 'actions'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<string[]>('/audit-logs/actions');
      return data;
    },
  });
}

/** Download the audit logs export as an authenticated .xlsx blob. */
export async function exportAuditLogs(filters: AuditLogFilters): Promise<void> {
  const response = await api.get('/audit-logs/export', {
    params: buildAuditParams(filters),
    responseType: 'blob',
  });

  let filename = 'auditoria-aprova.xlsx';
  const disposition = response.headers['content-disposition'] as
    | string
    | undefined;
  if (disposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (match?.[1]) filename = decodeURIComponent(match[1]);
  }

  const url = window.URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<User>('/auth/me');
      return data;
    },
  });
}

export function useDashboard(filters: DashboardFilters, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'dashboard', filters],
    enabled,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.flowType) params.flowType = filters.flowType;
      const { data } = await api.get<DashboardReport>('/reports/dashboard', {
        params,
      });
      return data;
    },
  });
}

export function useFlowTemplates() {
  return useQuery({
    queryKey: ['flow-templates'],
    queryFn: async () => {
      const { data } = await api.get<FlowTemplate[]>('/flow-templates');
      return data;
    },
  });
}

export function useRequests() {
  return useQuery({
    queryKey: ['requests'],
    queryFn: async () => {
      const { data } = await api.get<RequestSummary[]>('/requests');
      return data;
    },
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['requests', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<RequestDetail>(`/requests/${id}`);
      return data;
    },
  });
}

export function useMyTasks() {
  return useQuery({
    queryKey: ['tasks', 'my'],
    queryFn: async () => {
      const { data } = await api.get<Task[]>('/tasks/my');
      return data;
    },
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get<User[]>('/users');
      return data;
    },
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data } = await api.get<Department[]>('/departments');
      return data;
    },
  });
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRequestInput) => {
      const { data } = await api.post<RequestDetail>('/requests', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

export function useCreateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApprovalInput) => {
      const { data } = await api.post<Approval>('/approvals', input);
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['tasks', 'my'] });
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['requests', variables.requestId] });
    },
  });
}

export function useComments(requestId: string | undefined) {
  return useQuery({
    queryKey: ['requests', requestId, 'comments'],
    enabled: Boolean(requestId),
    queryFn: async () => {
      const { data } = await api.get<Comment[]>(
        `/requests/${requestId}/comments`
      );
      return data;
    },
  });
}

export function useAddComment(requestId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CommentInput) => {
      const { data } = await api.post<Comment>(
        `/requests/${requestId}/comments`,
        input
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests', requestId, 'comments'] });
      qc.invalidateQueries({ queryKey: ['requests', requestId] });
    },
  });
}

export function useNotifications(status: 'UNREAD' | 'ALL' = 'UNREAD') {
  return useQuery({
    queryKey: ['notifications', status],
    queryFn: async () => {
      const { data } = await api.get<Notification[]>('/notifications', {
        params: { status },
      });
      return data;
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await api.get<{ count: number }>(
        '/notifications/unread-count'
      );
      return data;
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Notification>(
        `/notifications/${id}/read`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ message: string }>(
        '/notifications/read-all'
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const { data } = await api.get<NotificationPreference[]>(
        '/notifications/preferences'
      );
      return data;
    },
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: NotificationPreferenceInput[]) => {
      const { data } = await api.put<NotificationPreference[]>(
        '/notifications/preferences',
        { preferences }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}
