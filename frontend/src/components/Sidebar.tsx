import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from './StatusBadge';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '🏠', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/tasks', label: 'Minhas Tarefas', icon: '✅', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/requests', label: 'Solicitações', icon: '📋', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/requests/new', label: 'Nova Solicitação', icon: '➕', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/flows', label: 'Fluxos', icon: '⚙️', roles: ['ADMIN'] },
  { path: '/users', label: 'Usuários', icon: '👥', roles: ['ADMIN'] },
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <div className="flex flex-col w-60 bg-blue-700 min-h-screen">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-blue-600">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-700 font-bold text-sm">SGA</span>
          </div>
          <div>
            <div className="text-white font-bold text-sm">SGA</div>
            <div className="text-blue-200 text-xs">Gestão de Aprovações</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => item.roles.includes(user?.role || ''))
          .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-800 text-white'
                    : 'text-blue-100 hover:bg-blue-600 hover:text-white'
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-blue-600">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-white text-sm font-medium truncate">{user?.name}</div>
            <div className="text-blue-200 text-xs">{roleLabel(user?.role || '')}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-blue-200 hover:text-white hover:bg-blue-600 rounded-lg text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sair
        </button>
      </div>
    </div>
  );
}
