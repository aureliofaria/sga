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
import tasksRouter from './routes/tasks';
import resourcesRouter from './routes/resources';
import inventoryRouter from './routes/inventory';

const app = express();
const PORT = config.port;

app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Anexos: servidos como download (attachment) e nunca renderizados inline,
// mitigando XSS armazenado caso um arquivo de tipo perigoso seja servido.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// Limitador de tentativas em endpoints sensíveis de autenticação (brute force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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
app.use('/api/tasks', tasksRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/inventory', inventoryRouter);

app.listen(PORT, () => console.log(`APROVA API rodando na porta ${PORT}`));
export default app;
