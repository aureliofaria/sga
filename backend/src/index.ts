import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import departmentsRouter from './routes/departments';
import inventoryRouter from './routes/inventory';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/inventory', inventoryRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
