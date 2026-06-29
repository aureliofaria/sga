import jwt from 'jsonwebtoken';
import prisma from '../src/lib/prisma';
import { config } from '../src/config';

// Forja um token válido para o usuário (mesmo payload do /auth/login: { userId }).
export function tokenFor(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret);
}

// Limpa todas as tabelas respeitando as dependências de chave estrangeira.
export async function resetDb() {
  // Inventário primeiro: AssetMovement.createdById/assetId usam onDelete: RESTRICT,
  // então precisam sair antes de User/Asset.
  await prisma.assetMovement.deleteMany();
  await prisma.inventoryCountItem.deleteMany();
  await prisma.inventoryCount.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.requestTask.deleteMany();
  await prisma.requestResource.deleteMany();
  await prisma.requestFieldValue.deleteMany();
  await prisma.requestChecklistItem.deleteMany();
  await prisma.request.deleteMany();
  await prisma.authorizationLevel.deleteMany();
  await prisma.formField.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.flowStep.deleteMany();
  await prisma.flowTemplate.deleteMany();
  await prisma.resourceItem.deleteMany();
  // Parâmetros financeiros (Fase 0 · Passo 12): saem ANTES de sector/sectorMember
  // (FinanceParam.sectorId → Sector com onDelete: Cascade; auditoria é independente).
  await prisma.financeParamAuditLog.deleteMany();
  await prisma.financeParam.deleteMany();
  await prisma.delegationAuditLog.deleteMany();
  await prisma.sectorMember.deleteMany();
  await prisma.request.deleteMany();
  await prisma.user.deleteMany();
  await prisma.sector.deleteMany();
  await prisma.department.deleteMany();
}

let seq = 0;
export async function makeUser(role: string, name?: string) {
  seq++;
  return prisma.user.create({
    data: { name: name ?? `${role}-${seq}`, email: `u${seq}-${Date.now()}@test.com`, passwordHash: 'x', role },
  });
}

interface StepSpec {
  order: number;
  requiredRole?: string | null;
  conditions?: unknown;
  authLevels?: { name: string; minValueCents?: number | null; maxValueCents?: number | null; requiredApprovers: number; approverRole: string }[];
  activateOnSectorId?: string | null;
  // Fase 0 · Passo 10: rótulo de exibição opcional para a etapa.
  statusLabel?: string | null;
  // Fase 0 · Passo 11: setor que trata a etapa (resolução do Líder I) e overrides
  // opcionais da cadência de escalonamento.
  handlingSectorId?: string | null;
  slaExpiry?: string;
  escalationDay1?: number | null;
  escalationDay2?: number | null;
  escalationDay3?: number | null;
}

// Cria um FlowTemplate com etapas (e níveis de alçada) e retorna o template.
export async function makeFlow(type: string, steps: StepSpec[]) {
  const flow = await prisma.flowTemplate.create({ data: { name: `${type}-flow`, type, isActive: true } });
  for (const s of steps) {
    const step = await prisma.flowStep.create({
      data: {
        flowTemplateId: flow.id,
        order: s.order,
        name: `step-${s.order}`,
        requiredRole: s.requiredRole ?? null,
        conditions: s.conditions ? JSON.stringify(s.conditions) : null,
        activateOnSectorId: s.activateOnSectorId ?? null,
        statusLabel: s.statusLabel ?? null,
        handlingSectorId: s.handlingSectorId ?? null,
        slaExpiry: s.slaExpiry ?? undefined,
        escalationDay1: s.escalationDay1 ?? null,
        escalationDay2: s.escalationDay2 ?? null,
        escalationDay3: s.escalationDay3 ?? null,
      },
    });
    for (const lvl of s.authLevels ?? []) {
      await prisma.authorizationLevel.create({ data: { flowStepId: step.id, ...lvl } });
    }
  }
  return flow;
}

// Marca como COMPLETED todas as tarefas da etapa atual da solicitação.
export async function completeCurrentStepTasks(requestId: string) {
  const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  await prisma.requestTask.updateMany({
    where: { requestId, step: { order: req.currentStep }, status: { not: 'COMPLETED' } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}
