import { ChevronDown, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fieldErrors } from '../../shared/contracts.js';
import { mailInput, mailUses, type MailSecurity, type MailView } from '../../shared/mail.js';
import { today } from '../../shared/dates.js';
import type { Key } from '../../shared/i18n.js';
import { formatDate, formatTime } from '../format.js';
import { api, ApiError } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { ConfirmDialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { t } from '../i18n.js';

const SECURITY: [MailSecurity, Key][] = [['starttls', 'STARTTLS (običajno vrata 587)'], ['tls', 'TLS (običajno vrata 465)'], ['none', 'Brez šifriranja']];

export function MailSettings() {
  usePageTitle(t('E-pošta'));
  const { data, setData, error, retry } = useLoad(api.mail, []);
  return (
    <>
      <div className="page-head"><h1>{t('E-pošta')}</h1></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label={t('Nalaganje nastavitev')} />}
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
  const [detail, setDetail] = useState('');
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
      toast(t('Nastavitve pošte so shranjene.'));
    } catch (err) {
      const { message, fields: invalid } = err as ApiError;
      setFields(invalid);
      if (!Object.keys(invalid).length) setError(message);
    }
    setBusy(null);
  };
  const test = async () => {
    setError('');
    setDetail('');
    setBusy('test');
    try { toast(t('Preizkusno sporočilo je poslano na {email}.', { email: (await api.testMail()).to })); } catch (err) { setError((err as ApiError).message); setDetail((err as ApiError).detail); }
    setBusy(null);
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Strežnik SMTP')}</h2></div>
      <div className="panel-body stack">
        {locked && <div className="notice"><div>{t('Strežnik je nastavljen v okolju vsebnika, zato ga tu ni mogoče spremeniti.')}</div></div>}
        {error && <ErrorNotice message={error} detail={detail} />}
        <form className="form" onSubmit={submit} noValidate>
          <Field id="host" label={t('Strežnik')} error={fields.host} hint={t('Za Mailjet: in-v3.mailjet.com')} full>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.host} onChange={set('host')} />}</Field>
          <Field id="port" label={t('Vrata')} error={fields.port}>{(a) => <input {...a} className="input num" disabled={locked} inputMode="numeric" value={f.port} onChange={set('port')} />}</Field>
          <Field id="security" label={t('Šifriranje')} error={fields.security}>{(a) => <span className="select"><select {...a} className="input" disabled={locked} value={f.security} onChange={set('security')}>{SECURITY.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          <Field id="user" label={t('Uporabniško ime')} optional error={fields.user} hint={t('Za Mailjet: ključ API')}>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" spellCheck={false} value={f.user} onChange={set('user')} />}</Field>
          <Field id="password" label={t('Geslo')} optional error={fields.password} hint={s?.hasPassword ? t('Geslo je shranjeno. Pustite prazno, da ostane.') : t('Za Mailjet: skrivni ključ')}>{(a) => <input {...a} className="input" type="password" disabled={locked} autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
          <Field id="from" label={t('Naslov pošiljatelja')} error={fields.from} hint={t('Naslov mora biti pri ponudniku potrjen.')}>{(a) => <input {...a} className="input" type="email" disabled={locked} autoComplete="off" value={f.from} onChange={set('from')} />}</Field>
          <Field id="fromName" label={t('Ime pošiljatelja')} optional error={fields.fromName}>{(a) => <input {...a} className="input" disabled={locked} autoComplete="off" value={f.fromName} onChange={set('fromName')} />}</Field>
          <div className="form-actions full">
            {!locked && <Submit busy={busy === 'save'} busyLabel={t('Shranjevanje')}>{t('Shrani nastavitve')}</Submit>}
            {s && <Submit type="button" busy={busy === 'test'} busyLabel={t('Pošiljanje')} className="btn btn-secondary" onClick={test}><Icon of={Send} />{t('Pošlji preizkus na {email}', { email: user?.email ?? '' })}</Submit>}
            {view.source === 'panel' && <button type="button" className="btn btn-text btn-text-danger" onClick={() => setClearing(true)}>{t('Odstrani nastavitve')}</button>}
          </div>
        </form>
      </div>
      {clearing && <ConfirmDialog title={t('Odstranitev nastavitev pošte')} label={t('Odstrani')} busyLabel={t('Odstranjevanje')} close={() => setClearing(false)}
        text={t('Aplikacija ne bo več pošiljala sporočil, dokler pošte ne nastavite znova.')}
        run={async () => { const v = await api.clearMail(); await refreshConfig(); setClearing(false); onChange(v); toast(t('Nastavitve pošte so odstranjene.')); }} />}
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
    try { onChange(await api.saveMailUses(parsed.data)); await refreshConfig(); toast(t('Uporaba pošte je shranjena.')); } catch (err) { setError((err as ApiError).message); }
    setBusy(null);
  };
  const run = async () => {
    setError('');
    setBusy('run');
    try {
      const { sent, failed } = await api.runReminders();
      onChange(await api.mail());
      if (failed) setError(t('Neuspelih pošiljanj: {n}. Preverite nastavitve strežnika.', { n: failed }));
      else toast(sent ? t('Poslanih sporočil: {n}.', { n: sent }) : t('Ni novih opozoril za pošiljanje.'));
    } catch (err) { setError((err as ApiError).message); }
    setBusy(null);
  };
  const last = view.lastRun && new Date(view.lastRun.at);
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Uporaba')}</h2></div>
      <div className="panel-body stack">
        {error && <ErrorNotice message={error} />}
        {view.source === 'none' && <p className="muted">{t('Nastavitve začnejo veljati, ko nastavite strežnik SMTP.')}</p>}
        <form className="form" onSubmit={submit}>
          <fieldset className="fieldset full">
            <legend className="field-label">{t('Vrste sporočil')}</legend>
            <label className="check" htmlFor="use-reset"><input id="use-reset" type="checkbox" checked={f.passwordReset} onChange={(e) => setF({ ...f, passwordReset: e.target.checked })} />{t('Ponastavitev gesla')}</label>
            <label className="check" htmlFor="use-reminders"><input id="use-reminders" type="checkbox" checked={f.reminders} onChange={(e) => setF({ ...f, reminders: e.target.checked })} />{t('Opozorila pred potekom pogodb')}</label>
          </fieldset>
          <Field id="hour" label={t('Ura pošiljanja opozoril')} hint={t('Najprej ob začetku opozorila, nato teden pred rokom in ob poteku.')}>{(a) => <span className="select"><select {...a} className="input num" disabled={!f.reminders} value={f.reminderHour} onChange={(e) => setF({ ...f, reminderHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{formatTime(new Date(2026, 0, 1, h))}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
          <div className="form-actions full">
            <Submit busy={busy === 'save'} busyLabel={t('Shranjevanje')}>{t('Shrani uporabo')}</Submit>
            {view.source !== 'none' && view.uses.reminders && <Submit type="button" busy={busy === 'run'} busyLabel={t('Pošiljanje')} className="btn btn-secondary" onClick={run}>{t('Pošlji nova opozorila zdaj')}</Submit>}
          </div>
        </form>
        {last && <p className="field-hint">{t('Zadnje pošiljanje {date} ob {time}: poslanih {sent}, neuspelih {failed}.', { date: formatDate(today(last)), time: formatTime(last), sent: view.lastRun!.sent, failed: view.lastRun!.failed })}</p>}
      </div>
    </section>
  );
}
