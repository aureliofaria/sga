import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../src/lib/prisma';
import { dispatchPendingNotifications } from '../src/services/notificationDispatcher';
import { makeUser, resetDb } from './factory';

async function pending(userId: string, channel: string, opts: { type?: string } = {}) {
  return prisma.notification.create({
    data: { userId, type: opts.type ?? 'TASK_ASSIGNED', title: 'Nova tarefa', body: 'Você tem uma tarefa.', channel, status: 'PENDING' },
  });
}

describe('dispatcher de notificações externas', () => {
  beforeEach(resetDb);

  it('envia OUTLOOK pendente por e-mail e marca SENT', async () => {
    const u = await makeUser('USER');
    const n = await pending(u.id, 'OUTLOOK');
    const calls: { to: string; subject: string }[] = [];
    const res = await dispatchPendingNotifications({
      emailOn: () => true,
      sendEmail: async (to, subject) => { calls.push({ to, subject }); },
    });
    expect(res.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toContain('Nova tarefa');
    const fresh = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(fresh.status).toBe('SENT');
    expect(fresh.sentAt).not.toBeNull();
  });

  it('NÃO envia quando o e-mail está desligado (mantém PENDING)', async () => {
    const u = await makeUser('USER');
    const n = await pending(u.id, 'OUTLOOK');
    const res = await dispatchPendingNotifications({ emailOn: () => false, sendEmail: async () => { throw new Error('não deveria enviar'); } });
    expect(res.sent).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('PENDING');
  });

  it('falha de envio mantém PENDING e grava o erro (re-tenta depois)', async () => {
    const u = await makeUser('USER');
    const n = await pending(u.id, 'OUTLOOK');
    const res = await dispatchPendingNotifications({ emailOn: () => true, sendEmail: async () => { throw new Error('SMTP timeout'); } });
    expect(res.failed).toBe(1);
    const fresh = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(fresh.status).toBe('PENDING');
    expect(fresh.error).toContain('SMTP timeout');
  });

  it('IN_APP nunca é tocado pelo dispatcher', async () => {
    const u = await makeUser('USER');
    const n = await prisma.notification.create({ data: { userId: u.id, type: 'TASK_ASSIGNED', title: 't', channel: 'IN_APP', status: 'UNREAD' } });
    await dispatchPendingNotifications({ emailOn: () => true, sendEmail: async () => { throw new Error('x'); } });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('UNREAD');
  });

  it('TEAMS pendente posta no webhook e marca SENT', async () => {
    const u = await makeUser('USER');
    const n = await pending(u.id, 'TEAMS');
    let posted = '';
    const res = await dispatchPendingNotifications({ teamsOn: () => true, sendTeams: async (text) => { posted = text; } });
    expect(res.sent).toBe(1);
    expect(posted).toContain('Nova tarefa');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('SENT');
  });
});
