import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Approval,
  ApprovalInput,
  CreateRequestInput,
  Department,
  FlowTemplate,
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
