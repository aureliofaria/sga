import axios from 'axios';
import type { User, Department, FlowTemplate, Request, RequestTask, Attachment, AuditLog } from '../types';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sga_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sga_token');
      localStorage.removeItem('sga_user');
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

// Flows
export const flowsApi = {
  getAll: () => api.get<FlowTemplate[]>('/flows').then((r) => r.data),
  getById: (id: string) => api.get<FlowTemplate>(`/flows/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; type: string; isActive?: boolean }) =>
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
  uploadAttachments: (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    return api.post<Attachment[]>(`/requests/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  getAttachments: (id: string) => api.get<Attachment[]>(`/requests/${id}/attachments`).then((r) => r.data),
  getAuditLog: (id: string) => api.get<AuditLog[]>(`/requests/${id}/audit`).then((r) => r.data),
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
  uploadAttachment: (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    return api.post<Attachment[]>(`/tasks/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

export default api;
