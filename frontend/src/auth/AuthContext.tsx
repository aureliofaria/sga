import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, clearToken, getToken, setToken } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const qc = useQueryClient();

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<{ token: string; user: User }>(
        '/auth/login',
        { email, password }
      );
      setToken(data.token);
      setTokenState(data.token);
      qc.setQueryData(['me'], data.user);
    },
    [qc]
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: Boolean(token),
      login,
      logout,
    }),
    [token, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
