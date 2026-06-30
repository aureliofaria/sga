import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// Segredo JWT: fonte única para assinatura e verificação.
// Em produção é obrigatório vir do ambiente; em desenvolvimento há um
// fallback explícito apenas para facilitar o setup local.
const DEV_JWT_FALLBACK = 'aprova-dev-only-secret-change-me';

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (isProduction) {
    throw new Error(
      'JWT_SECRET é obrigatório em produção. Defina a variável de ambiente antes de iniciar a aplicação.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn('[config] JWT_SECRET não definido — usando fallback de desenvolvimento. NÃO use em produção.');
  return DEV_JWT_FALLBACK;
}

// Origens permitidas para CORS. Aceita lista separada por vírgula em CORS_ORIGIN.
function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (raw && raw.trim().length > 0) {
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }
  return ['http://localhost:5173'];
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3001,
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: '7d' as const,
  corsOrigins: resolveCorsOrigins(),
  // Canais externos (Teams/Outlook). Materializados como PENDING quando
  // habilitados; um dispatcher envia de fato (e-mail via SMTP / Teams via webhook).
  externalNotificationsEnabled: process.env.NOTIFICATIONS_EXTERNAL_ENABLED === 'true',
  // E-mail (canal OUTLOOK) — SMTP corporativo (ex.: Office 365: smtp.office365.com:587).
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true p/ 465; false p/ 587 (STARTTLS)
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'APROVA <no-reply@golplus.com.br>',
  },
  // E-mail via Microsoft Graph (alternativa ao SMTP; padrão M365). App Registration
  // com permissão de aplicação Mail.Send + consent de admin. Preferido quando
  // configurado — não depende de SMTP AUTH habilitado no tenant.
  graph: {
    tenantId: process.env.GRAPH_TENANT_ID || '',
    clientId: process.env.GRAPH_CLIENT_ID || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    // Caixa remetente (UPN/e-mail). Default: o SMTP_FROM/SMTP_USER se houver.
    sender: process.env.GRAPH_SENDER || process.env.SMTP_USER || '',
  },
  // URL pública do app (para montar links nas notificações).
  appUrl: process.env.APP_URL || '',
  // Teams (canal TEAMS) — Incoming Webhook do canal corporativo.
  teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL || '',
};

// Transportes de e-mail configurados.
const smtpConfigured = (): boolean => !!config.smtp.host && !!config.smtp.user;
export const graphConfigured = (): boolean =>
  !!config.graph.tenantId && !!config.graph.clientId && !!config.graph.clientSecret && !!config.graph.sender;

// Envio externo só ocorre quando os externos estão ligados E há transporte
// (Graph OU SMTP para e-mail; webhook para Teams).
export const emailEnabled = (): boolean =>
  config.externalNotificationsEnabled && (graphConfigured() || smtpConfigured());
export const teamsEnabled = (): boolean =>
  config.externalNotificationsEnabled && !!config.teamsWebhookUrl;

// Papéis que podem atuar como aprovadores quando uma etapa não define alçada explícita.
export const APPROVER_ROLES = ['ADMIN', 'MANAGER', 'FINANCE', 'HR'] as const;
