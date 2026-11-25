import { CircleCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import type { CurrentUser } from '../shared/users.js';
import type { Lang } from '../shared/i18n.js';
import { applyLang, getLang, storedLang, t } from './i18n.js';
import { api, type ApiError, type AppConfig } from './api.js';
import { AuthShell, Shell } from './components/Shell.js';
import { ErrorNotice, Icon, Skeleton } from './components/ui.js';
import { AiSettings } from './pages/AiSettings.js';
import { Alerts } from './pages/Alerts.js';
import { Account } from './pages/Account.js';
import { ChangePasswordForm } from './pages/ChangePassword.js';
import { ContractDetails } from './pages/ContractDetails.js';
import { ContractForm } from './pages/ContractForm.js';
import { Contracts } from './pages/Contracts.js';
import { Dashboard } from './pages/Dashboard.js';
import { ForgotPassword, NewPassword } from './pages/Password.js';
import { MailSettings } from './pages/MailSettings.js';
import { NewContract } from './pages/NewContract.js';
import { NotFound } from './pages/NotFound.js';
import { OidcSettings } from './pages/OidcSettings.js';
import { SearchPage } from './pages/SearchPage.js';
import { SignIn } from './pages/SignIn.js';
import { SignUp } from './pages/SignUp.js';
import { EditUser, NewUser } from './pages/UserForm.js';
import { Users } from './pages/Users.js';
import { AppContext } from './state.js';

export function App() {
  const [boot, setBoot] = useState<{ config: AppConfig } | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [alerts, setAlerts] = useState(0);
  const [lang, setLangState] = useState(getLang);
  const nextId = useRef(0);

  const start = useCallback(() => {
    setError(null);
    Promise.all([api.config(), api.me()]).then(([config, u]) => { setUser(u); setBoot({ config }); }, setError);
  }, []);
  useEffect(start, [start]);

  const setLang = useCallback((next: Lang) => { applyLang(next); setLangState(next); }, []);
  // Izbira v brskalniku ima prednost; sicer velja jezik, shranjen pri računu. Strežnik ga uporabi za pošto.
  const userId = user?.id;
  const userLang = user?.language;
  useEffect(() => {
    if (!userId || !userLang) return;
    if (storedLang() === null) setLang(userLang);
    else if (lang !== userLang) api.setLanguage(lang).then(() => setUser((u) => u && { ...u, language: lang }), () => {});
  }, [userId, userLang, lang, setLang]);

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const refreshAlerts = useCallback(() => {
    api.list().then((l) => setAlerts(l.filter((c) => c.status === 'kmalu' || c.status === 'potekla').length), () => {});
  }, []);

  const refreshConfig = useCallback(async () => { const config = await api.config(); setBoot({ config }); }, []);
  const refreshUser = useCallback(async () => setUser(await api.me()), []);

  const value = useMemo(() => boot && { config: boot.config, lang, setLang, user, setUser, refreshUser, refreshConfig, toast, alerts, refreshAlerts }, [boot, lang, setLang, user, refreshUser, refreshConfig, toast, alerts, refreshAlerts]);
  if (error) return <main className="content"><ErrorNotice message={error.message} retry={start} /></main>;
  if (!value) return <main className="content"><Skeleton label={t('Nalaganje')} /></main>;

  return (
    <AppContext value={value}>
      <Routes>
        {user?.mustChangePassword ? (
          <Route path="*" element={<AuthShell title={t('Novo geslo')} text={t('Vaše geslo je začasno. Pred nadaljevanjem ga spremenite.')} signOut><ChangePasswordForm /></AuthShell>} />
        ) : user ? (
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="pogodbe" element={<Contracts />} />
            {user.permissions.create && <Route path="pogodbe/nova" element={<NewContract />} />}
            <Route path="pogodbe/iskanje" element={<SearchPage />} />
            <Route path="pogodbe/:id" element={<ContractDetails />} />
            {user.permissions.edit && <Route path="pogodbe/:id/uredi" element={<ContractForm />} />}
            <Route path="opozorila" element={<Alerts />} />
            <Route path="racun" element={<Account />} />
            {user.role === 'admin' && (
              <Route path="skrbnistvo">
                <Route index element={<Navigate to="uporabniki" replace />} />
                <Route path="uporabniki" element={<Users />} />
                <Route path="uporabniki/nov" element={<NewUser />} />
                <Route path="uporabniki/:id" element={<EditUser />} />
                <Route path="posta" element={<MailSettings />} />
                <Route path="ui" element={<AiSettings />} />
                <Route path="prijava" element={<OidcSettings />} />
              </Route>
            )}
            {['prijava', 'registracija', 'pozabljeno-geslo'].map((p) => <Route key={p} path={p} element={<Navigate to="/" replace />} />)}
            <Route path="*" element={<NotFound />} />
          </Route>
        ) : (
          <>
            <Route path="prijava" element={<SignIn />} />
            {(value.config.registration.local || value.config.registration.oidc) && <Route path="registracija" element={<SignUp />} />}
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
