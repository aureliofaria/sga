import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Approval,
  ApprovalInput,
  Comment,
  CommentInput,
  CreateRequestInput,
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
