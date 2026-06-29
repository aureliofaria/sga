import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from './StatusBadge';
import { notificationsApi } from '../services/api';
import Logo from './Logo';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '🏠', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/tasks', label: 'Minhas Tarefas', icon: '✅', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/notifications', label: 'Notificações', icon: '🔔', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/requests', label: 'Solicitações', icon: '📋', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/requests/new', label: 'Nova Solicitação', icon: '➕', roles: ['ADMIN', 'MANAGER', 'FINANCE', 'HR', 'USER'] },
  { path: '/sectors', label: 'Setores', icon: '🏢', roles: ['ADMIN'] },
  { path: '/resources', label: 'Recursos', icon: '🗂️', roles: ['ADMIN'] },
  { path: '/inventory', label: 'Inventário', icon: '📦', roles: ['ADMIN', 'MANAGER'] },
  { path: '/flows', label: 'Fluxos', icon: '⚙️', roles: ['ADMIN'] },
  { path: '/users', label: 'Usuários', icon: '👥', roles: ['ADMIN'] },
  { path: '/audit', label: 'Auditoria', icon: '🔎', roles: ['ADMIN'] },
];

interface SidebarProps {
  /** Orientação da logo na barra de marca (vertical no drawer mobile). */
  orientation?: 'horizontal' | 'vertical';
  /** Chamado ao clicar num item (fecha o drawer no mobile). */
  onNavigate?: () => void;
}

export default function Sidebar({ orientation = 'horizontal', onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();
  const { data: unread = 0 } = useQuery({
    queryKey: ['notif-unread'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60000,
  });
  const isVertical = orientation === 'vertical';

  return (
    <div className="flex flex-col w-60 min-h-screen bg-golplus-blue">
      {/* Brand */}
      <div className={`px-5 py-6 border-b border-white/10 ${isVertical ? 'text-center' : ''}`}>
        <Logo
          variant="white"
          orientation={orientation}
          imgClassName={isVertical ? 'h-20 w-auto object-contain' : 'h-11 w-auto object-contain'}
        />
        <div className="text-golplus-blue-100 text-xs mt-2">Aprovações e fluxos de trabalho</div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => item.roles.includes(user?.role || ''))
          .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors border-l-4 ${
                  isActive
                    ? 'bg-white/10 text-white border-golplus-orange'
                    : 'text-golplus-blue-100 border-transparent hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.path === '/notifications' && unread > 0 && (
                <span className="ml-auto bg-golplus-orange text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{unread > 99 ? '99+' : unread}</span>
              )}
            </NavLink>
          ))}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-golplus-orange rounded-full flex items-center justify-center text-white text-sm font-bold">
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-white text-sm font-medium truncate">{user?.name}</div>
            <div className="text-golplus-blue-100 text-xs">{roleLabel(user?.role || '')}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-golplus-blue-100 hover:text-white hover:bg-white/10 rounded-xl text-sm transition-colors"
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
