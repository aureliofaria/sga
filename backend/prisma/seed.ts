import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const defaultPassword = await bcrypt.hash('Aprova@2026', 10);

  const ti = await prisma.department.upsert({
    where: { id: 'dept-ti' },
    update: {},
    create: { id: 'dept-ti', name: 'Tecnologia da Informação' },
  });
  const rh = await prisma.department.upsert({
    where: { id: 'dept-rh' },
    update: {},
    create: { id: 'dept-rh', name: 'Recursos Humanos' },
  });
  const fin = await prisma.department.upsert({
    where: { id: 'dept-fin' },
    update: {},
    create: { id: 'dept-fin', name: 'Financeiro' },
  });

  const users: { email: string; name: string; role: string; departmentId: string }[] = [
    { email: 'admin@golplus.com.br', name: 'Administrador', role: 'ADMIN', departmentId: ti.id },
    { email: 'gestor@golplus.com.br', name: 'Gestor Operacional', role: 'MANAGER', departmentId: rh.id },
    { email: 'diretor@golplus.com.br', name: 'Diretor', role: 'DIRETOR', departmentId: fin.id },
    { email: 'cfo@golplus.com.br', name: 'CFO', role: 'CFO', departmentId: fin.id },
    { email: 'colaborador@golplus.com.br', name: 'Colaborador', role: 'USER', departmentId: rh.id },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, departmentId: u.departmentId },
      create: { ...u, passwordHash: defaultPassword },
    });
  }

  // Onboarding flow: manager review -> HR execution.
  const onboardingExists = await prisma.flowTemplate.findFirst({ where: { type: 'ONBOARDING' } });
  if (!onboardingExists) {
    await prisma.flowTemplate.create({
      data: {
        name: 'Onboarding de Colaborador',
        type: 'ONBOARDING',
        description: 'Admissão de novo colaborador',
        steps: {
          create: [
            { order: 0, name: 'Aprovação do Gestor', requiredRole: 'MANAGER', requiredApprovers: 1 },
            { order: 1, name: 'Execução RH', requiredRole: 'USER', requiredApprovers: 1, requiresAttachment: true },
          ],
        },
      },
    });
  }

  const offboardingExists = await prisma.flowTemplate.findFirst({ where: { type: 'OFFBOARDING' } });
  if (!offboardingExists) {
    await prisma.flowTemplate.create({
      data: {
        name: 'Offboarding de Colaborador',
        type: 'OFFBOARDING',
        description: 'Desligamento de colaborador',
        steps: {
          create: [
            { order: 0, name: 'Aprovação do Gestor', requiredRole: 'MANAGER', requiredApprovers: 1 },
            { order: 1, name: 'Aprovação Diretoria', requiredRole: 'DIRETOR', requiredApprovers: 1 },
          ],
        },
      },
    });
  }

  // Payment flow with value-based authorization bands (cents).
  const paymentExists = await prisma.flowTemplate.findFirst({ where: { type: 'PAYMENT' } });
  if (!paymentExists) {
    await prisma.flowTemplate.create({
      data: {
        name: 'Aprovação de Pagamento',
        type: 'PAYMENT',
        description: 'Aprovação de pagamentos por alçada de valor',
        steps: {
          create: [
            {
              order: 0,
              name: 'Aprovação por Alçada',
              requiredApprovers: 1,
              authLevels: {
                create: [
                  // até R$ 5.000,00 -> gestor
                  { name: 'Até R$ 5.000', minValueCents: 0, maxValueCents: 500000, approverRole: 'MANAGER', requiredApprovers: 1 },
                  // R$ 5.000,01 a R$ 50.000,00 -> diretor
                  { name: 'R$ 5.000 a R$ 50.000', minValueCents: 500001, maxValueCents: 5000000, approverRole: 'DIRETOR', requiredApprovers: 1 },
                  // acima de R$ 50.000,00 -> CFO, dois aprovadores
                  { name: 'Acima de R$ 50.000', minValueCents: 5000001, maxValueCents: null, approverRole: 'CFO', requiredApprovers: 2 },
                ],
              },
            },
          ],
        },
      },
    });
  }

  console.log('Seed concluído. Senha padrão dos usuários: Aprova@2026');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
