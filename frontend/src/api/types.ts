export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string;
}

export interface FlowStep {
  id?: string;
  name?: string;
  order?: number;
  [key: string]: unknown;
}

export interface FlowTemplate {
  id: string;
  name: string;
  type: string;
  description?: string;
  steps: FlowStep[];
}

export interface RequestSummary {
  id: string;
  title: string;
  status: string;
  currentStep?: number | string | null;
  amountCents?: number | null;
  createdAt: string;
  initiator?: { name: string };
  flow?: { name: string; steps?: FlowStep[] };
}

export interface AuditLog {
  id: string;
  requestId?: string;
  userId?: string;
  userName?: string;
  action: string;
  details?: string | null;
  createdAt: string;
  request?: { title: string } | null;
  /** @deprecated legacy fields kept for request-detail history rendering */
  message?: string;
  actor?: { name?: string } | null;
}

export interface AuditLogFilters {
  requestId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface Approval {
  id: string;
  decision: string;
  comments?: string | null;
  createdAt: string;
  approver?: { name?: string } | null;
}

export interface Task {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  request: { id: string; title: string };
}

export interface RequestDetail extends RequestSummary {
  description?: string | null;
  supplier?: string | null;
  costCenter?: string | null;
  justification?: string | null;
  tasks?: Task[];
  approvals?: Approval[];
  auditLogs?: AuditLog[];
}

export interface Department {
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  requestId: string;
  stepOrder: number | null;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export interface CommentInput {
  body: string;
  stepOrder?: number | null;
}

export type NotificationChannel = 'IN_APP' | 'TEAMS' | 'OUTLOOK';

export type NotificationEventType =
  | 'TASK_ASSIGNED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_COMPLETED'
  | 'COMMENT_ADDED';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  channel: string;
  status: string;
  requestId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPreference {
  id: string;
  channel: NotificationChannel;
  eventType: NotificationEventType;
  enabled: boolean;
}

export interface NotificationPreferenceInput {
  channel: NotificationChannel;
  eventType: NotificationEventType;
  enabled: boolean;
}

export interface CreateRequestInput {
  flowId: string;
  title: string;
  description?: string;
  amountCents?: number;
  supplier?: string;
  costCenter?: string;
  justification?: string;
  targetEmployeeId?: string;
  targetDepartmentId?: string;
  startDate?: string;
}

export interface ApprovalInput {
  requestId: string;
  decision: 'APPROVED' | 'REJECTED';
  comments?: string;
}
