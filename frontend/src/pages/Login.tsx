import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Preencha email e senha'); return; }
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-golplus-blue-700 to-golplus-blue-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo showApprova={false} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">APROVA</h1>
          <p className="text-gray-500 text-sm mt-2">Acesse sua conta para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-golplus-blue-500 focus:border-transparent text-sm"
              placeholder="seu@email.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-golplus-blue-500 focus:border-transparent text-sm"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-golplus-blue-600 hover:bg-golplus-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 font-medium mb-2">Usuários de demonstração:</p>
          <div className="space-y-1">
            {[
              ['admin@aprova.com', 'ADMIN'],
              ['rh@aprova.com', 'RH'],
              ['financeiro@aprova.com', 'Financeiro'],
              ['gestor@aprova.com', 'Gestor'],
              ['joao@aprova.com', 'Usuário'],
            ].map(([e, r]) => (
              <button
                key={e}
                type="button"
                onClick={() => { setEmail(e); setPassword('senha123'); }}
                className="w-full text-left text-xs text-gray-600 hover:text-golplus-blue-600 py-0.5"
              >
                {e} <span className="text-gray-400">({r})</span>
              </button>
            ))}
            <p className="text-xs text-gray-400 mt-1">Senha: senha123</p>
          </div>
        </div>
      </div>
    </div>
  );
}
