import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import departmentsRouter from './routes/departments';
import sectorsRouter from './routes/sectors';
import flowsRouter from './routes/flows';
import requestsRouter from './routes/requests';
import paymentsRouter from './routes/payments';
import tasksRouter from './routes/tasks';
import resourcesRouter from './routes/resources';
import inventoryRouter from './routes/inventory';
import reportsRouter from './routes/reports';
import auditLogsRouter from './routes/audit-logs';
import notificationsRouter from './routes/notifications';
import financeParamsRouter from './routes/financeParams';
import { processEscalations } from './services/workflow';

const app = express();
const PORT = config.port;

// Atrás de proxy/load balancer (Railway/Render/Fly/nginx) as requisições chegam
// com X-Forwarded-For. Sem 'trust proxy', o express-rate-limit lança
// ValidationError (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) → 500 em /api/auth.
// Confiamos no nº de hops definido (1 = um proxy à frente; NÃO usar `true`, que
// o próprio rate-limit considera permissivo demais). Override via TRUST_PROXY_HOPS.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Anexos: servidos como download (attachment) e nunca renderizados inline,
// mitigando XSS armazenado caso um arquivo de tipo perigoso seja servido.
app.use(
  '/uploads',
  express.static(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'), {
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// Limitador de tentativas em endpoints sensíveis de autenticação (brute force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Padrão conservador (20/15min) contra brute force; ajustável via env para
  // ambientes de homologação/carga onde scripts de teste fazem muitos logins.
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/sectors', sectorsRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/finance-params', financeParamsRouter);

// Deploy de processo único (V1 / rede interna): quando SERVE_FRONTEND=true, o
// próprio backend serve o build do frontend, deixando tudo na MESMA origem
// (http://<ip>:porta) — sem necessidade de nginx. Mantém /api e /uploads
// intactos (já registrados acima) e faz fallback de SPA para as demais rotas.
if (process.env.SERVE_FRONTEND === 'true') {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Só inicia o servidor quando executado diretamente — permite importar `app`
// em testes (supertest) sem abrir uma porta.
if (require.main === module) {
  app.listen(PORT, () => console.log(`APROVA API rodando na porta ${PORT}`));
  // Agendador in-process de recorrências de pagamento (idempotente).
  // Ligado apenas via PAYMENTS_SCHEDULER_ENABLED=true; nunca em testes.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./services/scheduler').startPaymentsScheduler();

  // Agendador in-process do escalonamento temporal (Fase 0 · Passo 11). Só roda
  // quando o módulo é executado diretamente — sob teste o `app` é importado
  // (require.main !== module), então o timer NÃO inicia. O check de NODE_ENV é
  // defesa em profundidade (não ligar o agendador em ambiente de teste).
  if (process.env.NODE_ENV !== 'test') {
    setInterval(
      () => processEscalations().catch((e) => console.error('[escalation]', e)),
      Number(process.env.ESCALATION_INTERVAL_MS) || 600000
    );
  }
}
export default app;
