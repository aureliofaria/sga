import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Requests from './pages/Requests';
import RequestDetail from './pages/RequestDetail';
import NewRequest from './pages/NewRequest';
import MyTasks from './pages/MyTasks';
import FlowTemplates from './pages/FlowTemplates';
import FlowEditor from './pages/FlowEditor';
import Setores from './pages/Setores';
import Users from './pages/Users';
import ResourceManagement from './pages/ResourceManagement';
import Inventory from './pages/Inventory';
import AuditLog from './pages/AuditLog';
import Notifications from './pages/Notifications';
import PaymentRecurrences from './pages/PaymentRecurrences';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function ProtectedRoute({ children, adminOnly = false, roles }: { children: React.ReactNode; adminOnly?: boolean; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">Carregando...</div>
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (adminOnly && user?.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  if (roles && !roles.includes(user?.role || '')) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/requests/new" element={<NewRequest />} />
        <Route path="/requests/:id" element={<RequestDetail />} />
        <Route path="/payments/recurrences" element={<ProtectedRoute roles={['ADMIN', 'FINANCE', 'MANAGER']}><PaymentRecurrences /></ProtectedRoute>} />
        <Route path="/tasks" element={<MyTasks />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/sectors" element={<ProtectedRoute adminOnly><Setores /></ProtectedRoute>} />
        <Route path="/flows" element={<ProtectedRoute adminOnly><FlowTemplates /></ProtectedRoute>} />
        <Route path="/flows/new" element={<ProtectedRoute adminOnly><FlowEditor /></ProtectedRoute>} />
        <Route path="/flows/:id/edit" element={<ProtectedRoute adminOnly><FlowEditor /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="/resources" element={<ProtectedRoute adminOnly><ResourceManagement /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Inventory /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
