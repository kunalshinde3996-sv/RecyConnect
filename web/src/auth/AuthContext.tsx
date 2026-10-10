import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type AuthResponse, type Role, type User } from '../api';
import { onUnauthorized, tokenStore } from '../api/client';

interface AuthState {
  user: User | null;
  /** True while we validate a stored token on first load. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: Parameters<typeof api.auth.register>[0]) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function homePathFor(role: Role): string {
  return `/${role}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(() => Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Restore the session from a stored token (and drop it if the API rejects it).
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    api.auth
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && tokenStore.clear())
      .finally(() => !cancelled && setInitialising(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 on an authenticated call means the token expired: sign out.
  useEffect(() => onUnauthorized(logout), [logout]);

  const accept = useCallback((res: AuthResponse) => {
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initialising,
      login: async (email, password) => accept(await api.auth.login(email, password)),
      register: async (input) => accept(await api.auth.register(input)),
      logout,
    }),
    [user, initialising, accept, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
