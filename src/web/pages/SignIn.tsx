import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';

const OIDC_ERRORS: Record<string, string> = {
  account_not_linked: 'Za ta e-poštni naslov že obstaja račun z geslom. Prijavite se z geslom.',
  signup_disabled: 'Ustvarjanje novih računov ni omogočeno. Obrnite se na skrbnika.',
};

export function SignIn() {
  usePageTitle('Prijava');
  const { config, setUser } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState(code ? OIDC_ERRORS[code] ?? 'Prijava pri ponudniku ni uspela. Poskusite znova.' : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = { ...(!email.trim() && { email: 'Vnesite e-poštni naslov.' }), ...(!password && { password: 'Vnesite geslo.' }) };
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await api.signIn(email.trim(), password);
      const user = await api.session();
      navigate('/', { replace: true });
      setUser(user);
    } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };
  const oidc = async () => {
    setError('');
    try { await api.signInOidc(); } catch (err) { setError((err as ApiError).message); }
  };

  return (
    <AuthShell title="Prijava" text="Pogodbe na enem mestu, roki pod nadzorom.">
      {error && <ErrorNotice message={error} />}
      {config.localLogin && (
        <form onSubmit={submit} noValidate>
          <Field id="email" label="E-pošta" error={fields.email}>{(a) => <input {...a} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field id="password" label="Geslo" error={fields.password}>{(a) => <input {...a} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Submit busy={busy} busyLabel="Prijavljanje" className="btn btn-primary btn-block">Prijava</Submit>
        </form>
      )}
      {config.localLogin && config.oidc && <div className="separator">ali</div>}
      {config.oidc && <button type="button" className={`btn btn-block ${config.localLogin ? 'btn-secondary' : 'btn-primary'}`} onClick={oidc}>Prijava z računom {config.oidc.name}</button>}
      {config.passwordReset && <p><Link className="link" to="/pozabljeno-geslo">Pozabljeno geslo</Link></p>}
      {config.registration && <p>Še nimate računa? <Link className="link" to="/registracija">Ustvarite račun</Link></p>}
    </AuthShell>
  );
}
