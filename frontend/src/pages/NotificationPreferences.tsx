import { useEffect, useState } from 'react';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '../api/hooks';
import type {
  NotificationChannel,
  NotificationEventType,
} from '../api/types';

const CHANNELS: NotificationChannel[] = ['IN_APP', 'TEAMS', 'OUTLOOK'];

const EVENT_TYPES: NotificationEventType[] = [
  'TASK_ASSIGNED',
  'REQUEST_REJECTED',
  'REQUEST_COMPLETED',
  'COMMENT_ADDED',
];

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  IN_APP: 'No app',
  TEAMS: 'Teams',
  OUTLOOK: 'Outlook',
};

const EVENT_LABELS: Record<NotificationEventType, string> = {
  TASK_ASSIGNED: 'Tarefa designada',
  REQUEST_REJECTED: 'Solicitação rejeitada',
  REQUEST_COMPLETED: 'Solicitação concluída',
  COMMENT_ADDED: 'Novo comentário',
};

type Matrix = Record<string, boolean>;

function key(channel: NotificationChannel, eventType: NotificationEventType) {
  return `${channel}:${eventType}`;
}

function defaultEnabled(channel: NotificationChannel) {
  // In-app enabled by default; external channels disabled until configured.
  return channel === 'IN_APP';
}

export default function NotificationPreferences() {
  const { data: prefs, isLoading, isError } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [matrix, setMatrix] = useState<Matrix>({});

  useEffect(() => {
    if (!prefs) return;
    const next: Matrix = {};
    for (const channel of CHANNELS) {
      for (const eventType of EVENT_TYPES) {
        next[key(channel, eventType)] = defaultEnabled(channel);
      }
    }
    for (const p of prefs) {
      next[key(p.channel, p.eventType)] = p.enabled;
    }
    setMatrix(next);
  }, [prefs]);

  function toggle(
    channel: NotificationChannel,
    eventType: NotificationEventType
  ) {
    const k = key(channel, eventType);
    setMatrix((m) => ({ ...m, [k]: !m[k] }));
  }

  function submit() {
    const preferences = CHANNELS.flatMap((channel) =>
      EVENT_TYPES.map((eventType) => ({
        channel,
        eventType,
        enabled: matrix[key(channel, eventType)] ?? defaultEnabled(channel),
      }))
    );
    save.mutate(preferences);
  }

  if (isLoading) return <p className="text-slate-500">Carregando...</p>;
  if (isError)
    return <p className="text-red-600">Erro ao carregar preferências.</p>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-800">
        Preferências de Notificação
      </h1>

      <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Entrega via Teams/Outlook em breve / pendente de integração M365. O
        envio por canais externos está desativado no servidor no momento.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-4 py-2 text-left font-semibold text-slate-500">
                Evento
              </th>
              {CHANNELS.map((channel) => (
                <th
                  key={channel}
                  className="px-4 py-2 text-center font-semibold text-slate-500"
                >
                  {CHANNEL_LABELS[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENT_TYPES.map((eventType) => (
              <tr
                key={eventType}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-2 text-slate-800">
                  {EVENT_LABELS[eventType]}
                </td>
                {CHANNELS.map((channel) => (
                  <td key={channel} className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={
                        matrix[key(channel, eventType)] ??
                        defaultEnabled(channel)
                      }
                      onChange={() => toggle(channel, eventType)}
                      className="h-4 w-4 accent-brand"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={save.isPending}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          Salvar
        </button>
        {save.isSuccess && (
          <span className="text-sm text-green-600">Preferências salvas.</span>
        )}
        {save.isError && (
          <span className="text-sm text-red-600">Erro ao salvar.</span>
        )}
      </div>
    </div>
  );
}
