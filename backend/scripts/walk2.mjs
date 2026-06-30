// Homologação ponta a ponta (UI via Playwright): TRILHA DE ONBOARDING (13 etapas,
// incluindo fan-outs paralelos em TI∥Admin e TI∥Sistemas∥Admin∥Dados).
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
  console.log('  shot', file);
}

const admin = await login('admin@aprova.com');
// Valores de formulário por chave (preenchidos sob demanda quando a etapa exige).
const FIELD_VALUES = {
  vacancy_sector: 'TI, Dados e Infra', vacancy_leader: 'Maria Gestora',
  headcount_justification: 'Expansão do time de TI para projeto de dados.',
  needs_notebook: 'sim', needs_desktop: 'nao', needs_phone: 'sim', needs_powerbi: 'sim', needs_erp: 'sim', needs_badge: 'sim',
  expected_start_date: '2026-07-15', rh_observation: 'Vaga aprovada. Início previsto 15/07.',
  employee_name: 'Bruno Almeida', employee_cpf: '111.444.777-35', employee_rg: '12.345.678-9',
  employee_email_personal: 'bruno.almeida@email.com', employee_start_date: '2026-07-15', employee_phone: '(11) 98888-7777',
};
const fieldDefsCache = {};
async function fieldDefs(stepId) {
  if (!fieldDefsCache[stepId]) fieldDefsCache[stepId] = await prisma.formField.findMany({ where: { flowStepId: stepId }, select: { id: true, key: true, required: true } });
  return fieldDefsCache[stepId];
}
async function attach(taskId, token) {
  const fd = new FormData();
  fd.append('files', new Blob(['%PDF-1.4 documento de onboarding'], { type: 'application/pdf' }), 'documento.pdf');
  const r = await fetch(`${BASE}/api/tasks/${taskId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  return r.status;
}

// Conclui UMA tarefa de função, preenchendo campos/checklist/anexo sob demanda.
async function completeTask(task, token, reqId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await api('POST', `/api/tasks/${task.id}/complete`, token, {});
    if (r.status === 200) return true;
    const err = r.data || {};
    if (/anexo/i.test(err.error || '')) { await attach(task.id, token); continue; }
    if (Array.isArray(err.missing) && err.missing.length) {
      const defs = await fieldDefs(task.stepId);
      const values = [];
      for (const m of err.missing) {
        const key = typeof m === 'string' ? m : m.key;
        const def = defs.find((d) => d.key === key);
        if (def) values.push({ fieldId: def.id, value: FIELD_VALUES[key] ?? 'N/A' });
      }
      // stepOrder do task
      const so = task.step?.order ?? 0;
      await api('POST', `/api/requests/${reqId}/fields`, token, { stepOrder: so, values });
      continue;
    }
    if (Array.isArray(err.pending) && err.pending.length) {
      // `pending` vem como RÓTULOS — resolve para o id do ChecklistItem da etapa.
      const items = await prisma.checklistItem.findMany({ where: { flowStepId: task.stepId }, select: { id: true, label: true } });
      for (const it of err.pending) {
        const label = typeof it === 'string' ? it : (it.label || '');
        const match = items.find((x) => x.label === label) || (typeof it !== 'string' && items.find((x) => x.id === (it.id || it.itemId)));
        if (match) {
          const tr = await api('POST', `/api/requests/${reqId}/checklist/${match.id}`, token, { checked: true });
          if (tr.status !== 200) console.log('    checklist toggle falhou', label, tr.status, JSON.stringify(tr.data));
        } else console.log('    checklist sem match p/ rótulo:', label);
      }
      continue;
    }
    console.log('    !! falha ao concluir tarefa', task.step?.order, JSON.stringify(err));
    return false;
  }
  return false;
}

async function full(reqId) { return (await api('GET', `/api/requests/${reqId}`, admin.token)).data; }
function openTasksAt(f, order) { return (f.tasks || []).filter((t) => t.step?.order === order && ['PENDING', 'IN_PROGRESS'].includes(t.status)); }

// ============ SETUP usuários de função ============
console.log('=== setup usuários de função ===');
const solicitante = await login('gestor@aprova.com'); // gestor abre a vaga (solicitante)
const diretor = await ensureUser(admin, 'Diretor Geral', 'diretor@aprova.com', 'DIRETORIA', 'Diretoria', 'LIDER_1');
const rhf = await ensureUser(admin, 'Renata (RH)', 'rhf@aprova.com', 'RH', 'RH', 'LIDER_1');
const ti = await ensureUser(admin, 'Tiago (TI)', 'ti@aprova.com', 'TI', 'TI, Dados e Infra', 'MEMBRO');
const adm = await ensureUser(admin, 'Alice (Administrativo)', 'adm@aprova.com', 'ADMINISTRATIVO', 'Administrativo', 'MEMBRO');
const sis = await ensureUser(admin, 'Sandro (Sistemas)', 'sis@aprova.com', 'SISTEMAS', 'TI, Dados e Infra', 'MEMBRO');
const dados = await ensureUser(admin, 'Daniela (Dados)', 'dados@aprova.com', 'DADOS', 'TI, Dados e Infra', 'MEMBRO');
const byRole = { DIRETORIA: diretor, RH: rhf, TI: ti, ADMINISTRATIVO: adm, SISTEMAS: sis, DADOS: dados };

const trilha = await prisma.flowTemplate.findFirst({ where: { name: { contains: 'Trilha' } } });

// ============ 1) SOLICITANTE abre a vaga (nova vaga → exige Diretoria) ============
console.log('\n=== 1) Solicitante abre vaga NOVA ===');
const c = await api('POST', '/api/requests', solicitante.token, {
  flowId: trilha.id, title: 'Nova vaga — Analista de Dados (TI)', vacancyType: 'NOVA', targetEmployee: 'A definir',
});
const reqId = c.data?.id; console.log('criada', c.status, reqId);
// Pré-preenche TODOS os campos da etapa 0 (inclusive needs_* opcionais) para que
// os checklists das etapas paralelas (TI/Sistemas/Dados/Admin) fiquem aplicáveis.
let f = await full(reqId);
{
  const step0 = (f.flow?.steps || []).find((s) => s.order === 0);
  const step0Task = openTasksAt(f, 0)[0];
  const defs = await fieldDefs(step0Task.stepId);
  const values = defs.filter((d) => FIELD_VALUES[d.key] != null).map((d) => ({ fieldId: d.id, value: FIELD_VALUES[d.key] }));
  await api('POST', `/api/requests/${reqId}/fields`, solicitante.token, { stepOrder: 0, values });
  console.log('  campos da abertura preenchidos:', values.length);
}
for (const t of openTasksAt(f, 0)) await completeTask(t, solicitante.token, reqId);
f = await full(reqId);
console.log('  → currentStep', f.currentStep, '(esperado 10: Diretoria)');
await shot(solicitante, `/requests/${reqId}`, 'w2-1-solicitante-abertura.png', 'Nova vaga');

// ============ Loop pela trilha, capturando os papéis pedidos ============
const ORDER_FLOW = [10, 20, 30, 40, 50, 60, 70, 80];
const SHOTS = {
  10: [{ actor: () => diretor, file: 'w2-2-diretor', label: 'Diretoria recebe nova vaga' }],
  20: [{ actor: () => rhf, file: 'w2-3-rh-avaliacao', label: 'RH — avaliação e prazo' }],
  40: [{ actor: () => ti, file: 'w2-4-ti-avaliacao', label: 'TI — avaliação de equipamentos' },
       { actor: () => adm, file: 'w2-5-administrativo', label: 'Administrativo — infraestrutura' }],
  60: [{ actor: () => rhf, file: 'w2-6-rh-pii', label: 'RH — dados do candidato' }],
  70: [{ actor: () => ti, file: 'w2-7-ti-config', label: 'TI — configurar equipamentos' },
       { actor: () => sis, file: 'w2-7b-sistemas', label: 'Sistemas — acessos' }],
};

for (const order of ORDER_FLOW) {
  f = await full(reqId);
  if (f.currentStep !== order) { console.log(`  (pulou etapa ${order}; currentStep=${f.currentStep})`); continue; }
  const tasks = openTasksAt(f, order);
  console.log(`\n=== etapa ${order} — ${tasks.length} tarefa(s) — ${[...new Set(tasks.map(t=>t.step?.name))].join(' ∥ ')} ===`);
  // screenshots dos papéis que RECEBEM esta etapa (antes de concluir)
  for (const s of (SHOTS[order] || [])) {
    const a = s.actor();
    await shot(a, '/tasks', `${s.file}-tarefas.png`);
    await shot(a, `/requests/${reqId}`, `${s.file}-detalhe.png`, 'vaga');
  }
  // conclui TODAS as tarefas da etapa (cobre etapas paralelas: cada papel conclui a sua)
  for (const t of tasks) {
    const role = t.requiredRole || t.step?.requiredRole;
    const actor = byRole[role] || admin;
    const ok = await completeTask(t, actor.token, reqId);
    console.log(`  ${role}: tarefa "${t.step?.name}" → ${ok ? 'concluída' : 'FALHOU'}`);
  }
}

f = await full(reqId);
console.log('\n=== estado final ===', 'status', f.status, 'currentStep', f.currentStep);
// 8) Solicitante vê a vaga concluída
await shot(solicitante, `/requests/${reqId}`, 'w2-8-solicitante-concluido.png', 'Nova vaga');

await browser.close();
await prisma.$disconnect();
console.log('\nOK walk2');
