import { CircleCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Icon, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';
import { msg, t } from '../i18n.js';

export function ForgotPassword() {
  usePageTitle(t('Pozabljeno geslo'));
  const [email, setEmail] = useState('');
  const [field, setField] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const valid = /^\S+@\S+\.\S+$/.test(email.trim());
    setField(valid ? '' : msg('Vnesite veljaven e-poštni naslov.'));
    setError('');
    if (!valid) return;
    setBusy(true);
    try { await api.requestReset(email.trim()); setSent(true); } catch (err) { setError((err as ApiError).message); }
    setBusy(false);
  };

  return (
    <AuthShell title={t('Pozabljeno geslo')} text={t('Na e-poštni naslov vam pošljemo povezavo za novo geslo.')}>
      {error && <ErrorNotice message={error} />}
      {sent
        ? <div className="notice notice-success" role="status"><Icon of={CircleCheck} /><div>{t('Če račun s tem naslovom obstaja, smo poslali povezavo. Velja eno uro.')}</div></div>
        : (
          <form onSubmit={submit} noValidate>
            <Field id="email" label={t('E-pošta')} error={field}>{(a) => <input {...a} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Submit busy={busy} busyLabel={t('Pošiljanje')} className="btn btn-primary btn-block">{t('Pošlji povezavo')}</Submit>
          </form>
        )}
      <p><Link className="link" to="/prijava">{t('Nazaj na prijavo')}</Link></p>
    </AuthShell>
  );
}

export function NewPassword() {
  usePageTitle(t('Novo geslo'));
  const { toast, setUser } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [field, setField] = useState('');
  const [error, setError] = useState<string>(token ? '' : msg('Povezava je potekla ali je že bila uporabljena. Zahtevajte novo.'));
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setField(password.length < 8 ? msg('Geslo je prekratko. Vnesite najmanj 8 znakov.') : '');
    setError('');
    if (password.length < 8 || !token) return;
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setUser(null);
      toast(t('Geslo je spremenjeno. Prijavite se z novim geslom.'));
      navigate('/prijava', { replace: true });
    } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };

  return (
    <AuthShell title={t('Novo geslo')} text={t('Po spremembi gesla boste odjavljeni na vseh napravah.')}>
      {error && <ErrorNotice message={error} />}
      {token && (
        <form onSubmit={submit} noValidate>
          <Field id="password" label={t('Novo geslo')} hint={t('Najmanj 8 znakov.')} error={field}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Submit busy={busy} busyLabel={t('Shranjevanje')} className="btn btn-primary btn-block">{t('Shrani geslo')}</Submit>
        </form>
      )}
      <p><Link className="link" to="/pozabljeno-geslo">{t('Zahtevaj novo povezavo')}</Link></p>
    </AuthShell>
  );
}
