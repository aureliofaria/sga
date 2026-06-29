// E2E de caixa-preta contra o APROVA rodando (modo produção, processo único).
// Exercita os fluxos críticos via HTTP, como um usuário/cliente real faria.
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
async function login(email) {
  const r = await api('POST', '/api/auth/login', null, { email, password: 'senha123' });
  return r.data?.token;
}

async function main() {
  // 1) Autenticação de todos os papéis
  const admin = await login('admin@aprova.com');
  const gestor = await login('gestor@aprova.com');
  const fin = await login('financeiro@aprova.com');
  const joao = await login('joao@aprova.com');
  const rh = await login('rh@aprova.com');
  check('login admin', !!admin);
  check('login gestor', !!gestor);
  check('login financeiro', !!fin);
  check('login joao (USER)', !!joao);
  check('login rh', !!rh);
  check('login com senha errada falha', (await api('POST', '/api/auth/login', null, { email: 'admin@aprova.com', password: 'x' })).status === 401);

  // 2) Fluxos disponíveis
  const flows = (await api('GET', '/api/flows', admin)).data || [];
  const payment = flows.find(f => f.type === 'PAYMENT');
  const onboarding = flows.find(f => f.type === 'ONBOARDING');
  check('fluxo PAYMENT existe', !!payment);
  check('fluxo ONBOARDING existe', !!onboarding);

  // 3) Criar solicitação de pagamento VÁLIDA (como joao): categoria + campos obrigatórios
  const validPay = { flowId: payment.id, title: 'E2E Pagamento', paymentCategory: 'COMPRA', amountCents: 350000, supplier: 'Fornecedor E2E', costCenter: 'TI-001', justification: 'compra necessária E2E' };
  const created = await api('POST', '/api/requests', joao, validPay);
  check('cria solicitação de pagamento (201)', created.status === 201, `(status ${created.status})`);
  const reqId = created.data?.id;
  check('pagamento persiste a categoria', created.data?.paymentCategory === 'COMPRA');
  const full = (await api('GET', `/api/requests/${reqId}`, admin)).data;
  check('solicitação tem tarefa(s) criada(s)', (full?.tasks?.length || 0) > 0);

  // 4) Validação de entrada (matriz de segurança)
  check('amountCents não-numérico é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, amountCents: 'abc' })).status === 400);
  check('pagamento sem categoria é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, paymentCategory: undefined })).status === 400);
  check('categoria inválida é rejeitada (400)', (await api('POST', '/api/requests', joao, { ...validPay, paymentCategory: 'HACK' })).status === 400);
  check('valor zero é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, amountCents: 0 })).status === 400);
  check('valor negativo é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, amountCents: -500 })).status === 400);
  check('overflow acima do teto é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, amountCents: 10000000001 })).status === 400);
  check('COMPRA sem fornecedor é rejeitada (400)', (await api('POST', '/api/requests', joao, { ...validPay, supplier: '' })).status === 400);
  check('sem centro de custo é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, costCenter: '' })).status === 400);
  check('sem justificativa é rejeitado (400)', (await api('POST', '/api/requests', joao, { ...validPay, justification: '' })).status === 400);
  // Arredondamento de centavos: fracionário vira inteiro (sem float)
  const rounded = await api('POST', '/api/requests', joao, { ...validPay, amountCents: 100050.7 });
  check('arredonda centavos para inteiro (sem float)', rounded.status === 201 && rounded.data?.amountCents === 100051, `(amount ${rounded.data?.amountCents})`);

  // 5) Segregação de funções: iniciador não aprova a própria solicitação
  check('iniciador NÃO aprova a própria (403)', (await api('POST', `/api/requests/${reqId}/approve`, joao, {})).status === 403);

  // 5b) Visibilidade (modelo Fase 0): o iniciador lê o próprio pedido. FINANCE
  // NÃO tem mais visão ampla por papel — sem envolvimento (tarefa/escopo) recebe
  // 403; só ADMIN/DIRETORIA têm visão global. (Detalhes no vitest payments.test.ts.)
  check('iniciador lê o próprio pedido (200)', (await api('GET', `/api/requests/${reqId}`, joao)).status === 200);
  check('FINANCE sem envolvimento NÃO lê pedido alheio (403)', (await api('GET', `/api/requests/${reqId}`, fin)).status === 403);

  // 6) Rejeição exige motivo
  check('rejeição sem motivo é barrada (400)', (await api('POST', `/api/requests/${reqId}/reject`, gestor, {})).status === 400);

  // 6b) JWT ausente/forjado nas rotas de pagamento
  check('sem token: criar pagamento é 401', (await api('POST', '/api/requests', null, validPay)).status === 401);
  check('token forjado é rejeitado (401)', (await api('GET', '/api/payments/recurrences', 'aaa.bbb.ccc')).status === 401);

  // 6c) Recorrência: USER comum não cria (403); FINANCE cria (201); run idempotente
  check('USER não cria recorrência (403)', (await api('POST', '/api/payments/recurrences', joao, { flowId: payment.id, title: 'R', paymentCategory: 'RECORRENCIA', amountCents: 1000, costCenter: 'C', justification: 'j' })).status === 403);
  const recCreate = await api('POST', '/api/payments/recurrences', fin, { flowId: payment.id, title: 'Aluguel E2E', paymentCategory: 'RECORRENCIA', amountCents: 500000, supplier: 'Imob', costCenter: 'ADM-1', justification: 'aluguel', intervalUnit: 'MONTH', intervalCount: 1, nextRunAt: new Date(Date.now() - 86400000).toISOString() });
  check('FINANCE cria recorrência (201)', recCreate.status === 201, `(status ${recCreate.status})`);
  check('dispara geração de recorrências (200)', (await api('POST', '/api/payments/recurrences/run', fin, {})).status === 200);

  // 7) Inventário: catálogo, ativos, criação
  const items = (await api('GET', '/api/inventory/items', admin)).data || [];
  check('catálogo de inventário tem itens (seed)', items.length > 0);
  const assets = (await api('GET', '/api/inventory/assets', admin)).data || [];
  check('inventário tem ativo de exemplo', assets.length > 0);
  const newItem = await api('POST', '/api/inventory/items', admin, { code: `E2E-${Date.now()}`, name: 'Item E2E', type: 'TI', category: 'HARDWARE' });
  check('cria item de catálogo (201)', newItem.status === 201, `(status ${newItem.status})`);
  check('USER não cria item de catálogo (403)', (await api('POST', '/api/inventory/items', joao, { code: 'X', name: 'X', type: 'TI', category: 'HARDWARE' })).status === 403);

  // 8) Ciclo onboarding -> alocação física do ativo
  const resItems = (await api('GET', '/api/resources', admin)).data || [];
  const notebookRes = resItems.find(r => r.type === 'EQUIPMENT') || resItems[0];
  const onbReq = await api('POST', '/api/requests', rh, { flowId: onboarding.id, title: 'E2E Admissão', targetEmployee: 'Fulano E2E', resourceIds: notebookRes ? [notebookRes.id] : [] });
  check('cria solicitação de admissão com recurso (201)', onbReq.status === 201, `(status ${onbReq.status})`);
  const onbId = onbReq.data?.id;
  let onb = (await api('GET', `/api/requests/${onbId}`, admin)).data;
  const rr = onb?.resources?.[0];
  check('admissão tem recurso PENDING', rr?.status === 'PENDING');
  const dispAsset = (await api('GET', '/api/inventory/assets?status=DISPONIVEL', admin)).data?.[0];
  if (dispAsset && rr) {
    const link = await api('POST', `/api/requests/${onbId}/resources/${rr.id}/asset`, admin, { assetId: dispAsset.id });
    check('vincula ativo físico ao recurso (200)', link.status === 200, `(status ${link.status})`);
    check('ativo fica RESERVADO após vínculo', (await api('GET', `/api/inventory/assets/${dispAsset.id}`, admin)).data?.status === 'RESERVADO');
  } else check('havia ativo DISPONIVEL para vincular', false);

  // completa todas as etapas como ADMIN (admin pode concluir qualquer tarefa);
  // anexa um documento quando a etapa exige anexo (cenário real).
  for (let i = 0; i < 12; i++) {
    onb = (await api('GET', `/api/requests/${onbId}`, admin)).data;
    if (onb.status === 'COMPLETED') break;
    const pend = (onb.tasks || []).filter(t => t.step?.order === onb.currentStep && t.status === 'PENDING');
    if (pend.length === 0) break;
    if (pend.some(t => t.step?.requiresAttachment) && (onb.attachments || []).length === 0) {
      const fd = new FormData();
      fd.append('files', new Blob(['documento de teste'], { type: 'text/plain' }), 'doc.txt');
      await fetch(BASE + `/api/requests/${onbId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fd });
    }
    for (const t of pend) await api('POST', `/api/tasks/${t.id}/complete`, admin, {});
  }
  onb = (await api('GET', `/api/requests/${onbId}`, admin)).data;
  check('admissão chega a COMPLETED', onb.status === 'COMPLETED', `(status ${onb?.status})`);
  check('recurso vira ALLOCATED na conclusão', onb?.resources?.[0]?.status === 'ALLOCATED', `(status ${onb?.resources?.[0]?.status})`);
  if (dispAsset) check('ativo vira ATIVO na conclusão', (await api('GET', `/api/inventory/assets/${dispAsset.id}`, admin)).data?.status === 'ATIVO');
  const movs = (await api('GET', `/api/inventory/movements?requestId=${onbId}`, admin)).data || [];
  check('movimentação ALOCACAO vinculada à solicitação', movs.some(m => m.type === 'ALOCACAO' && m.requestId === onbId));

  // 9) Notificações: iniciador recebe REQUEST_COMPLETED
  const notifs = (await api('GET', '/api/notifications?status=ALL', rh)).data || [];
  check('iniciador recebe notificação de conclusão', notifs.some(n => n.type === 'REQUEST_COMPLETED'));

  // 10) Comentários
  const c = await api('POST', `/api/requests/${onbId}/comments`, admin, { body: 'Comentário E2E' });
  check('adiciona comentário (201)', c.status === 201, `(status ${c.status})`);
  check('lista comentários', ((await api('GET', `/api/requests/${onbId}/comments`, admin)).data || []).length >= 1);

  // 11) Auditoria restrita + export Excel
  check('USER não acessa auditoria global (403)', (await api('GET', '/api/audit-logs', joao)).status === 403);
  const exp = await fetch(BASE + '/api/audit-logs/export', { headers: { Authorization: `Bearer ${admin}` } });
  check('export Excel responde 200', exp.status === 200, `(status ${exp.status})`);
  check('export tem content-type de planilha', (exp.headers.get('content-type') || '').includes('spreadsheetml'));

  // 12) Relatórios / SLA
  const rep = await api('GET', '/api/reports/dashboard', admin);
  check('dashboard de SLA responde 200', rep.status === 200);
  check('dashboard traz métricas de SLA', !!rep.data?.sla);
  check('USER não acessa relatórios (403)', (await api('GET', '/api/reports/dashboard', joao)).status === 403);

  // 13) Frontend servido na mesma origem
  const root = await fetch(BASE + '/');
  const html = await root.text();
  check('frontend servido em / (200 + HTML)', root.status === 200 && html.includes('<div id="root"'));

  console.log('\n==== RESULTADO E2E ====');
  console.log(results.join('\n'));
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('ERRO FATAL no E2E:', e); process.exit(2); });
