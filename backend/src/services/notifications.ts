import { Prisma } from '@prisma/client';
import { config } from '../config';

type Tx = Prisma.TransactionClient;

export type NotificationEvent =
  | 'TASK_ASSIGNED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_COMPLETED'
  | 'COMMENT_ADDED'
  | 'REQUEST_CORRECTION_REQUESTED'
  | 'REQUEST_INFO_REQUESTED'
  | 'REQUEST_FORWARDED'
  | 'TASK_CLAIMED'
  | 'TASK_DELAY_REMINDER'
  | 'TASK_ESCALATED_TO_LEADER';

const EXTERNAL_CHANNELS = ['TEAMS', 'OUTLOOK'] as const;

// Eventos "acionáveis" para os quais o e-mail (OUTLOOK) é LIGADO por padrão
// quando os externos estão habilitados — para a pessoa saber que tem algo a
// fazer sem precsar opt-in individual. O usuário ainda pode desativar nas
// preferências. TEAMS permanece opt-in (default false).
const EMAIL_DEFAULT_EVENTS: ReadonlySet<NotificationEvent> = new Set([
  'TASK_ASSIGNED',
  'REQUEST_CORRECTION_REQUESTED',
  'REQUEST_INFO_REQUESTED',
  'REQUEST_REJECTED',
  'REQUEST_FORWARDED',
  'TASK_DELAY_REMINDER',
  'TASK_ESCALATED_TO_LEADER',
]);

interface NotifyInput {
  userId: string;
  type: NotificationEvent;
  title: string;
  body?: string;
  requestId?: string;
}

/**
 * Records notifications for a single recipient honoring their preferences.
 *
 * Delivery model (Prioridade 2 — Comunicação e Colaboração):
 *  - IN_APP is created immediately (unless the user opted out). It is the only
 *    channel actually delivered today.
 *  - TEAMS/OUTLOOK are only materialized (as PENDING) when external dispatch is
 *    explicitly enabled via config AND the user opted in. The actual send is
 *    intentionally NOT implemented: it must go through a corporate M365 account
 *    with human validation before any external transmission (security/LGPD).
 *
 * Runs inside the caller's transaction so notifications are atomic with the
 * event that produced them.
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<void> {
  const inApp = await isChannelEnabled(tx, input.userId, 'IN_APP', input.type, true);
  if (inApp) {
    await tx.notification.create({
      data: {
        userId: input.userId,
        requestId: input.requestId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        channel: 'IN_APP',
        status: 'UNREAD',
      },
    });
  }

  if (!config.externalNotificationsEnabled) return;

  for (const channel of EXTERNAL_CHANNELS) {
    // OUTLOOK liga por padrão nos eventos acionáveis; TEAMS é opt-in.
    const channelDefault = channel === 'OUTLOOK' && EMAIL_DEFAULT_EVENTS.has(input.type);
    const enabled = await isChannelEnabled(tx, input.userId, channel, input.type, channelDefault);
    if (!enabled) continue;
    await tx.notification.create({
      data: {
        userId: input.userId,
        requestId: input.requestId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        channel,
        status: 'PENDING', // awaiting M365 dispatcher + human validation
      },
    });
  }
}

/** Notifies several recipients, de-duplicated and never the excluded user. */
export async function notifyMany(
  tx: Tx,
  userIds: string[],
  input: Omit<NotifyInput, 'userId'>,
  excludeUserId?: string
): Promise<void> {
  const unique = [...new Set(userIds)].filter((id) => id && id !== excludeUserId);
  for (const userId of unique) {
    await notify(tx, { ...input, userId });
  }
}

async function isChannelEnabled(
  tx: Tx,
  userId: string,
  channel: string,
  eventType: NotificationEvent,
  defaultEnabled: boolean
): Promise<boolean> {
  const pref = await tx.notificationPreference.findUnique({
    where: { userId_channel_eventType: { userId, channel, eventType } },
  });
  return pref ? pref.enabled : defaultEnabled;
}
