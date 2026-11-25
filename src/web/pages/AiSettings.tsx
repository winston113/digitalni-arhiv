import { ChevronDown, PlugZap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AI_DEFAULT_URL, aiConnection, aiInput, type AiProvider, type AiView } from '../../shared/ai.js';
import { fieldErrors } from '../../shared/contracts.js';
import type { Key } from '../../shared/i18n.js';
import { api, ApiError } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { ConfirmDialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { t } from '../i18n.js';
import { useApp, useLoad, usePageTitle } from '../state.js';

const PROVIDERS: [AiProvider, Key][] = [['ollama', 'Ollama'], ['openai', 'OpenAI ali združljiv strežnik'], ['anthropic', 'Anthropic']];

export function AiSettings() {
  usePageTitle(t('Umetna inteligenca'));
  const { data, setData, error, retry } = useLoad(api.ai, []);
  return (
    <>
      <div className="page-head"><h1>{t('Umetna inteligenca')}</h1></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label={t('Nalaganje nastavitev')} />}
      {data && <Provider key={JSON.stringify(data.settings)} view={data} onChange={setData} />}
    </>
  );
}

function Provider({ view, onChange }: { view: AiView; onChange: (v: AiView) => void }) {
  const { toast, refreshUser } = useApp();
  const s = view.settings;
  const [f, setF] = useState({ provider: s?.provider ?? ('ollama' as AiProvider), baseUrl: s?.baseUrl ?? '', apiKey: '', model: s?.model ?? '', organisation: s?.organisation ?? '', dailyLimit: String(s?.dailyLimit ?? 20) });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  const setConnection = (changes: Partial<typeof f>) => { setModels(null); setF({ ...f, ...changes }); };
  const values = () => ({ ...f, baseUrl: f.provider === 'anthropic' ? AI_DEFAULT_URL.anthropic : f.baseUrl, apiKey: f.apiKey || null });
  const fail = (err: unknown) => {
    const { message, fields: invalid } = err as ApiError;
    setFields(invalid);
    if (!Object.keys(invalid).length) setError(message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = aiInput.safeParse({ ...values(), dailyLimit: /^\d+$/.test(f.dailyLimit) ? Number(f.dailyLimit) : NaN });
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    if (!parsed.success) return;
    setBusy('save');
    try {
      onChange(await api.saveAi(parsed.data));
      await refreshUser();
      toast(t('Nastavitve umetne inteligence so shranjene.'));
    } catch (err) { fail(err); }
    setBusy(null);
  };
  const check = async () => {
    const parsed = aiConnection.safeParse(values());
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    setModels(null);
    if (!parsed.success) return;
    setBusy('check');
    try {
      const found = await api.aiModels(parsed.data);
      setModels(found);
      if (found.length && !found.includes(f.model)) setF((v) => ({ ...v, model: found.includes('claude-opus-5-5') ? 'claude-opus-5-5' : found[0]! }));
    } catch (err) { fail(err); }
    setBusy(null);
  };
  const keyHint = s?.hasKey && s.provider === f.provider ? t('Ključ je shranjen. Pustite prazno, da ostane.') : f.provider === 'ollama' ? t('Samo če ga vaš strežnik zahteva.') : undefined;

  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Branje podatkov iz pogodb')}</h2></div>
      <div className="panel-body stack">
        <p className="muted">{t('Pri dodajanju pogodbe lahko uporabnik z enim klikom izpolni obrazec s podatki iz datoteke. Ponudniku se pošlje besedilo pogodbe. Uporabo dovolite vsakemu uporabniku posebej na strani Uporabniki.')}</p>
        {view.unreadableKey && <ErrorNotice message={t('Shranjenega ključa ni mogoče prebrati. Vnesite ga znova.')} />}
        {error && <ErrorNotice message={error} />}
        <form className="form" onSubmit={submit} noValidate>
          <Field id="provider" label={t('Ponudnik')} error={fields.provider} full>{(a) => <span className="select"><select {...a} className="input" value={f.provider} onChange={(e) => setConnection({ provider: e.target.value as AiProvider, baseUrl: e.target.value === 'openai' ? AI_DEFAULT_URL.openai : '', apiKey: '', model: '' })}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          {f.provider !== 'anthropic' && <Field id="baseUrl" label={t('Naslov strežnika')} error={fields.baseUrl} hint={f.provider === 'ollama' ? t('Na primer http://192.168.1.10:11434') : t('Z delom /v1, na primer https://api.openai.com/v1')} full>{(a) => <input {...a} className="input" type="url" autoComplete="off" spellCheck={false} value={f.baseUrl} onChange={(e) => setConnection({ baseUrl: e.target.value })} />}</Field>}
          <Field id="apiKey" label={t('Ključ API')} optional={f.provider !== 'anthropic'} error={fields.apiKey} hint={keyHint} full>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={f.apiKey} onChange={(e) => setConnection({ apiKey: e.target.value })} />}</Field>
          <Field id="model" label={t('Model')} error={fields.model} full hint={models === null ? t('Za seznam modelov preverite povezavo.') : models.length ? t('Povezava deluje. Razpoložljivih modelov: {n}.', { n: models.length }) : t('Povezava deluje, vendar strežnik nima nobenega modela.')}>
            {(a) => models?.length
              ? <span className="select"><select {...a} className="input" value={f.model} onChange={set('model')}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select><Icon of={ChevronDown} /></span>
              : <input {...a} className="input" autoComplete="off" spellCheck={false} value={f.model} onChange={set('model')} />}
          </Field>
          <Field id="organisation" label={t('Ime vašega podjetja')} optional error={fields.organisation} hint={t('Da model vašega podjetja ne predlaga kot pogodbene stranke.')} full>{(a) => <input {...a} className="input" autoComplete="off" maxLength={200} value={f.organisation} onChange={set('organisation')} />}</Field>
          <Field id="dailyLimit" label={t('Branj na dan')} error={fields.dailyLimit} hint={t('Za posameznega uporabnika.')}>{(a) => <input {...a} className="input num" inputMode="numeric" value={f.dailyLimit} onChange={set('dailyLimit')} />}</Field>
          <div className="form-actions full">
            <Submit busy={busy === 'save'} busyLabel={t('Shranjevanje')}>{t('Shrani nastavitve')}</Submit>
            <Submit type="button" busy={busy === 'check'} busyLabel={t('Preverjanje')} className="btn btn-secondary" onClick={check}><Icon of={PlugZap} />{t('Preveri povezavo')}</Submit>
            {s && <button type="button" className="btn btn-text btn-text-danger" onClick={() => setClearing(true)}>{t('Odstrani nastavitve')}</button>}
          </div>
        </form>
      </div>
      {clearing && <ConfirmDialog title={t('Odstranitev ponudnika')} label={t('Odstrani')} busyLabel={t('Odstranjevanje')} close={() => setClearing(false)}
        text={t('Branje podatkov iz pogodb ne bo več na voljo. Shranjen ključ bo izbrisan.')}
        run={async () => { const v = await api.clearAi(); await refreshUser(); setClearing(false); onChange(v); toast(t('Nastavitve umetne inteligence so odstranjene.')); }} />}
    </section>
  );
}
