// E2E da Trilha de Admissão/Onboarding (Fase 1) — caixa-preta via HTTP contra o
// APROVA rodando (modo desenvolvimento, demo seed). Percorre o caminho feliz
// SUBSTITUICAO de ponta a ponta e prova o branch NOVA→Diretoria.
//
// Não edita e2e.mjs. Imprime "X passaram, Y falharam" no padrão do e2e atual.
const BASE = process.env.BASE || 'http://localhost:3099';
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name} ${detail}`); }
}
async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  return { status: res.status, data, ct };
}
async function login(email, password = 'senha123') {
  const r = await api('POST', '/api/auth/login', null, { email, password });
  return r.data?.token;
}

// Cria (idempotente) um usuário com papel e o vincula como MEMBRO do setor dado.
async function ensureUser(admin, name, email, role, sectorId) {
  let token = await login(email);
  let userId;
  if (!token) {
    const created = await api('POST', '/api/users', admin, { name, email, password: 'senha123', role });
    userId = created.data?.id;
    token = await login(email);
  } else {
    const me = await api('GET', '/api/users', admin);
    userId = (me.data || []).find((u) => u.email === email)?.id;
  }
  if (sectorId && userId) {
    // Vincula como MEMBRO (idempotente: a rota faz upsert por (sectorId,userId)).
    await api('POST', `/api/sectors/${sectorId}/members`, admin, { userId, level: 'MEMBRO' });
  }
  return { token, userId };
}

// Conclui (claim + checklist aplicável + complete) TODAS as tarefas PENDING/IN_PROGRESS
// da etapa atual, distribuindo cada tarefa ao token correto por requiredRole.
// Retorna a quantidade de tarefas concluídas.
async function workCurrentStep(reqId, full, tokensByRole, fieldVals) {
  const cur = full.currentStep;
  const tasks = (full.tasks || []).filter((t) => t.step?.order === cur && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));
  let done = 0;
  for (const t of tasks) {
    const role = t.step?.requiredRole;
    const tok = tokensByRole[role] || tokensByRole.ADMIN;
    // Assume a fila (claim) — função; ignora 409 se já assumida.
    await api('POST', `/api/tasks/${t.id}/claim`, tok, {});
    // Marca os itens de checklist APLICÁVEIS desta etapa (via GET enriquecido).
    const stepInfo = (full.flow?.steps || []).find((s) => s.id === t.stepId);
    for (const ci of stepInfo?.checklistItems || []) {
      if (ci.applicable && !ci.checked) {
        await api('POST', `/api/requests/${reqId}/checklist/${ci.id}`, tok, { checked: true });
      }
    }
    const c = await api('POST', `/api/tasks/${t.id}/complete`, tok, {});
    if (c.status === 200) done++;
  }
  return done;
}

async function main() {
  const admin = await login('admin@aprova.com');
  check('login admin', !!admin);

  // Resolve setores por nome.
  const sectors = (await api('GET', '/api/sectors', admin)).data || [];
  const sid = (name) => sectors.find((s) => s.name === name)?.id;
  const sRH = sid('RH'); const sTI = sid('TI, Dados e Infra'); const sADM = sid('Administrativo'); const sDIR = sid('Diretoria');
  check('setores RH/TI/Administrativo/Diretoria existem', !!sRH && !!sTI && !!sADM && !!sDIR, `(rh=${sRH} ti=${sTI} adm=${sADM} dir=${sDIR})`);

  // Usuários de função (idempotentes), cada um membro do setor da sua função.
  const stamp = 'onb';
  const rh = await ensureUser(admin, 'RH Onboarding', `rh.${stamp}@aprova.com`, 'RH', sRH);
  const ti = await ensureUser(admin, 'TI Onboarding', `ti.${stamp}@aprova.com`, 'TI', sTI);
  const sistemas = await ensureUser(admin, 'Sistemas Onboarding', `sis.${stamp}@aprova.com`, 'SISTEMAS', sTI);
  const dados = await ensureUser(admin, 'Dados Onboarding', `dados.${stamp}@aprova.com`, 'DADOS', sTI);
  const adm = await ensureUser(admin, 'Adm Onboarding', `adm.${stamp}@aprova.com`, 'ADMINISTRATIVO', sADM);
  const dir = await ensureUser(admin, 'Diretoria Onboarding', `dir.${stamp}@aprova.com`, 'DIRETORIA', sDIR);
  // Iniciador SEM função em nenhum setor da trilha (evita SoD/edge cases).
  const ini = await ensureUser(admin, 'Iniciador Onboarding', `ini.${stamp}@aprova.com`, 'USER', null);
  check('usuários de função criados/logados', !!rh.token && !!ti.token && !!sistemas.token && !!dados.token && !!adm.token && !!dir.token && !!ini.token);

  // ADMIN conclui qualquer tarefa; usamos os tokens de função para realismo e o
  // ADMIN como fallback. A etapa 0 (self-submission) é do INICIADOR.
  const tokensByRole = { RH: rh.token, TI: ti.token, SISTEMAS: sistemas.token, DADOS: dados.token, ADMINISTRATIVO: adm.token, DIRETORIA: dir.token, ADMIN: admin };

  // Descobre a trilha nova (por nome).
  const flows = (await api('GET', '/api/flows', admin)).data || [];
  const trailMeta = flows.find((f) => f.name === 'Trilha de Admissão/Onboarding');
  check('trilha "Trilha de Admissão/Onboarding" existe', !!trailMeta, `(flows=${flows.map((f) => f.name).join('|')})`);
  if (!trailMeta) return finish();
  // Carrega o fluxo COM formFields/checklistItems para mapear fieldIds por key.
  const trail = (await api('GET', `/api/flows/${trailMeta.id}`, admin)).data;
  const fieldIdByKey = {};
  for (const st of trail.steps || []) for (const f of st.formFields || []) fieldIdByKey[f.key] = f.id;
  check('trilha expõe formFields (vacancy_sector, employee_cpf)', !!fieldIdByKey.vacancy_sector && !!fieldIdByKey.employee_cpf);

  // -----------------------------------------------------------------------
  // CAMINHO FELIZ — SUBSTITUICAO (pula a Diretoria, vai direto ao RH).
  // -----------------------------------------------------------------------
  const created = await api('POST', '/api/requests', ini.token, {
    flowId: trail.id, title: 'E2E Onboarding SUBSTITUICAO', vacancyType: 'SUBSTITUICAO',
  });
  check('cria solicitação SUBSTITUICAO (201)', created.status === 201, `(status ${created.status})`);
  const reqId = created.data?.id;

  // order 0 — Abertura de Vaga: preenche campos e conclui (self-submission do iniciador).
  await api('POST', `/api/requests/${reqId}/fields`, ini.token, {
    stepOrder: 0,
    values: [
      { fieldId: fieldIdByKey.vacancy_sector, value: 'TI, Dados e Infra' },
      { fieldId: fieldIdByKey.vacancy_leader, value: 'Fulano Líder' },
      { fieldId: fieldIdByKey.needs_notebook, value: 'sim' },
      { fieldId: fieldIdByKey.needs_desktop, value: 'nao' },
      { fieldId: fieldIdByKey.needs_phone, value: 'sim' },
      { fieldId: fieldIdByKey.needs_powerbi, value: 'nao' }, // QUIRK: tarefa de Dados fecha sem ação obrigatória
      { fieldId: fieldIdByKey.needs_erp, value: 'sim' },
      { fieldId: fieldIdByKey.needs_badge, value: 'sim' },
    ],
  });
  let full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  // A etapa 0 tem requiredRole null (self-submission) → a tarefa é do INICIADOR.
  for (const t of (full.tasks || []).filter((t) => t.step?.order === 0 && t.status !== 'COMPLETED' && t.status !== 'CANCELLED')) {
    await api('POST', `/api/tasks/${t.id}/complete`, ini.token, {});
  }
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('SUBSTITUICAO pula a Diretoria → vai ao RH (order 20)', full.currentStep === 20, `(currentStep ${full.currentStep})`);

  // order 20 — RH avalia e define prazo (campos: expected_start_date req).
  await api('POST', `/api/requests/${reqId}/fields`, rh.token, {
    stepOrder: 20,
    values: [
      { fieldId: fieldIdByKey.expected_start_date, value: '2026-08-01' },
      { fieldId: fieldIdByKey.rh_observation, value: 'OK' },
    ],
  });
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('RH(20) conclui → order 30', full.currentStep === 30, `(currentStep ${full.currentStep})`);

  // order 30 — RH confirma e dispara provisionamento.
  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('RH(30) conclui → order 40 (paralelo TI+ADM)', full.currentStep === 40, `(currentStep ${full.currentStep})`);

  // order 40 — PARALELO: TI + Administrativo. NÃO deve avançar com só um concluído.
  const par40 = (full.tasks || []).filter((t) => t.step?.order === 40 && t.status !== 'CANCELLED');
  check('order 40 tem 2 tarefas paralelas (TI + ADM)', par40.length === 2, `(qtd ${par40.length})`);
  // Conclui apenas a tarefa de Administrativo primeiro.
  const admTask = par40.find((t) => t.step?.requiredRole === 'ADMINISTRATIVO');
  if (admTask) {
    await api('POST', `/api/tasks/${admTask.id}/claim`, adm.token, {});
    const stepInfo = (full.flow?.steps || []).find((s) => s.id === admTask.stepId);
    for (const ci of stepInfo?.checklistItems || []) if (ci.applicable && !ci.checked) await api('POST', `/api/requests/${reqId}/checklist/${ci.id}`, adm.token, { checked: true });
    await api('POST', `/api/tasks/${admTask.id}/complete`, adm.token, {});
  }
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('order 40 NÃO avança só com Administrativo concluído', full.currentStep === 40, `(currentStep ${full.currentStep})`);
  // Conclui a tarefa de TI → agora avança.
  const tiTask = par40.find((t) => t.step?.requiredRole === 'TI');
  if (tiTask) {
    await api('POST', `/api/tasks/${tiTask.id}/claim`, ti.token, {});
    const stepInfo = (full.flow?.steps || []).find((s) => s.id === tiTask.stepId);
    for (const ci of stepInfo?.checklistItems || []) if (ci.applicable && !ci.checked) await api('POST', `/api/requests/${reqId}/checklist/${ci.id}`, ti.token, { checked: true });
    await api('POST', `/api/tasks/${tiTask.id}/complete`, ti.token, {});
  }
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('order 40 avança quando AMBOS (TI+ADM) concluem → order 50', full.currentStep === 50, `(currentStep ${full.currentStep})`);

  // order 50 — RH seleção em andamento.
  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('RH(50) conclui → order 60 (PII)', full.currentStep === 60, `(currentStep ${full.currentStep})`);

  // order 60 — RH coleta PII (CPF/RG/e-mail pessoal/telefone).
  const cpf = '529.982.247-25';
  await api('POST', `/api/requests/${reqId}/fields`, rh.token, {
    stepOrder: 60,
    values: [
      { fieldId: fieldIdByKey.employee_name, value: 'Maria Substituta' },
      { fieldId: fieldIdByKey.employee_cpf, value: cpf },
      { fieldId: fieldIdByKey.employee_rg, value: '12.345.678-9' },
      { fieldId: fieldIdByKey.employee_email_personal, value: 'maria@pessoal.com' },
      { fieldId: fieldIdByKey.employee_start_date, value: '2026-08-01' },
      { fieldId: fieldIdByKey.employee_phone, value: '(11) 98888-7777' },
    ],
  });
  // AuditLog SENSITIVE_FIELD_WRITTEN deve ter sido registrado para os campos sensíveis.
  const auditResp = await api('GET', `/api/requests/${reqId}/audit`, admin);
  const auditAfterPii = Array.isArray(auditResp.data) ? auditResp.data : [];
  check('AuditLog SENSITIVE_FIELD_WRITTEN registrado na escrita de PII', auditAfterPii.some((a) => a.action === 'SENSITIVE_FIELD_WRITTEN'), `(audit status ${auditResp.status})`);

  // Viewer TI vê o CPF MASCARADO no GET /:id; RH vê intacto.
  const seenByTi = (await api('GET', `/api/requests/${reqId}`, ti.token)).data;
  const tiCpf = (seenByTi?.fieldValues || []).find((v) => v.field?.key === 'employee_cpf')?.value;
  check('viewer TI vê CPF MASCARADO', tiCpf === '***.***.***-**', `(viu "${tiCpf}")`);
  const seenByRh = (await api('GET', `/api/requests/${reqId}`, rh.token)).data;
  const rhCpf = (seenByRh?.fieldValues || []).find((v) => v.field?.key === 'employee_cpf')?.value;
  check('viewer RH vê CPF INTACTO', rhCpf === cpf, `(viu "${rhCpf}")`);

  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('RH(60) conclui → order 70 (execução 4 paralelas)', full.currentStep === 70, `(currentStep ${full.currentStep})`);

  // order 70 — PARALELO: TI + Sistemas + Administrativo + Dados.
  const par70 = (full.tasks || []).filter((t) => t.step?.order === 70 && t.status !== 'CANCELLED');
  check('order 70 tem 4 tarefas paralelas', par70.length === 4, `(qtd ${par70.length})`);
  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('order 70 avança quando as 4 concluem → order 80', full.currentStep === 80, `(currentStep ${full.currentStep})`);

  // order 80 — RH confirma → COMPLETED.
  await workCurrentStep(reqId, full, tokensByRole, fieldIdByKey);
  full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('SUBSTITUICAO chega a COMPLETED', full.status === 'COMPLETED', `(status ${full.status})`);

  // -----------------------------------------------------------------------
  // CASO CURTO — NOVA vaga roteia pela DIRETORIA (order 10) antes do RH.
  // -----------------------------------------------------------------------
  const nova = await api('POST', '/api/requests', ini.token, {
    flowId: trail.id, title: 'E2E Onboarding NOVA', vacancyType: 'NOVA',
  });
  check('cria solicitação NOVA (201)', nova.status === 201, `(status ${nova.status})`);
  const novaId = nova.data?.id;
  await api('POST', `/api/requests/${novaId}/fields`, ini.token, {
    stepOrder: 0,
    values: [
      { fieldId: fieldIdByKey.vacancy_sector, value: 'TI, Dados e Infra' },
      { fieldId: fieldIdByKey.vacancy_leader, value: 'Fulano Líder' },
    ],
  });
  let novaFull = (await api('GET', `/api/requests/${novaId}`, admin)).data;
  for (const t of (novaFull.tasks || []).filter((t) => t.step?.order === 0 && t.status !== 'COMPLETED' && t.status !== 'CANCELLED')) {
    await api('POST', `/api/tasks/${t.id}/complete`, ini.token, {});
  }
  novaFull = (await api('GET', `/api/requests/${novaId}`, admin)).data;
  check('NOVA vaga roteia pela Diretoria (order 10)', novaFull.currentStep === 10, `(currentStep ${novaFull.currentStep})`);

  finish();
}

function finish() {
  console.log('\n==== RESULTADO E2E ONBOARDING ====');
  console.log(results.join('\n'));
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERRO FATAL no E2E ONBOARDING:', e);
  console.log('\n==== RESULTADO PARCIAL (até o erro) ====');
  console.log(results.join('\n'));
  console.log(`\n${pass} passaram, ${fail} falharam (interrompido)`);
  process.exit(2);
});
