// Homologação ponta a ponta (UI via Playwright): COMPRA + PAGAMENTO.
// Pré-requisitos: servidor rodando (PORT/BASE) e banco semeado (db:seed).
//   BASE        — URL do app (default http://localhost:3099)
//   SHOT_DIR    — diretório dos prints (default /tmp)
//   CHROME_PATH — executável do Chromium (default: Chromium pré-instalado)
//   DATABASE_URL— banco do app (mesmo do servidor); default file:./prisma/dev.db
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const BASE = process.env.BASE || 'http://localhost:3099';
const prisma = new PrismaClient();
const OUT = process.env.SHOT_DIR || '/tmp';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) data = await r.json().catch(() => null);
  return { status: r.status, data };
}
const login = async (email) => (await api('POST', '/api/auth/login', null, { email, password: 'senha123' })).data;
// Anexa um documento (algumas etapas de submissão exigem ao menos um anexo).
async function attach(taskId, token, name, content) {
  const fd = new FormData();
  fd.append('files', new Blob([content], { type: 'application/pdf' }), name);
  const r = await fetch(`${BASE}/api/tasks/${taskId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  return r.status;
}
async function ensureUser(admin, name, email, role, sectorName, level) {
  let lf = await login(email);
  if (!lf?.token) { await api('POST', '/api/users', admin.token, { name, email, password: 'senha123', role }); lf = await login(email); }
  else if (lf.user.role !== role) { await api('PUT', `/api/users/${lf.user.id}`, admin.token, { role }); lf = await login(email); }
  if (sectorName) {
    const sec = await prisma.sector.findFirst({ where: { name: sectorName } });
    if (sec) await api('POST', `/api/sectors/${sec.id}/members`, admin.token, { userId: lf.user.id, level: level || 'MEMBRO' });
  }
  return lf;
}

const browser = await chromium.launch({ executablePath: CHROME });
async function shot(actor, route, file, waitFor) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(([t, u]) => { localStorage.setItem('aprova_token', t); localStorage.setItem('aprova_user', JSON.stringify(u)); }, [actor.token, actor.user]);
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}` });
  await ctx.close();
  console.log('shot', file);
}

const admin = await login('admin@aprova.com');

// ---- Setup: usuários de função + hierarquia + Financeiro membro + teto 10k ----
const solicitante = await ensureUser(admin, 'João Santos (TI)', 'joao@aprova.com', 'TI', 'TI, Dados e Infra', 'MEMBRO');
const gestor = await login('gestor@aprova.com'); // MANAGER (alçada até 5k)
const finLeader = await ensureUser(admin, 'Carlos (Líder Financeiro)', 'financeiro@aprova.com', 'FINANCE', 'Financeiro', 'LIDER_1');
const finMember = await ensureUser(admin, 'Fernanda (Financeiro)', 'fin.membro@aprova.com', 'FINANCEIRO', 'Financeiro', 'MEMBRO');

// Teto de R$ 10.000 para o setor do solicitante (TI, Dados e Infra) no mês atual.
const tiSector = await prisma.sector.findFirst({ where: { name: 'TI, Dados e Infra' } });
const now = new Date();
await prisma.financeParam.upsert({
  where: { sectorId_year_month: { sectorId: tiSector.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } },
  update: { ceilingCents: 1000000 },
  create: { sectorId: tiSector.id, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, ceilingCents: 1000000, updatedById: admin.user.id },
});
console.log('Teto R$10.000 definido para TI, Dados e Infra');

const flows = (await api('GET', '/api/flows', admin.token)).data;
const compra = flows.find(f => f.type === 'PURCHASE');
const pagamento = flows.find(f => f.type === 'PAYMENT');

async function tasksOf(reqId, order) {
  const full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data;
  return (full.tasks || []).filter(t => t.step?.order === order && ['PENDING', 'IN_PROGRESS'].includes(t.status));
}

// ============ CENÁRIO 1 — COMPRA (TI abre; valor R$4.500 ≤ teto e na alçada do gestor) ============
console.log('\n=== COMPRA ===');
const c = await api('POST', '/api/requests', solicitante.token, {
  flowId: compra.id, title: 'Compra — 2 monitores 27" para o time de TI', paymentCategory: 'COMPRA',
  amountCents: 450000, supplier: 'Dell Computadores', costCenter: 'TI-001', justification: 'Reposição de monitores da equipe de TI',
});
const compraId = c.data?.id; console.log('compra criada', c.status, compraId);
// step0 (abertura) — concluir como solicitante
for (const t of await tasksOf(compraId, 0)) await api('POST', `/api/tasks/${t.id}/complete`, solicitante.token, {});
await shot(solicitante, `/requests/${compraId}`, 'w1-compra-1-solicitante.png', 'Compra');
// step1 — aprovação do gestor (alçada MANAGER, ≤5k → sem alçada superior)
await shot(gestor, '/tasks', 'w1-compra-2-gestor-tarefas.png');
await api('POST', `/api/requests/${compraId}/approve`, gestor.token, { comments: 'Aprovado — dentro do teto e da alçada do gestor.' });
// step2 — Processamento Financeiro (financeiro recebe)
await shot(finLeader, '/tasks', 'w1-compra-3-financeiro-tarefas.png');
await shot(finLeader, `/requests/${compraId}`, 'w1-compra-4-financeiro-detalhe.png', 'Compra');

// ============ CENÁRIO 2 — PAGAMENTO (TI abre serviço de rede; roteia ao MEMBRO do Financeiro dentro do teto) ============
console.log('\n=== PAGAMENTO ===');
const p = await api('POST', '/api/requests', solicitante.token, {
  flowId: pagamento.id, title: 'Pagamento — Link de internet dedicado (provedor terceiro)', paymentCategory: 'SERVICO',
  amountCents: 400000, supplier: 'NetLink Telecom', costCenter: 'TI-002', justification: 'Mensalidade do link dedicado de rede',
});
const payId = p.data?.id; console.log('pagamento criado', p.status, payId);
// A etapa de submissão de PAGAMENTO exige anexo (contrato/nota do fornecedor).
for (const t of await tasksOf(payId, 0)) {
  console.log('  anexando contrato à tarefa de submissão →', await attach(t.id, solicitante.token, 'contrato-netlink.pdf', '%PDF-1.4 contrato de prestacao de servico de link dedicado'));
  await api('POST', `/api/tasks/${t.id}/complete`, solicitante.token, {});
}
await shot(solicitante, `/requests/${payId}`, 'w1-pag-1-solicitante.png', 'Pagamento');
// step1 alçada (4k ≤ 5k → gestor aprova, sem alçada superior)
await api('POST', `/api/requests/${payId}/approve`, gestor.token, { comments: 'Aprovado — alçada do gestor (≤ R$5.000).' });
// step2 Processamento Financeiro → decidePaymentRouting (dentro do teto → MEMBRO)
const full = (await api('GET', `/api/requests/${payId}`, admin.token)).data;
const routed = (full.auditLogs || []).find(a => a.action === 'PAYMENT_ROUTED');
console.log('PAYMENT_ROUTED =>', routed?.details);
const memberHasTask = (full.tasks || []).some(t => t.step?.order === 2 && t.assignee?.id === finMember.user.id && t.status === 'PENDING');
console.log('tarefa roteada ao MEMBRO do Financeiro?', memberHasTask);
await shot(finMember, '/tasks', 'w1-pag-2-financeiro-membro-tarefas.png');
await shot(finMember, `/requests/${payId}`, 'w1-pag-3-financeiro-membro-detalhe.png', 'Pagamento');

await browser.close();
await prisma.$disconnect();
console.log('\nOK walk1');
