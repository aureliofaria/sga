import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed...');

  // Departments
  const ti = await prisma.department.create({ data: { name: 'TI' } });
  const rh = await prisma.department.create({ data: { name: 'RH' } });
  const financeiro = await prisma.department.create({ data: { name: 'Financeiro' } });
  const comercial = await prisma.department.create({ data: { name: 'Comercial' } });
  const operacoes = await prisma.department.create({ data: { name: 'Operações' } });

  console.log('Departamentos criados');

  const isProd = process.env.NODE_ENV === 'production';

  // Administrador inicial: em produção vem de variáveis de ambiente (sem
  // credencial padrão); em desenvolvimento usa admin@sga.com / senha123.
  if (isProd && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
    throw new Error('Em produção, defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o administrador inicial.');
  }
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@sga.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'senha123';
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { name: 'Administrador', email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 10), role: 'ADMIN' },
  });

  // Usuários de DEMONSTRAÇÃO — nunca criados em produção (senha padrão).
  const hash = await bcrypt.hash('senha123', 10);
  let anaRH: any, carlosFinanceiro: any, robertoGestor: any, joao: any;
  if (!isProd) {
    anaRH = await prisma.user.create({
      data: { name: 'Ana Silva', email: 'rh@sga.com', passwordHash: hash, role: 'HR', departmentId: rh.id },
    });
    carlosFinanceiro = await prisma.user.create({
      data: { name: 'Carlos Souza', email: 'financeiro@sga.com', passwordHash: hash, role: 'FINANCE', departmentId: financeiro.id },
    });
    robertoGestor = await prisma.user.create({
      data: { name: 'Roberto Lima', email: 'gestor@sga.com', passwordHash: hash, role: 'MANAGER', departmentId: comercial.id },
    });
    joao = await prisma.user.create({
      data: { name: 'João Santos', email: 'joao@sga.com', passwordHash: hash, role: 'USER', departmentId: ti.id },
    });
    console.log('Usuários de demonstração criados');
  }

  // Catálogo de inventário (recursos alocáveis em admissões / devolvidos em desligamentos)
  const notebook = await prisma.resourceItem.create({ data: { name: 'Notebook Dell Latitude', type: 'EQUIPMENT', sortOrder: 1 } });
  const monitor = await prisma.resourceItem.create({ data: { name: 'Monitor 24"', type: 'EQUIPMENT', sortOrder: 2 } });
  const cracha = await prisma.resourceItem.create({ data: { name: 'Crachá de Acesso', type: 'OTHER', sortOrder: 3 } });
  await prisma.resourceItem.createMany({
    data: [
      { name: 'Acesso ao ERP', type: 'SYSTEM_ACCESS', sortOrder: 4 },
      { name: 'Conta de E-mail Corporativo', type: 'SYSTEM_ACCESS', sortOrder: 5 },
      { name: 'Licença Office 365', type: 'SYSTEM_ACCESS', sortOrder: 6 },
    ],
  });

  console.log('Catálogo de inventário criado');

  // Flow 1: Admissão de Colaborador
  const admissaoFlow = await prisma.flowTemplate.create({
    data: {
      name: 'Admissão de Colaborador',
      description: 'Processo completo de admissão de novo colaborador',
      type: 'ONBOARDING',
      isActive: true,
    },
  });

  const admissaoStep1 = await prisma.flowStep.create({
    data: {
      flowTemplateId: admissaoFlow.id,
      order: 0,
      name: 'Documentação RH',
      description: 'Coleta e validação de documentos do colaborador',
      requiredRole: 'HR',
      requiresAttachment: true,
      deadlineHours: 48,
    },
  });
  const admissaoStep2 = await prisma.flowStep.create({
    data: {
      flowTemplateId: admissaoFlow.id,
      order: 1,
      name: 'Configuração TI',
      description: 'Criação de acessos e configuração de equipamentos',
      requiredRole: 'USER',
      requiresAttachment: false,
      deadlineHours: 24,
    },
  });
  const admissaoStep3 = await prisma.flowStep.create({
    data: {
      flowTemplateId: admissaoFlow.id,
      order: 2,
      name: 'Cadastro Financeiro',
      description: 'Cadastro de dados bancários e benefícios',
      requiredRole: 'FINANCE',
      requiresAttachment: false,
      deadlineHours: 24,
    },
  });
  const admissaoStep4 = await prisma.flowStep.create({
    data: {
      flowTemplateId: admissaoFlow.id,
      order: 3,
      name: 'Boas-vindas do Gestor',
      description: 'Apresentação da equipe e integração',
      requiredRole: 'MANAGER',
      requiresAttachment: false,
      deadlineHours: 8,
    },
  });

  // Flow 2: Desligamento de Colaborador
  const desligamentoFlow = await prisma.flowTemplate.create({
    data: {
      name: 'Desligamento de Colaborador',
      description: 'Processo de offboarding e desligamento do colaborador',
      type: 'OFFBOARDING',
      isActive: true,
    },
  });

  await prisma.flowStep.createMany({
    data: [
      { flowTemplateId: desligamentoFlow.id, order: 0, name: 'Solicitação do Gestor', description: 'Formalização da solicitação de desligamento', requiredRole: 'MANAGER', requiresAttachment: false, deadlineHours: 24 },
      { flowTemplateId: desligamentoFlow.id, order: 1, name: 'Entrevista de Desligamento', description: 'Entrevista de saída com RH', requiredRole: 'HR', requiresAttachment: true, deadlineHours: 48 },
      { flowTemplateId: desligamentoFlow.id, order: 2, name: 'Revogação de Acessos TI', description: 'Remoção de todos os acessos e devolução de equipamentos', requiredRole: 'USER', requiresAttachment: false, deadlineHours: 8 },
      { flowTemplateId: desligamentoFlow.id, order: 3, name: 'Acertos Financeiros', description: 'Cálculo e processamento de verbas rescisórias', requiredRole: 'FINANCE', requiresAttachment: true, deadlineHours: 72 },
    ],
  });

  // Flow 3: Solicitação de Pagamento
  const pagamentoFlow = await prisma.flowTemplate.create({
    data: {
      name: 'Solicitação de Pagamento',
      description: 'Aprovação e processamento de pagamentos',
      type: 'PAYMENT',
      isActive: true,
    },
  });

  await prisma.flowStep.create({
    data: {
      flowTemplateId: pagamentoFlow.id,
      order: 0,
      name: 'Solicitação',
      description: 'Detalhamento da solicitação de pagamento',
      requiredRole: 'USER',
      requiresAttachment: false,
    },
  });

  const pagamentoStep2 = await prisma.flowStep.create({
    data: {
      flowTemplateId: pagamentoFlow.id,
      order: 1,
      name: 'Aprovação do Gestor',
      description: 'Análise e aprovação pelo gestor responsável',
      requiredRole: 'MANAGER',
      requiresAttachment: false,
      deadlineHours: 24,
    },
  });

  await prisma.authorizationLevel.createMany({
    data: [
      { flowStepId: pagamentoStep2.id, name: 'Até R$ 5.000', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER', deadlineHours: 24 },
      { flowStepId: pagamentoStep2.id, name: 'R$ 5.000,01 a R$ 50.000', minValueCents: 500001, maxValueCents: 5000000, requiredApprovers: 1, approverRole: 'FINANCE', deadlineHours: 48 },
      { flowStepId: pagamentoStep2.id, name: 'Acima de R$ 50.000', minValueCents: 5000001, maxValueCents: null, requiredApprovers: 1, approverRole: 'ADMIN', deadlineHours: 72 },
    ],
  });

  await prisma.flowStep.create({
    data: {
      flowTemplateId: pagamentoFlow.id,
      order: 2,
      name: 'Processamento Financeiro',
      description: 'Processamento e efetivação do pagamento',
      requiredRole: 'FINANCE',
      requiresAttachment: true,
      deadlineHours: 48,
    },
  });

  // Flow 4: Solicitação de Compra
  const compraFlow = await prisma.flowTemplate.create({
    data: {
      name: 'Solicitação de Compra',
      description: 'Processo de aprovação de compras',
      type: 'PURCHASE',
      isActive: true,
    },
  });

  await prisma.flowStep.create({
    data: { flowTemplateId: compraFlow.id, order: 0, name: 'Requisição', description: 'Detalhamento da necessidade de compra', requiredRole: 'USER' },
  });

  const compraStep2 = await prisma.flowStep.create({
    data: { flowTemplateId: compraFlow.id, order: 1, name: 'Aprovação Gerencial', description: 'Análise e aprovação da compra', requiredRole: 'MANAGER', deadlineHours: 24 },
  });

  await prisma.authorizationLevel.createMany({
    data: [
      { flowStepId: compraStep2.id, name: 'Até R$ 5.000', minValueCents: 0, maxValueCents: 500000, requiredApprovers: 1, approverRole: 'MANAGER', deadlineHours: 24 },
      { flowStepId: compraStep2.id, name: 'R$ 5.000,01 a R$ 50.000', minValueCents: 500001, maxValueCents: 5000000, requiredApprovers: 1, approverRole: 'FINANCE', deadlineHours: 48 },
      { flowStepId: compraStep2.id, name: 'Acima de R$ 50.000', minValueCents: 5000001, maxValueCents: null, requiredApprovers: 1, approverRole: 'ADMIN', deadlineHours: 72 },
    ],
  });

  await prisma.flowStep.create({
    data: { flowTemplateId: compraFlow.id, order: 2, name: 'Validação Financeira', description: 'Verificação orçamentária e processamento', requiredRole: 'FINANCE', requiresAttachment: true, deadlineHours: 48 },
  });

  console.log('Fluxos criados');

  // Solicitações de DEMONSTRAÇÃO — nunca criadas em produção.
  if (!isProd) {
  // 1. Completed onboarding request
  const onboardingRequest = await prisma.request.create({
    data: {
      flowId: admissaoFlow.id,
      initiatorId: anaRH.id,
      title: 'Admissão - Maria Fernanda Costa',
      description: 'Processo de admissão para a vaga de Analista de Marketing',
      status: 'COMPLETED',
      currentStep: 3,
      targetEmployee: 'Maria Fernanda Costa',
      targetDepartment: 'Comercial',
      startDate: '2026-07-01',
    },
  });

  // Recursos alocados na admissão concluída
  await prisma.requestResource.createMany({
    data: [
      { requestId: onboardingRequest.id, resourceItemId: notebook.id, status: 'ALLOCATED' },
      { requestId: onboardingRequest.id, resourceItemId: monitor.id, status: 'ALLOCATED' },
      { requestId: onboardingRequest.id, resourceItemId: cracha.id, status: 'ALLOCATED' },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { requestId: onboardingRequest.id, userId: anaRH.id, userName: 'Ana Silva', action: 'CREATED', details: 'Solicitação criada', createdAt: new Date('2026-06-10T09:00:00') },
      { requestId: onboardingRequest.id, userId: anaRH.id, userName: 'Ana Silva', action: 'STEP_STARTED', details: 'Etapa iniciada: Documentação RH', createdAt: new Date('2026-06-10T09:01:00') },
      { requestId: onboardingRequest.id, userId: anaRH.id, userName: 'Ana Silva', action: 'TASK_COMPLETED', details: 'Tarefa concluída: Documentação RH', createdAt: new Date('2026-06-11T14:00:00') },
      { requestId: onboardingRequest.id, userId: joao.id, userName: 'João Santos', action: 'TASK_COMPLETED', details: 'Tarefa concluída: Configuração TI', createdAt: new Date('2026-06-12T10:00:00') },
      { requestId: onboardingRequest.id, userId: carlosFinanceiro.id, userName: 'Carlos Souza', action: 'TASK_COMPLETED', details: 'Tarefa concluída: Cadastro Financeiro', createdAt: new Date('2026-06-13T11:00:00') },
      { requestId: onboardingRequest.id, userId: robertoGestor.id, userName: 'Roberto Lima', action: 'TASK_COMPLETED', details: 'Tarefa concluída: Boas-vindas do Gestor', createdAt: new Date('2026-06-14T09:00:00') },
      { requestId: onboardingRequest.id, userId: admin.id, userName: 'Sistema', action: 'COMPLETED', details: 'Solicitação concluída com sucesso', createdAt: new Date('2026-06-14T09:01:00') },
    ],
  });

  // 2. In-progress payment request
  const paymentRequest = await prisma.request.create({
    data: {
      flowId: pagamentoFlow.id,
      initiatorId: joao.id,
      title: 'Pagamento - Licença de Software Figma',
      description: 'Renovação anual da licença do Figma para a equipe de design',
      status: 'IN_PROGRESS',
      currentStep: 1,
      amountCents: 350000,
      supplier: 'Figma Inc.',
      costCenter: 'TI-001',
      justification: 'Ferramenta essencial para o time de design e produto',
    },
  });

  await prisma.requestTask.create({
    data: {
      requestId: paymentRequest.id,
      stepId: pagamentoStep2.id,
      assigneeId: robertoGestor.id,
      title: 'Aprovação do Gestor',
      description: 'Análise e aprovação pelo gestor responsável',
      status: 'PENDING',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await prisma.auditLog.createMany({
    data: [
      { requestId: paymentRequest.id, userId: joao.id, userName: 'João Santos', action: 'CREATED', details: 'Solicitação criada: Pagamento - Licença de Software Figma' },
      { requestId: paymentRequest.id, userId: admin.id, userName: 'Sistema', action: 'STEP_STARTED', details: 'Etapa iniciada: Aprovação do Gestor' },
    ],
  });

  // 3. Pending purchase request
  const purchaseRequest = await prisma.request.create({
    data: {
      flowId: compraFlow.id,
      initiatorId: joao.id,
      title: 'Compra - Equipamentos de Escritório',
      description: 'Aquisição de monitores e teclados para a equipe de TI',
      status: 'IN_PROGRESS',
      currentStep: 0,
      amountCents: 1200000,
      supplier: 'TechStore Ltda',
      costCenter: 'TI-002',
      justification: 'Substituição de equipamentos com mais de 5 anos de uso',
    },
  });

  await prisma.auditLog.create({
    data: { requestId: purchaseRequest.id, userId: joao.id, userName: 'João Santos', action: 'CREATED', details: 'Solicitação criada: Compra - Equipamentos de Escritório' },
  });

  console.log('Solicitações de exemplo criadas');
  } // fim do bloco de demonstração

  // Inventário patrimonial: almoxarifado padrão + catálogo inicial (TI e Administrativo)
  const almoxarifado = await prisma.warehouse.create({
    data: { code: 'ALM-01', name: 'Almoxarifado Central', description: 'Estoque central de TI e Administrativo' },
  });
  const catalogo = await Promise.all([
    prisma.inventoryItem.create({ data: { code: 'NB-DELL-5430', name: 'Notebook Dell Latitude 5430', type: 'TI', category: 'HARDWARE', brand: 'Dell', model: 'Latitude 5430' } }),
    prisma.inventoryItem.create({ data: { code: 'MON-LG-24', name: 'Monitor LG 24"', type: 'TI', category: 'PERIFERICO', brand: 'LG', model: '24MK430H' } }),
    prisma.inventoryItem.create({ data: { code: 'SMART-SAMS-A54', name: 'Smartphone Samsung Galaxy A54', type: 'TI', category: 'SMARTPHONE', brand: 'Samsung', model: 'Galaxy A54' } }),
    prisma.inventoryItem.create({ data: { code: 'CHIP-VIVO', name: 'Chip / Linha Telefônica Vivo', type: 'TI', category: 'CHIP', brand: 'Vivo', model: 'SIM' } }),
    prisma.inventoryItem.create({ data: { code: 'CAD-EXEC', name: 'Cadeira Executiva', type: 'ADMINISTRATIVO', category: 'MOBILIARIO' } }),
  ]);
  // Algumas unidades físicas de exemplo, com movimentação de ENTRADA registrada.
  const notebookItem = catalogo[0];
  await prisma.asset.create({
    data: {
      itemId: notebookItem.id, tag: 'PAT-0001', serialNumber: 'SN-DELL-0001', status: 'DISPONIVEL', condition: 'NOVO',
      supplier: 'Dell', invoiceNumber: 'NF-1001', invoiceValueCents: 450000, warehouseId: almoxarifado.id,
      movements: { create: { type: 'ENTRADA', newStatus: 'DISPONIVEL', reason: 'Cadastro inicial', createdById: admin.id } },
    },
  });
  console.log('Inventário patrimonial criado (almoxarifado + catálogo + ativo de exemplo)');

  console.log('\nSeed concluído com sucesso!');
  if (isProd) {
    console.log(`Administrador: ${adminEmail} (senha definida via ADMIN_PASSWORD).`);
    console.log('Nenhum usuário/solicitação de demonstração criado (produção).');
  } else {
    console.log('\nUsuários de demonstração (senha: senha123):');
    console.log('  admin@sga.com · rh@sga.com · financeiro@sga.com · gestor@sga.com · joao@sga.com');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
