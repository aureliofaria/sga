// Dispatcher de notificações externas (Prioridade: e-mail/Teams).
//
// As notificações externas são criadas como PENDING dentro da transação do
// evento (services/notifications.ts). Este dispatcher roda FORA da transação
// (intervalo in-process) e faz o envio real:
//   • OUTLOOK → e-mail via SMTP corporativo (nodemailer).
//   • TEAMS   → Incoming Webhook do canal.
// Sucesso → status SENT (+ sentAt). Erro de envio → mantém PENDING e grava o
// `error` (re-tenta no próximo ciclo). E-mail ausente → FAILED (erro permanente).
import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';
import { config, emailEnabled, teamsEnabled, graphConfigured } from '../config';

// --- Microsoft Graph (client credentials) — envio de e-mail padrão M365 -------
let _graphToken: { value: string; exp: number } = { value: '', exp: 0 };
async function graphToken(): Promise<string> {
  if (_graphToken.value && Date.now() < _graphToken.exp - 60000) return _graphToken.value;
  const url = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`Graph token HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in?: number };
  _graphToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _graphToken.value;
}
async function sendViaGraph(to: string, subject: string, html: string): Promise<void> {
  const token = await graphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.graph.sender)}/sendMail`;
  const payload = {
    message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
    saveToSentItems: false,
  };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Graph sendMail HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

let _transporter: nodemailer.Transporter | null = null;
function transporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return _transporter;
}

function linkFor(requestId?: string | null): string {
  if (!config.appUrl || !requestId) return '';
  return `${config.appUrl.replace(/\/$/, '')}/requests/${requestId}`;
}

function emailHtml(title: string, body: string | null, link: string): string {
  return `<div style="font-family:Nunito,Arial,sans-serif;color:#13294B">
    <div style="background:#13294B;color:#fff;padding:16px 20px;font-weight:700">APROVA · Gol Plus</div>
    <div style="padding:20px">
      <h2 style="margin:0 0 8px;font-size:18px;color:#13294B">${escapeHtml(title)}</h2>
      ${body ? `<p style="margin:0 0 16px;color:#334">${escapeHtml(body)}</p>` : ''}
      ${link ? `<a href="${link}" style="display:inline-block;background:#ff6413;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Abrir solicitação</a>` : ''}
    </div>
    <div style="padding:12px 20px;color:#889;font-size:12px">Mensagem automática do APROVA. Não responda este e-mail.</div>
  </div>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export interface DispatchDeps {
  sendEmail?: (to: string, subject: string, text: string, html: string) => Promise<void>;
  sendTeams?: (text: string) => Promise<void>;
  emailOn?: () => boolean;
  teamsOn?: () => boolean;
  limit?: number;
}

async function defaultSendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  // Graph é preferido quando configurado (padrão M365, sem SMTP AUTH); senão SMTP.
  if (graphConfigured()) {
    await sendViaGraph(to, subject, html);
    return;
  }
  await transporter().sendMail({ from: config.smtp.from, to, subject, text, html });
}
async function defaultSendTeams(text: string): Promise<void> {
  const r = await fetch(config.teamsWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(`Teams webhook HTTP ${r.status}`);
}

export async function dispatchPendingNotifications(deps: DispatchDeps = {}): Promise<{ sent: number; failed: number }> {
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const sendTeams = deps.sendTeams ?? defaultSendTeams;
  const emailOn = deps.emailOn ?? emailEnabled;
  const teamsOn = deps.teamsOn ?? teamsEnabled;

  const pending = await prisma.notification.findMany({
    where: { status: 'PENDING', channel: { in: ['OUTLOOK', 'TEAMS'] } },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
    take: deps.limit ?? 50,
  });

  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      if (n.channel === 'OUTLOOK') {
        if (!emailOn()) continue; // transporte desligado: deixa PENDING
        if (!n.user?.email) {
          await prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', error: 'usuário sem e-mail' } });
          failed++;
          continue;
        }
        const link = linkFor(n.requestId);
        const text = `${n.body ?? n.title}${link ? `\n\nAbrir: ${link}` : ''}`;
        await sendEmail(n.user.email, `[APROVA] ${n.title}`, text, emailHtml(n.title, n.body, link));
      } else {
        if (!teamsOn()) continue;
        const link = linkFor(n.requestId);
        await sendTeams(`**${n.title}**\n${n.body ?? ''}${link ? `\n[Abrir solicitação](${link})` : ''}`);
      }
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
      sent++;
    } catch (e: unknown) {
      // Erro de envio (provável transitório): mantém PENDING e registra o motivo.
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.notification.update({ where: { id: n.id }, data: { error: msg.slice(0, 300) } });
      failed++;
    }
  }
  return { sent, failed };
}

// Agendador in-process (gated por env). Só liga quando os externos estão
// habilitados e há ao menos um transporte configurado.
export function startNotificationsDispatcher(): void {
  if (!config.externalNotificationsEnabled || (!emailEnabled() && !teamsEnabled())) {
    console.log('[notify-dispatch] DESLIGADO (defina NOTIFICATIONS_EXTERNAL_ENABLED=true + SMTP/Teams).');
    return;
  }
  const intervalMs = Number(process.env.NOTIFICATIONS_DISPATCH_INTERVAL_MS) || 60000;
  console.log(`[notify-dispatch] LIGADO (intervalo ${intervalMs} ms; e-mail=${emailEnabled()} teams=${teamsEnabled()}).`);
  setInterval(() => {
    dispatchPendingNotifications().catch((e) => console.error('[notify-dispatch]', e));
  }, intervalMs);
}
