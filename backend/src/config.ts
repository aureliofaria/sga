import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Single source of truth for the JWT signing secret.
 *
 * Both the auth route (token signing) and the auth middleware (token
 * verification) MUST use this exact value, otherwise every issued token
 * fails verification (audit finding C1).
 *
 * In production a secret is mandatory and the process refuses to start
 * without it. In development we fall back to a single, shared, clearly
 * marked dev secret so a missing .env does not silently break auth.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (isProduction) {
    throw new Error(
      'JWT_SECRET is required in production. Set it in the environment before starting the server.'
    );
  }

  console.warn(
    '[config] JWT_SECRET not set — using an insecure development fallback. ' +
      'Define JWT_SECRET in backend/.env (see .env.example) for any non-local use.'
  );
  return 'aprova-dev-insecure-secret';
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 4000,
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Comma-separated list of allowed CORS origins; defaults to the Vite dev server.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // External notification dispatch (Teams/Outlook via M365) is OFF by default.
  // It must stay disabled until a corporate account is configured and human
  // validation is in place before any external send (security/LGPD constraint).
  externalNotificationsEnabled: process.env.NOTIFICATIONS_EXTERNAL_ENABLED === 'true',
} as const;
