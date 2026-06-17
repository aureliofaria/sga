export interface Department {
  id: string;
  name: string;
  createdAt: string;
  _count?: { users: number };
}

export interface SectorMember {
  id: string;
  sectorId: string;
  userId: string;
  user: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  role: 'LIDER' | 'PROTETOR';
  createdAt: string;
}

export interface Sector {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  members: SectorMember[];
  users?: Pick<User, 'id' | 'name' | 'email' | 'role'>[];
  flowTemplates?: Pick<FlowTemplate, 'id' | 'name' | 'type' | 'scope' | 'isActive'>[];
  _count?: { members: number; users: number; flowTemplates: number };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'FINANCE' | 'HR' | 'USER';
  requestPermissions?: string[] | null; // null = todos os tipos liberados
  departmentId?: string;
  department?: Department;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizationLevel {
  id: string;
  flowStepId: string;
  name: string;
  minValue?: number;
  maxValue?: number;
  requiredApprovers: number;
  approverRole: string;
  deadlineHours?: number;
}

export interface ResourceItem {
  id: string;
  name: string;
  type: 'EQUIPMENT' | 'SYSTEM_ACCESS' | 'OTHER';
  sectorId?: string;
  sector?: { id: string; name: string };
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  requestResources?: RequestResource[];
}

export interface RequestResource {
  id: string;
  requestId: string;
  resourceItemId: string;
  resourceItem: ResourceItem & { sector?: { id: string; name: string } };
  quantity: number;
  notes?: string;
  status: 'PENDING' | 'ALLOCATED' | 'RETURNED';
  createdAt: string;
}

export interface FlowStep {
  id: string;
  flowTemplateId: string;
  order: number;
  name: string;
  description?: string;
  requiredRole?: string;
  requiresAttachment: boolean;
  deadlineHours?: number;
  slaExpiry?: 'KEEP_WITH_RESPONSIBLE' | 'RETURN_TO_REQUESTER' | 'TRANSFER_TO_LEADER';
  handlingSectorId?: string;
  handlingSector?: { id: string; name: string };
  authLevels: AuthorizationLevel[];
  conditions?: string;
  activateOnSectorId?: string;
  activateOnSector?: { id: string; name: string };
  collectsResources?: boolean;
  createdAt: string;
}

export interface FlowTemplate {
  id: string;
  name: string;
  description?: string;
  type: 'ONBOARDING' | 'OFFBOARDING' | 'PAYMENT' | 'PURCHASE';
  scope: 'INTRA' | 'INTER';
  sectorId?: string;
  sector?: { id: string; name: string };
  isActive: boolean;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
  _count?: { steps: number };
}

export interface Attachment {
  id: string;
  requestId?: string;
  taskId?: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  requestId: string;
  approverId: string;
  approver: Pick<User, 'id' | 'name' | 'role'>;
  stepOrder: number;
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  comments?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  requestId: string;
  userId: string;
  userName: string;
  action: string;
  details?: string;
  createdAt: string;
}

export interface RequestTask {
  id: string;
  requestId: string;
  stepId: string;
  step?: FlowStep;
  assigneeId: string;
  assignee: Pick<User, 'id' | 'name' | 'email'>;
  title: string;
  description?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
  dueDate?: string;
  completedAt?: string;
  notes?: string;
  slaEscalated?: boolean;
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
  request?: {
    id: string;
    title: string;
    flow: FlowTemplate;
    initiator: Pick<User, 'id' | 'name'>;
  };
}

export type RequestStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Request {
  id: string;
  flowId: string;
  flow: FlowTemplate;
  initiatorId: string;
  initiator: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  title: string;
  description?: string;
  status: RequestStatus;
  currentStep: number;
  // HR
  targetEmployee?: string;
  targetDepartment?: string;
  startDate?: string;
  vacancyType?: string;
  replacementName?: string;
  resources?: RequestResource[];
  // Financial
  amount?: number;
  currency: string;
  supplier?: string;
  costCenter?: string;
  justification?: string;
  tasks: RequestTask[];
  attachments: Attachment[];
  approvals: Approval[];
  auditLogs: AuditLog[];
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number; attachments: number };
}
