import { ChevronDown, CircleCheck, Copy, PlugZap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fieldErrors } from '../../shared/contracts.js';
import type { Key } from '../../shared/i18n.js';
import { oidcInput, type OidcCheck, type OidcMethod, type OidcView } from '../../shared/oidc.js';
import { api, ApiError } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { ConfirmDialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { t } from '../i18n.js';
import { useApp, useLoad, usePageTitle } from '../state.js';

const METHODS: [OidcMethod, Key][] = [['none', 'PKCE brez skrivnosti'], ['client_secret_basic', 'Skrivnost, Basic'], ['client_secret_post', 'Skrivnost, POST']];

export function OidcSettings() {
  usePageTitle(t('Zunanja prijava'));
  const { data, setData, error, retry } = useLoad(api.oidc, []);
  return (
    <>
      <div className="page-head"><h1>{t('Zunanja prijava')}</h1></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label={t('Nalaganje nastavitev')} />}
      {data && <Provider key={JSON.stringify(data.settings)} view={data} onChange={setData} />}
    </>
  );
}

function Provider({ view, onChange }: { view: OidcView; onChange: (v: OidcView) => void }) {
  const { toast, refreshConfig } = useApp();
  const s = view.settings;
  const locked = view.source === 'env';
  const [f, setF] = useState({ name: s?.name ?? '', issuer: s?.issuer ?? '', clientId: s?.clientId ?? '', method: s?.method ?? ('none' as OidcMethod), clientSecret: '', scopes: s?.scopes ?? 'openid profile email', registration: s?.registration ?? true });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [check, setCheck] = useState<OidcCheck | null>(null);
  const [clearing, setClearing] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  const fail = (err: unknown) => {
    const { message, fields: invalid } = err as ApiError;
    setFields(invalid);
    if (!Object.keys(invalid).length) setError(message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = oidcInput.safeParse({ ...f, clientSecret: f.clientSecret || null });
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    if (!parsed.success) return;
    setBusy('save');
    try {
      onChange(await api.saveOidc(parsed.data));
      await refreshConfig();
      toast(t('Nastavitve ponudnika so shranjene.'));
    } catch (err) { fail(err); }
    setBusy(null);
  };
  const test = async () => {
    setError('');
    setFields({});
    setCheck(null);
    setBusy('check');
    try { setCheck(await api.checkOidc(f.issuer)); } catch (err) { fail(err); }
    setBusy(null);
  };
  const copy = () => navigator.clipboard.writeText(view.redirectUri).then(() => toast(t('Naslov je kopiran.')), () => {});

  return (
    <section className="panel">
      <div className="panel-head"><h2>OpenID Connect</h2></div>
      <div className="panel-body stack">
        {locked && <div className="notice"><div>{t('Ponudnik je nastavljen v okolju vsebnika, zato ga tu ni mogoče spremeniti.')}</div></div>}
        {view.source === 'none' && <p className="muted">{t('Povežite Zitadel, Keycloak, Authentik ali drug ponudnik OpenID Connect. Prijava z geslom ostane na voljo kot rezerva.')}</p>}
        <div className="field">
          <span className="field-label" id="redirect-label">{t('Naslov za preusmeritev')}</span>
          <span className="with-button"><code className="copyable" aria-labelledby="redirect-label">{view.redirectUri}</code><button type="button" className="btn btn-secondary" onClick={copy}><Icon of={Copy} />{t('Kopiraj')}</button></span>
          <span className="field-hint">{t('Vnesite ga pri ponudniku.')}</span>
        </div>
        {error && <ErrorNotice message={error} />}
        <form className="form" onSubmit={submit} noValidate>
          <Field id="name" label={t('Ime na gumbu')} error={fields.name} hint={t('Na primer Zitadel.')} full>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" value={f.name} onChange={set('name')} />}</Field>
          <Field id="issuer" label={t('Naslov ponudnika')} error={fields.issuer} hint={t('Izdajatelj (issuer), na primer https://prijava.primer.si')} full>{(a) => <input {...a} className="input" type="url" disabled={locked} autoComplete="off" spellCheck={false} value={f.issuer} onChange={(e) => { setCheck(null); set('issuer')(e); }} />}</Field>
          {check && (
            <div className="notice notice-success full" role="status"><Icon of={CircleCheck} /><div>
              {t('Ponudnik je dosegljiv.')} {check.pkce ? t('Podpira PKCE.') : t('Podpore za PKCE ne navaja.')}
              {check.methods.length > 0 && <> {t('Načini overjanja: {list}.', { list: check.methods.join(', ') })}</>}
            </div></div>
          )}
          <Field id="clientId" label={t('ID odjemalca')} error={fields.clientId} full>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.clientId} onChange={set('clientId')} />}</Field>
          <Field id="method" label={t('Način overjanja')} error={fields.method} hint={t('Enak kot pri ponudniku.')}>{(a) => <span className="select"><select {...a} className="input" disabled={locked} value={f.method} onChange={set('method')}>{METHODS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          {f.method !== 'none' && <Field id="clientSecret" label={t('Skrivnost odjemalca')} error={fields.clientSecret} hint={s?.hasSecret ? t('Skrivnost je shranjena. Pustite prazno, da ostane.') : undefined}>{(a) => <input {...a} className="input" type="password" disabled={locked} autoComplete="new-password" value={f.clientSecret} onChange={set('clientSecret')} />}</Field>}
          <Field id="scopes" label={t('Obsegi')} error={fields.scopes} hint={t('Ločeni s presledki. Potrebni so openid, profile in email.')} full>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.scopes} onChange={set('scopes')} />}</Field>
          <label className="check full" htmlFor="oidc-registration"><input id="oidc-registration" type="checkbox" disabled={locked} checked={f.registration} onChange={(e) => setF({ ...f, registration: e.target.checked })} />{t('Dovoli registracijo novih uporabnikov prek ponudnika')}</label>
          <div className="form-actions full">
            {!locked && <Submit busy={busy === 'save'} busyLabel={t('Shranjevanje')}>{t('Shrani nastavitve')}</Submit>}
            <Submit type="button" busy={busy === 'check'} busyLabel={t('Preverjanje')} className="btn btn-secondary" onClick={test}><Icon of={PlugZap} />{t('Preveri povezavo')}</Submit>
            {view.source === 'panel' && <button type="button" className="btn btn-text btn-text-danger" onClick={() => setClearing(true)}>{t('Odstrani nastavitve')}</button>}
          </div>
        </form>
      </div>
      {clearing && <ConfirmDialog title={t('Odstranitev ponudnika')} label={t('Odstrani')} busyLabel={t('Odstranjevanje')} close={() => setClearing(false)}
        text={t('Prijava prek ponudnika ne bo več mogoča. Uporabniki brez gesla se ne bodo mogli prijaviti, dokler jim ga ne nastavite.')}
        run={async () => { const v = await api.clearOidc(); await refreshConfig(); setClearing(false); onChange(v); toast(t('Nastavitve ponudnika so odstranjene.')); }} />}
    </section>
  );
}
