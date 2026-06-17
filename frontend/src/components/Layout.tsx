import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMe, useUnreadCount } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

const baseNavItems = [
  { to: '/tasks', label: 'Minhas Tarefas' },
  { to: '/requests', label: 'Solicitações' },
  { to: '/requests/new', label: 'Nova Solicitação' },
  { to: '/notifications', label: 'Notificações' },
  { to: '/preferences', label: 'Preferências' },
];

const AUDIT_ROLES = ['ADMIN', 'DIRETOR'];
const DASHBOARD_ROLES = ['ADMIN', 'DIRETOR', 'MANAGER'];

export default function Layout() {
  const { logout } = useAuth();
  const { data: me } = useMe();
  const { data: unread } = useUnreadCount();
  const navigate = useNavigate();
  const unreadCount = unread?.count ?? 0;
  const canAudit = me ? AUDIT_ROLES.includes(me.role) : false;
  const canDashboard = me ? DASHBOARD_ROLES.includes(me.role) : false;
  const navItems = [
    ...(canDashboard ? [{ to: '/dashboard', label: 'Dashboard' }] : []),
    ...baseNavItems,
    ...(canAudit ? [{ to: '/audit', label: 'Auditoria' }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-slate-header text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-wide text-brand">
              APROVA
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <button
              onClick={() => navigate('/notifications')}
              aria-label="Notificações"
              className="relative rounded p-1.5 text-slate-200 hover:bg-white/10"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                className="h-5 w-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-brand px-1 text-[0.65rem] font-bold leading-tight text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {me && <span className="text-slate-200">{me.name}</span>}
            <button
              onClick={logout}
              className="rounded bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-600"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <nav className="w-52 shrink-0">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/requests/new'}
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm font-medium ${
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
