import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from '../api/hooks';
import { formatDate } from '../lib/format';

export default function Notifications() {
  const [status, setStatus] = useState<'UNREAD' | 'ALL'>('UNREAD');
  const { data: notifications, isLoading, isError } = useNotifications(status);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Notificações</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-slate-200 text-sm">
            <button
              onClick={() => setStatus('UNREAD')}
              className={`rounded-l px-3 py-1.5 font-medium ${
                status === 'UNREAD'
                  ? 'bg-brand text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Não lidas
            </button>
            <button
              onClick={() => setStatus('ALL')}
              className={`rounded-r px-3 py-1.5 font-medium ${
                status === 'ALL'
                  ? 'bg-brand text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Todas
            </button>
          </div>
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-60"
          >
            Marcar todas como lidas
          </button>
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Carregando...</p>}
      {isError && (
        <p className="text-red-600">Erro ao carregar notificações.</p>
      )}

      {!isLoading && !isError && !notifications?.length && (
        <p className="text-slate-500">Nenhuma notificação.</p>
      )}

      <ul className="space-y-3">
        {notifications?.map((n) => {
          const isUnread = n.status === 'UNREAD';
          return (
            <li
              key={n.id}
              onClick={() => {
                if (n.requestId) navigate(`/requests/${n.requestId}`);
              }}
              className={`rounded-lg border border-slate-200 bg-white p-4 ${
                n.requestId ? 'cursor-pointer hover:border-brand' : ''
              } ${isUnread ? 'border-l-4 border-l-brand' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{n.title}</div>
                  {n.body && (
                    <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                  )}
                  <div className="mt-1 text-xs text-slate-400">
                    {formatDate(n.createdAt)}
                  </div>
                </div>
                {isUnread && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markRead.mutate(n.id);
                    }}
                    disabled={markRead.isPending}
                    className="shrink-0 rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
                  >
                    marcar como lida
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
