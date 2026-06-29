#!/usr/bin/env node
/*
 * APROVA — Lançador local (host temporário)
 *
 * Faz TODO o trabalho automaticamente:
 *   1. cria backend/.env (com um segredo gerado) se não existir
 *   2. instala dependências (só na primeira vez)
 *   3. gera o cliente do banco + aplica as migrations
 *   4. popula dados de demonstração (só quando o banco é novo)
 *   5. compila frontend e backend (só quando necessário)
 *   6. sobe o servidor e abre o navegador em http://localhost:3001
 *
 * Uso: não precisa rodar isto direto — dê dois cliques no atalho do seu
 * sistema (start-windows.bat / start-mac.command / start-linux.sh).
 * Quem quiser pela linha de comando: `node launch.mjs`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(ROOT, 'backend');
const PORT = 3001;
const APP_URL = `http://localhost:${PORT}`;
const isWin = process.platform === 'win32';

function step(msg) { console.log(`\n→ ${msg}`); }

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: isWin });
  if (r.status !== 0) {
    console.error(`\n[ERRO] Comando falhou: ${cmd} ${args.join(' ')}`);
    console.error('Veja a mensagem acima. Se persistir, me avise com o texto do erro.');
    process.exit(1);
  }
}

// 1) backend/.env
const envPath = join(BACKEND, '.env');
if (!existsSync(envPath)) {
  step('Criando configuração (backend/.env)');
  writeFileSync(envPath, [
    'NODE_ENV=development',
    `PORT=${PORT}`,
    `JWT_SECRET=${randomBytes(32).toString('hex')}`,
    'DATABASE_URL="file:./dev.db"',
    'SERVE_FRONTEND=true',
    'CORS_ORIGIN=http://localhost:5173',
    'NOTIFICATIONS_EXTERNAL_ENABLED=false',
    '',
  ].join('\n'));
}

// 2) dependências (primeira vez)
if (!existsSync(join(ROOT, 'node_modules'))) {
  step('Instalando dependências (primeira vez — pode levar alguns minutos)');
  run('npm', ['install']);
}

// 3) cliente do banco + migrations
step('Preparando o banco de dados');
run('npm', ['run', 'db:generate', '-w', 'backend']);
const freshDb = !existsSync(join(BACKEND, 'prisma', 'dev.db'));
run('npm', ['run', 'db:deploy', '-w', 'backend']);

// 4) dados de demonstração (só quando o banco é novo)
if (freshDb) {
  step('Populando dados de demonstração (usuários e exemplos)');
  run('npm', ['run', 'db:seed', '-w', 'backend']);
}

// 5) builds (só quando necessário)
if (!existsSync(join(ROOT, 'frontend', 'dist'))) {
  step('Compilando a interface (frontend)');
  run('npm', ['run', 'build', '-w', 'frontend']);
}
if (!existsSync(join(BACKEND, 'dist'))) {
  step('Compilando o servidor (backend)');
  run('npm', ['run', 'build', '-w', 'backend']);
}

// 6) sobe o servidor
step(`Iniciando o APROVA em ${APP_URL}`);
console.log('  (deixe esta janela ABERTA enquanto usa o sistema; feche-a para encerrar)');
const server = spawn('npm', ['start', '-w', 'backend'], { cwd: ROOT, stdio: 'inherit', shell: isWin });
server.on('exit', (code) => process.exit(code ?? 0));

// 7) abre o navegador assim que o servidor responder
function openBrowser() {
  try {
    if (isWin) spawn('cmd', ['/c', 'start', '', APP_URL], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [APP_URL], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [APP_URL], { stdio: 'ignore', detached: true }).unref();
  } catch { /* abra manualmente o endereço acima */ }
}
function waitAndOpen(tries = 0) {
  http.get(APP_URL, (res) => { res.resume(); console.log(`\n✅ APROVA no ar: abra ${APP_URL} no navegador (tentaremos abrir automaticamente).`); openBrowser(); })
    .on('error', () => { if (tries < 90) setTimeout(() => waitAndOpen(tries + 1), 1000); });
}
waitAndOpen();

process.on('SIGINT', () => { try { server.kill(); } catch {} process.exit(0); });
