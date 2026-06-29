// Prepara dados de demonstração da trilha de onboarding para screenshots.
// Caminha uma solicitação SUBSTITUICAO até a execução (order 70), com PII
// preenchida, e imprime JSON { reqId, users:{admin,rh,ti} } (token+user) p/ o Playwright.
const BASE = process.env.BASE || 'http://localhost:3099';
async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function loginFull(email, password = 'senha123') {
  const r = await api('POST', '/api/auth/login', null, { email, password });
  return r.data; // { token, user }
}
async function ensure(admin, name, email, role, sectorId) {
  let lf = await loginFull(email);
  if (!lf?.token) {
    await api('POST', '/api/users', admin, { name, email, password: 'senha123', role });
    lf = await loginFull(email);
  }
  if (sectorId && lf?.user?.id) {
    await api('POST', `/api/sectors/${sectorId}/members`, admin, { userId: lf.user.id, level: 'MEMBRO' });
  }
  return lf;
}
async function completeStep(reqId, full, tokensByRole, fieldVals) {
  const cur = full.currentStep;
  const tasks = (full.tasks || []).filter((t) => t.step?.order === cur && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));
  for (const t of tasks) {
    const tok = tokensByRole[t.step?.requiredRole] || tokensByRole.ADMIN;
    await api('POST', `/api/tasks/${t.id}/claim`, tok, {});
    const stepInfo = (full.flow?.steps || []).find((s) => s.id === t.stepId);
    for (const ci of stepInfo?.checklistItems || []) {
      if (ci.applicable && !ci.checked) await api('POST', `/api/requests/${reqId}/checklist/${ci.id}`, tok, { checked: true });
    }
    await api('POST', `/api/tasks/${t.id}/complete`, tok, {});
  }
}
async function main() {
  const admin = await loginFull('admin@aprova.com');
  const sectors = (await api('GET', '/api/sectors', admin.token)).data || [];
  const sid = (n) => sectors.find((s) => s.name === n)?.id;
  const rh = await ensure(admin.token, 'RH Demo', 'rh.demo@aprova.com', 'RH', sid('RH'));
  const ti = await ensure(admin.token, 'TI Demo', 'ti.demo@aprova.com', 'TI', sid('TI, Dados e Infra'));
  const adm = await ensure(admin.token, 'ADM Demo', 'adm.demo@aprova.com', 'ADMINISTRATIVO', sid('Administrativo'));
  const sis = await ensure(admin.token, 'SIS Demo', 'sis.demo@aprova.com', 'SISTEMAS', sid('TI, Dados e Infra'));
  const dados = await ensure(admin.token, 'DADOS Demo', 'dados.demo@aprova.com', 'DADOS', sid('TI, Dados e Infra'));
  const ini = await ensure(admin.token, 'Solicitante Demo', 'ini.demo@aprova.com', 'USER', null);
  const tokensByRole = { RH: rh.token, TI: ti.token, ADMINISTRATIVO: adm.token, SISTEMAS: sis.token, DADOS: dados.token, ADMIN: admin.token };

  const flows = (await api('GET', '/api/flows', admin.token)).data || [];
  const trail = (await api('GET', `/api/flows/${flows.find((f) => f.name === 'Trilha de Admissão/Onboarding').id}`, admin.token)).data;
  const fid = {}; for (const st of trail.steps || []) for (const f of st.formFields || []) fid[f.key] = f.id;

  const created = await api('POST', '/api/requests', ini.token, { flowId: trail.id, title: 'Admissão — Analista Comercial (DEMO)', vacancyType: 'SUBSTITUICAO', replacementName: 'João Anterior' });
  const reqId = created.data.id;
  await api('POST', `/api/requests/${reqId}/fields`, ini.token, { stepOrder: 0, values: [
    { fieldId: fid.vacancy_sector, value: 'Comercial Interno' }, { fieldId: fid.vacancy_leader, value: 'Carla Líder' },
    { fieldId: fid.headcount_justification, value: 'Reposição de quadro' },
    { fieldId: fid.needs_notebook, value: 'sim' }, { fieldId: fid.needs_phone, value: 'sim' },
    { fieldId: fid.needs_powerbi, value: 'sim' }, { fieldId: fid.needs_erp, value: 'sim' }, { fieldId: fid.needs_badge, value: 'sim' },
  ]});
  let full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data;
  for (const t of (full.tasks || []).filter((t) => t.step?.order === 0)) await api('POST', `/api/tasks/${t.id}/complete`, ini.token, {});
  // 20 (RH prazo) -> 30 -> 40 (TI+ADM) -> 50 -> 60 (PII)
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data;
  await api('POST', `/api/requests/${reqId}/fields`, rh.token, { stepOrder: 20, values: [{ fieldId: fid.expected_start_date, value: '2026-08-01' }, { fieldId: fid.rh_observation, value: 'OK' }] });
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; await completeStep(reqId, full, tokensByRole, fid);
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; await completeStep(reqId, full, tokensByRole, fid); // 30
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; await completeStep(reqId, full, tokensByRole, fid); // 40 TI+ADM
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; await completeStep(reqId, full, tokensByRole, fid); // 50
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; // agora order 60 (PII)
  await api('POST', `/api/requests/${reqId}/fields`, rh.token, { stepOrder: 60, values: [
    { fieldId: fid.employee_name, value: 'Maria Substituta Silva' }, { fieldId: fid.employee_cpf, value: '529.982.247-25' },
    { fieldId: fid.employee_rg, value: '12.345.678-9' }, { fieldId: fid.employee_email_personal, value: 'maria.silva@gmail.com' },
    { fieldId: fid.employee_start_date, value: '2026-08-01' }, { fieldId: fid.employee_phone, value: '(11) 98888-7777' },
  ]});
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data; await completeStep(reqId, full, tokensByRole, fid); // conclui 60 -> 70 (execução)
  full = (await api('GET', `/api/requests/${reqId}`, admin.token)).data;

  const out = { reqId, currentStep: full.currentStep, statusLabel: full.statusLabel,
    users: { admin: { token: admin.token, user: admin.user }, rh: { token: rh.token, user: rh.user }, ti: { token: ti.token, user: ti.user } } };
  console.log(JSON.stringify(out));
}
main().catch((e) => { console.error('DEMO-DATA ERRO:', e); process.exit(1); });
