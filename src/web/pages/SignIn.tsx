import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Key } from '../../shared/i18n.js';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { msg, t } from '../i18n.js';
import { useApp, usePageTitle } from '../state.js';

export const OIDC_ERRORS: Record<string, Key> = {
  account_not_linked: 'Za ta e-poštni naslov že obstaja račun z geslom. Prijavite se z geslom.',
  ACCOUNT_DISABLED: 'Račun je blokiran. Obrnite se na skrbnika.',
};

export function SignIn() {
  usePageTitle(t('Prijava'));
  const { config, setUser } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('error');
  const { registration } = config;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>(!code ? ''
    : code === 'signup_disabled' ? (registration.oidc ? msg('Račun še ne obstaja. Najprej se registrirajte.') : msg('Račun ne obstaja, registracija pa ni omogočena. Obrnite se na skrbnika.'))
    : OIDC_ERRORS[code] ?? msg('Prijava pri ponudniku ni uspela. Poskusite znova ali se prijavite z geslom.'));
  const [busy, setBusy] = useState(false);
  // Geslo je vedno na voljo; ob ponudniku je skrito pod povezavo, po napaki ponudnika pa takoj odprto.
  const [withPassword, setWithPassword] = useState(!config.oidc || (code !== null && code !== 'signup_disabled'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = { ...(!email.trim() && { email: msg('Vnesite e-poštni naslov.') }), ...(!password && { password: msg('Vnesite geslo.') }) };
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await api.signIn(email.trim(), password);
      const user = await api.me();
      navigate('/', { replace: true });
      setUser(user);
    } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };
  const oidc = async () => {
    setError('');
    try { await api.signInOidc(false); } catch (err) { setError((err as ApiError).message); setWithPassword(true); }
  };

  return (
    <AuthShell title={t('Prijava')} text={t('Pogodbe na enem mestu, roki pod nadzorom.')}>
      {error && <ErrorNotice message={error} />}
      {config.oidc && <button type="button" className="btn btn-primary btn-block" onClick={oidc}>{t('Prijava z računom {name}', { name: config.oidc.name })}</button>}
      {config.oidc && (
        <button type="button" className="disclosure" aria-expanded={withPassword} aria-controls="password-form" onClick={() => setWithPassword(!withPassword)}>
          {t('Prijava z računom {name} ne deluje?', { name: config.oidc.name })}
        </button>
      )}
      <div id="password-form" hidden={!withPassword}>
        <form onSubmit={submit} noValidate>
          {config.oidc && <p className="muted">{t('Prijavite se z e-pošto in geslom.')}</p>}
          <Field id="email" label={t('E-pošta')} error={fields.email}>{(a) => <input {...a} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field id="password" label={t('Geslo')} error={fields.password}>{(a) => <input {...a} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Submit busy={busy} busyLabel={t('Prijavljanje')} className={`btn btn-block ${config.oidc ? 'btn-secondary' : 'btn-primary'}`}>{config.oidc ? t('Prijava z geslom') : t('Prijava')}</Submit>
          {config.passwordReset && <p><Link className="link" to="/pozabljeno-geslo">{t('Pozabljeno geslo')}</Link></p>}
        </form>
      </div>
      {(registration.local || registration.oidc) && <p>{t('Še nimate računa?')} <Link className="link" to="/registracija">{t('Ustvarite račun')}</Link></p>}
    </AuthShell>
  );
}
