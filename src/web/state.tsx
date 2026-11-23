import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, type AppConfig, type User } from './api.js';

interface AppState {
  config: AppConfig;
  user: User | null;
  setUser: (user: User | null) => void;
  toast: (message: string) => void;
  alerts: number;
  refreshAlerts: () => void;
}
export const AppContext = createContext<AppState | null>(null);
export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext manjka');
  return value;
}

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const { setUser } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    run().then((d) => { if (active) setData(d); }, (e: ApiError) => {
      if (!active) return;
      if (e.status === 401) setUser(null); else setError(e);
    });
    return () => { active = false; };
  }, [run, attempt, setUser]);
  return { data, setData, error, retry: () => setAttempt((n) => n + 1) };
}

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${title} | Digitalni arhiv pogodb`; }, [title]);
}

export type Children = { children: ReactNode };
