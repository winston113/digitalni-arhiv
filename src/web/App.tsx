import { CircleCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { api, type ApiError, type AppConfig, type User } from './api.js';
import { Shell } from './components/Shell.js';
import { ErrorNotice, Icon, Skeleton } from './components/ui.js';
import { Alerts } from './pages/Alerts.js';
import { ContractDetails } from './pages/ContractDetails.js';
import { ContractForm } from './pages/ContractForm.js';
import { Contracts } from './pages/Contracts.js';
import { Dashboard } from './pages/Dashboard.js';
import { ForgotPassword, NewPassword } from './pages/Password.js';
import { NotFound } from './pages/NotFound.js';
import { SignIn } from './pages/SignIn.js';
import { SignUp } from './pages/SignUp.js';
import { AppContext } from './state.js';

export function App() {
  const [boot, setBoot] = useState<{ config: AppConfig } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [alerts, setAlerts] = useState(0);
  const nextId = useRef(0);

  const start = useCallback(() => {
    setError(null);
    Promise.all([api.config(), api.session()]).then(([config, u]) => { setUser(u); setBoot({ config }); }, setError);
  }, []);
  useEffect(start, [start]);

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const refreshAlerts = useCallback(() => {
    api.list().then((l) => setAlerts(l.filter((c) => c.status === 'kmalu' || c.status === 'potekla').length), () => {});
  }, []);

  const value = useMemo(() => boot && { config: boot.config, user, setUser, toast, alerts, refreshAlerts }, [boot, user, toast, alerts, refreshAlerts]);
  if (error) return <main className="content"><ErrorNotice message={error.message} retry={start} /></main>;
  if (!value) return <main className="content"><Skeleton label="Nalaganje" /></main>;

  return (
    <AppContext value={value}>
      <Routes>
        {user ? (
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="pogodbe" element={<Contracts />} />
            <Route path="pogodbe/nova" element={<ContractForm key="nova" />} />
            <Route path="pogodbe/:id" element={<ContractDetails />} />
            <Route path="pogodbe/:id/uredi" element={<ContractForm key="uredi" />} />
            <Route path="opozorila" element={<Alerts />} />
            {['prijava', 'registracija', 'pozabljeno-geslo'].map((p) => <Route key={p} path={p} element={<Navigate to="/" replace />} />)}
            <Route path="*" element={<NotFound />} />
          </Route>
        ) : (
          <>
            <Route path="prijava" element={<SignIn />} />
            {value.config.registration && <Route path="registracija" element={<SignUp />} />}
            {value.config.passwordReset && <Route path="pozabljeno-geslo" element={<ForgotPassword />} />}
            <Route path="*" element={<Navigate to="/prijava" replace />} />
          </>
        )}
        {value.config.passwordReset && <Route path="novo-geslo" element={<NewPassword />} />}
      </Routes>
      <div className="toasts" role="status">
        {toasts.map((t) => <div key={t.id} className="notice notice-success toast"><Icon of={CircleCheck} /><div>{t.message}</div></div>)}
      </div>
    </AppContext>
  );
}
