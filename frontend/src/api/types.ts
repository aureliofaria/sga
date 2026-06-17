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
  flow?: { name: string };
}

export interface AuditLog {
  id: string;
  action: string;
  message?: string;
  createdAt: string;
  actor?: { name?: string } | null;
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
