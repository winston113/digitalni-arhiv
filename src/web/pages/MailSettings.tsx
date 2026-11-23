import { ChevronDown, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fieldErrors } from '../../shared/contracts.js';
import { mailInput, mailUses, type MailSecurity, type MailView } from '../../shared/mail.js';
import { formatDate, today } from '../../shared/dates.js';
import { api, ApiError } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { ConfirmDialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { useApp, useLoad, usePageTitle } from '../state.js';

const SECURITY: [MailSecurity, string][] = [['starttls', 'STARTTLS (običajno vrata 587)'], ['tls', 'TLS (običajno vrata 465)'], ['none', 'Brez šifriranja']];

export function MailSettings() {
  usePageTitle('E-pošta');
  const { data, setData, error, retry } = useLoad(api.mail, []);
  return (
    <>
      <div className="page-head"><h1>E-pošta</h1></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label="Nalaganje nastavitev" />}
      {data && <><Server key={JSON.stringify(data.settings)} view={data} onChange={setData} /><Uses view={data} onChange={setData} /></>}
    </>
  );
}

function Server({ view, onChange }: { view: MailView; onChange: (v: MailView) => void }) {
  const { toast, refreshConfig, user } = useApp();
  const s = view.settings;
  const locked = view.source === 'env';
  const [f, setF] = useState({ host: s?.host ?? '', port: String(s?.port ?? 587), security: s?.security ?? ('starttls' as MailSecurity), user: s?.user ?? '', password: '', from: s?.from ?? '', fromName: s?.fromName ?? 'Digitalni arhiv pogodb' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [clearing, setClearing] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = mailInput.safeParse({ ...f, port: /^\d+$/.test(f.port) ? Number(f.port) : NaN, password: f.password === '' ? null : f.password });
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    if (!parsed.success) return;
    setBusy('save');
    try {
      onChange(await api.saveMail(parsed.data));
      await refreshConfig();
      toast('Nastavitve pošte so shranjene.');
    } catch (err) {
      const { message, fields: invalid } = err as ApiError;
      setFields(invalid);
      if (!Object.keys(invalid).length) setError(message);
    }
    setBusy(null);
  };
  const test = async () => {
    setError('');
    setBusy('test');
    try { toast(`Preizkusno sporočilo je poslano na ${(await api.testMail()).to}.`); } catch (err) { setError((err as ApiError).message); }
    setBusy(null);
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Strežnik SMTP</h2></div>
      <div className="panel-body stack">
        {locked && <div className="notice"><div>Strežnik je nastavljen v okolju vsebnika, zato ga tu ni mogoče spremeniti.</div></div>}
        {error && <ErrorNotice message={error} />}
        <form className="form" onSubmit={submit} noValidate>
          <Field id="host" label="Strežnik" error={fields.host} hint="Za Mailjet: in-v3.mailjet.com" full>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.host} onChange={set('host')} />}</Field>
          <Field id="port" label="Vrata" error={fields.port}>{(a) => <input {...a} className="input num" disabled={locked} inputMode="numeric" value={f.port} onChange={set('port')} />}</Field>
          <Field id="security" label="Šifriranje" error={fields.security}>{(a) => <span className="select"><select {...a} className="input" disabled={locked} value={f.security} onChange={set('security')}>{SECURITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          <Field id="user" label="Uporabniško ime" optional error={fields.user} hint="Za Mailjet: ključ API">{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.user} onChange={set('user')} />}</Field>
          <Field id="password" label="Geslo" optional error={fields.password} hint={s?.hasPassword ? 'Geslo je shranjeno. Pustite prazno, da ostane.' : 'Za Mailjet: skrivni ključ'}>{(a) => <input {...a} className="input" type="password" disabled={locked} autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
          <Field id="from" label="Naslov pošiljatelja" error={fields.from} hint="Naslov mora biti pri ponudniku potrjen.">{(a) => <input {...a} className="input" type="email" disabled={locked} autoComplete="off" value={f.from} onChange={set('from')} />}</Field>
          <Field id="fromName" label="Ime pošiljatelja" optional error={fields.fromName}>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" value={f.fromName} onChange={set('fromName')} />}</Field>
          <div className="form-actions full">
            {!locked && <Submit busy={busy === 'save'} busyLabel="Shranjevanje">Shrani nastavitve</Submit>}
            {s && <Submit type="button" busy={busy === 'test'} busyLabel="Pošiljanje" className="btn btn-secondary" onClick={test}><Icon of={Send} />Pošlji preizkus na {user?.email}</Submit>}
            {view.source === 'panel' && <button type="button" className="btn btn-text btn-text-danger" onClick={() => setClearing(true)}>Odstrani nastavitve</button>}
          </div>
        </form>
      </div>
      {clearing && <ConfirmDialog title="Odstranitev nastavitev pošte" label="Odstrani" busyLabel="Odstranjevanje" close={() => setClearing(false)}
        text="Aplikacija ne bo več pošiljala sporočil, dokler pošte ne nastavite znova."
        run={async () => { const v = await api.clearMail(); await refreshConfig(); setClearing(false); onChange(v); toast('Nastavitve pošte so odstranjene.'); }} />}
    </section>
  );
}

function Uses({ view, onChange }: { view: MailView; onChange: (v: MailView) => void }) {
  const { toast, refreshConfig } = useApp();
  const [f, setF] = useState(view.uses);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = mailUses.safeParse(f);
    if (!parsed.success) return;
    setError('');
    setBusy('save');
    try { onChange(await api.saveMailUses(parsed.data)); await refreshConfig(); toast('Uporaba pošte je shranjena.'); } catch (err) { setError((err as ApiError).message); }
    setBusy(null);
  };
  const run = async () => {
    setError('');
    setBusy('run');
    try {
      const { sent, failed } = await api.runReminders();
      onChange(await api.mail());
      if (failed) setError(`Neuspelih pošiljanj: ${failed}. Preverite nastavitve strežnika.`);
      else toast(sent ? `Poslanih sporočil: ${sent}.` : 'Ni novih opozoril za pošiljanje.');
    } catch (err) { setError((err as ApiError).message); }
    setBusy(null);
  };
  const last = view.lastRun && new Date(view.lastRun.at);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Uporaba</h2></div>
      <div className="panel-body stack">
        {error && <ErrorNotice message={error} />}
        {view.source === 'none' && <p className="muted">Nastavitve začnejo veljati, ko nastavite strežnik SMTP.</p>}
        <form className="form" onSubmit={submit}>
          <fieldset className="fieldset full">
            <legend className="field-label">Vrste sporočil</legend>
            <label className="check" htmlFor="use-reset"><input id="use-reset" type="checkbox" checked={f.passwordReset} onChange={(e) => setF({ ...f, passwordReset: e.target.checked })} />Ponastavitev gesla</label>
            <label className="check" htmlFor="use-reminders"><input id="use-reminders" type="checkbox" checked={f.reminders} onChange={(e) => setF({ ...f, reminders: e.target.checked })} />Opozorila pred potekom pogodb</label>
          </fieldset>
          <Field id="hour" label="Ura pošiljanja opozoril" hint="Najprej ob začetku opozorila, nato teden pred rokom in ob poteku.">{(a) => <span className="select"><select {...a} className="input num" disabled={!f.reminders} value={f.reminderHour} onChange={(e) => setF({ ...f, reminderHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h}.00`}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          <div className="form-actions full">
            <Submit busy={busy === 'save'} busyLabel="Shranjevanje">Shrani uporabo</Submit>
            {view.source !== 'none' && view.uses.reminders && <Submit type="button" busy={busy === 'run'} busyLabel="Pošiljanje" className="btn btn-secondary" onClick={run}>Pošlji nova opozorila zdaj</Submit>}
          </div>
        </form>
        {last && <p className="field-hint">Zadnje pošiljanje {formatDate(today(last))} ob {last.getHours()}.{String(last.getMinutes()).padStart(2, '0')}: poslanih {view.lastRun!.sent}, neuspelih {view.lastRun!.failed}.</p>}
      </div>
    </section>
  );
}
