import { NavLink, Outlet } from 'react-router-dom';
import { useMe } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

const navItems = [
  { to: '/tasks', label: 'Minhas Tarefas' },
  { to: '/requests', label: 'Solicitações' },
  { to: '/requests/new', label: 'Nova Solicitação' },
];

export default function Layout() {
  const { logout } = useAuth();
  const { data: me } = useMe();

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
