import { CircleCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Icon, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';

export function ForgotPassword() {
  usePageTitle('Pozabljeno geslo');
  const [email, setEmail] = useState('');
  const [field, setField] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const valid = /^\S+@\S+\.\S+$/.test(email.trim());
    setField(valid ? '' : 'Vnesite veljaven e-poštni naslov.');
    setError('');
    if (!valid) return;
    setBusy(true);
    try { await api.requestReset(email.trim()); setSent(true); } catch (err) { setError((err as ApiError).message); }
    setBusy(false);
  };

  return (
    <AuthShell title="Pozabljeno geslo" text="Na e-poštni naslov vam pošljemo povezavo za novo geslo.">
      {error && <ErrorNotice message={error} />}
      {sent
        ? <div className="notice notice-success" role="status"><Icon of={CircleCheck} /><div>Če račun s tem naslovom obstaja, smo poslali povezavo. Velja eno uro.</div></div>
        : (
          <form onSubmit={submit} noValidate>
            <Field id="email" label="E-pošta" error={field}>{(a) => <input {...a} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Submit busy={busy} busyLabel="Pošiljanje" className="btn btn-primary btn-block">Pošlji povezavo</Submit>
          </form>
        )}
      <p><Link className="link" to="/prijava">Nazaj na prijavo</Link></p>
    </AuthShell>
  );
}

export function NewPassword() {
  usePageTitle('Novo geslo');
  const { toast, setUser } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [field, setField] = useState('');
  const [error, setError] = useState(token ? '' : 'Povezava je potekla ali je že bila uporabljena. Zahtevajte novo.');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setField(password.length < 8 ? 'Geslo je prekratko. Vnesite najmanj 8 znakov.' : '');
    setError('');
    if (password.length < 8 || !token) return;
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setUser(null);
      toast('Geslo je spremenjeno. Prijavite se z novim geslom.');
      navigate('/prijava', { replace: true });
    } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };

  return (
    <AuthShell title="Novo geslo" text="Po spremembi gesla boste odjavljeni na vseh napravah.">
      {error && <ErrorNotice message={error} />}
      {token && (
        <form onSubmit={submit} noValidate>
          <Field id="password" label="Novo geslo" hint="Najmanj 8 znakov." error={field}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Submit busy={busy} busyLabel="Shranjevanje" className="btn btn-primary btn-block">Shrani geslo</Submit>
        </form>
      )}
      <p><Link className="link" to="/pozabljeno-geslo">Zahtevaj novo povezavo</Link></p>
    </AuthShell>
  );
}
