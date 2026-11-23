import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';
import { OIDC_ERRORS } from './SignIn.js';
import { msg, t } from '../i18n.js';

export function SignUp() {
  usePageTitle(t('Registracija'));
  const { config, setUser } = useApp();
  const { local, oidc } = config.registration;
  const code = useSearchParams()[0].get('error');
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>(code ? OIDC_ERRORS[code] ?? msg('Registracija pri ponudniku ni uspela. Poskusite znova.') : '');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid: Record<string, string> = {};
    if (!f.name.trim()) invalid.name = msg('Vnesite ime in priimek.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) invalid.email = msg('Vnesite veljaven e-poštni naslov.');
    if (f.password.length < 8) invalid.password = msg('Geslo je prekratko. Vnesite najmanj 8 znakov.');
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await api.signUp(f.name.trim(), f.email.trim(), f.password);
      const user = await api.me();
      navigate('/', { replace: true });
      setUser(user);
    } catch (err) {
      const { message, status } = err as ApiError;
      if (status === 422) setFields({ email: message }); else setError(message);
      setBusy(false);
    }
  };

  const withOidc = async () => {
    setError('');
    try { await api.signInOidc(true); } catch (err) { setError((err as ApiError).message); }
  };

  return (
    <AuthShell title={t('Registracija')} text={t('Ustvarite račun za svoj arhiv pogodb.')}>
      {error && <ErrorNotice message={error} />}
      {local && <form onSubmit={submit} noValidate>
        <Field id="name" label={t('Ime in priimek')} error={fields.name}>{(a) => <input {...a} className="input" autoComplete="name" value={f.name} onChange={set('name')} />}</Field>
        <Field id="email" label={t('E-pošta')} error={fields.email}>{(a) => <input {...a} className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
        <Field id="password" label={t('Geslo')} hint={t('Najmanj 8 znakov.')} error={fields.password}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
        <Submit busy={busy} busyLabel={t('Ustvarjanje računa')} className="btn btn-primary btn-block">{t('Ustvari račun')}</Submit>
      </form>}
      {local && oidc && <div className="separator">{t('ali')}</div>}
      {oidc && <button type="button" className={`btn btn-block ${local ? 'btn-secondary' : 'btn-primary'}`} onClick={withOidc}>{t('Registracija z računom {name}', { name: config.oidc?.name ?? '' })}</button>}
      <p>{t('Že imate račun?')}{' '}<Link className="link" to="/prijava">{t('Prijavite se')}</Link></p>
    </AuthShell>
  );
}
