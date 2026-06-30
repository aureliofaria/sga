export interface Department {
  id: string;
  name: string;
  createdAt: string;
  _count?: { users: number };
}

export type SectorLevel = 'LIDER_1' | 'LIDER_2' | 'MEMBRO';

export interface SectorMember {
  id: string;
  sectorId: string;
  userId: string;
  user: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  role: 'LIDER' | 'PROTETOR';
  level: SectorLevel;
  reportsToId?: string | null;
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
  minValueCents?: number;
  maxValueCents?: number;
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
  // Grupo de exclusão mútua (itens do mesmo grupo: escolher só um).
  selectionGroup?: string | null;
  // Dependência: este item só fica disponível se o item-pai estiver selecionado.
  dependsOnId?: string | null;
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
  assetId?: string | null;
  asset?: Asset | null;
  createdAt: string;
}

// ===== Inventário patrimonial =====
export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'TI' | 'ADMINISTRATIVO';
  category: 'HARDWARE' | 'PERIFERICO' | 'SMARTPHONE' | 'CHIP' | 'MOBILIARIO' | 'OUTROS';
  brand?: string | null;
  model?: string | null;
  unit: string;
  isActive: boolean;
  createdAt: string;
  assets?: Asset[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export type AssetStatus = 'DISPONIVEL' | 'ATIVO' | 'MANUTENCAO' | 'EMPRESTADO' | 'RESERVADO' | 'DESCARTADO';

export interface Asset {
  id: string;
  itemId: string;
  item?: InventoryItem;
  tag?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  phoneNumber?: string | null;
  status: AssetStatus;
  condition: 'NOVO' | 'BOM' | 'REGULAR' | 'RUIM';
  purchaseDate?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  invoiceValueCents?: number | null;
  warehouseId?: string | null;
  warehouse?: Warehouse | null;
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  userId?: string | null;
  user?: { id: string; name: string } | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  movements?: AssetMovement[];
}

export interface Comment {
  id: string;
  requestId: string;
  stepOrder?: number | null;
  authorId: string;
  author?: { id: string; name: string };
  body: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  requestId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  channel: string;
  status: 'UNREAD' | 'READ' | 'PENDING' | 'SENT';
  createdAt: string;
  readAt?: string | null;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  channel: string;
  eventType: string;
  enabled: boolean;
}

export interface DashboardReport {
  range: { from: string; to: string };
  totals: { requests: number; open: number; completed: number; rejected: number };
  statusCounts: Record<string, number>;
  byFlowType: { type: string; name: string; count: number }[];
  sla: {
    onTime: number;
    late: number;
    overduePending: number;
    pendingOnTrack: number;
    noSla: number;
    complianceRate: number | null;
    avgCompletionHours: number | null;
  };
  throughput: { date: string; created: number; completed: number }[];
}

export interface AssetMovement {
  id: string;
  assetId: string;
  asset?: Asset;
  type: string;
  movementDate: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  requestId?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
}

// Tipo de campo dinâmico (FormField) — Fase 1 (trilha de onboarding).
export type FieldType = 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'DATE' | 'SELECT' | 'EMAIL' | 'CPF' | 'RG' | 'MONEY' | 'PHONE';

// Definição de um campo dinâmico de uma etapa (vem de GET /flows/:id).
export interface FormField {
  id: string;
  flowStepId: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string | null; // JSON array (string) p/ SELECT
  order: number;
  sensitiveType?: string | null;
  createdAt?: string;
}

// Item de checklist de uma etapa. No GET /requests/:id vem anotado pelo servidor
// com `applicable` (a condição se aplica a esta solicitação) e `checked` (estado).
export interface ChecklistItem {
  id: string;
  flowStepId: string;
  label: string;
  order: number;
  required: boolean;
  condition?: string | null;
  applicable?: boolean;
  checked?: boolean;
  createdAt?: string;
}

// Valor dinâmico já mascarado para o espectador (GET /requests/:id).
export interface RequestFieldValue {
  id: string;
  requestId: string;
  fieldId: string;
  value: string; // JÁ MASCARADO pelo servidor quando sensível
  field: Pick<FormField, 'key' | 'label' | 'type' | 'sensitiveType' | 'order' | 'options'>;
  createdAt?: string;
  updatedAt?: string;
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
  formFields?: FormField[];
  checklistItems?: ChecklistItem[];
  conditions?: string;
  activateOnSectorId?: string;
  activateOnSector?: { id: string; name: string };
  collectsResources?: boolean;
  statusLabel?: string | null;
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
  request?: { title: string } | null;
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
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
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
  | 'AWAITING_CORRECTION'
  | 'AWAITING_INFO'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED';

// Ações de decisão rica do aprovador (POST /requests/:id/decision).
export type DecisionAction = 'DEFER' | 'REJECT' | 'REQUEST_CORRECTION' | 'REQUEST_INFO' | 'FORWARD';

// Filho de subfluxo (ex.: compra vinculada) — vem de GET /requests/:id.
export interface RequestChild {
  id: string;
  title: string;
  status: RequestStatus;
  flow?: { type: string };
}

export interface Request {
  id: string;
  flowId: string;
  flow: FlowTemplate;
  initiatorId: string;
  initiator: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  title: string;
  description?: string;
  status: RequestStatus;
  // Rótulo humano da etapa corrente (Fase 0/1). Quando ausente, cair no status de máquina.
  statusLabel?: string | null;
  currentStep: number;
  // Subfluxo (Fase 0 · Passo 9)
  parentRequestId?: string | null;
  children?: RequestChild[];
  // Valores dinâmicos JÁ MASCARADOS para o espectador (GET /requests/:id)
  fieldValues?: RequestFieldValue[];
  // HR
  targetEmployee?: string;
  targetDepartment?: string;
  startDate?: string;
  vacancyType?: string;
  replacementName?: string;
  resources?: RequestResource[];
  // Financial — valor em centavos (inteiro)
  amountCents?: number;
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
