import { ArrowLeft, Ban, CalendarPlus, CircleEllipsis, Clock, CircleX, Download, FileText, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Attachment, ContractDetails as Contract } from '../../shared/contracts.js';
import { isIsoDate } from '../../shared/dates.js';
import { api, ApiError } from '../api.js';
import { Attachments } from '../components/Attachments.js';
import { TextStatus } from '../components/TextStatus.js';
import { DateInput } from '../components/DateInput.js';
import { Badge, ConfirmDialog, Dialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { deadline, formatDate, formatSize, formatValue, pluralDays } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { NotFound } from './NotFound.js';
import { msg, t, tr } from '../i18n.js';

type Action = 'extend' | 'terminate' | 'remove';

export function ContractDetails() {
  const { id = '' } = useParams();
  const { data, setData, error, retry } = useLoad(() => api.get(id), [id]);
  const onTexts = useCallback((next: Contract) => setData((prev) => (prev?.id !== next.id ? prev : {
    ...prev, textState: next.textState,
    attachments: prev.attachments.map((a) => ({ ...a, textState: next.attachments.find((n) => n.id === a.id)?.textState ?? a.textState })),
  })), [setData]);
  if (error?.status === 404) return <NotFound title={t('Pogodba ne obstaja')} text={t('Morda je bila izbrisana.')} />;
  if (error) return <ErrorNotice message={error.message} retry={retry} />;
  if (!data || data.id !== id) return <Skeleton label={t('Nalaganje pogodbe')} />;
  return <Details key={data.id} c={data} onChange={setData} onTexts={onTexts} onAttachments={(attachments) => setData((prev) => (prev?.id === id ? { ...prev, attachments } : prev))} />;
}

function Details({ c, onChange, onAttachments, onTexts }: { c: Contract; onChange: (c: Contract) => void; onAttachments: (a: Attachment[]) => void; onTexts: (c: Contract) => void }) {
  usePageTitle(c.title);
  const { user, toast, refreshAlerts } = useApp();
  const may = user!.permissions;
  const [action, setAction] = useState<Action | null>(null);
  const { date, note } = deadline(c);
  const file = `/api/contracts/${c.id}/file`;
  const open = may.edit && c.status !== 'prekinjena';
  const states = [c.textState, ...c.attachments.map((a) => a.textState)];
  const waiting = states.includes('pending');
  // Med pripravo besedila občasno osveži samo stanje dokumentov.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { api.get(c.id).then(onTexts, () => {}); }, 4000);
    return () => clearInterval(timer);
  }, [waiting, c.id, onTexts]);
  const retry = () => { api.reindex(c.id).then(onTexts, (err: ApiError) => toast(tr(err.message))); };
  const changed = (next: Contract, message: string) => { onChange(next); setAction(null); toast(message); refreshAlerts(); };

  const rows: [string, string][] = [
    [t('Pogodbena stranka'), c.party],
    [t('Kategorija'), t(c.category)],
    [t('Številka pogodbe'), c.number ?? t('Ni podatka')],
    [t('Datum začetka'), formatDate(c.startDate)],
    [t('Datum poteka'), c.endDate ? formatDate(c.endDate) : t('Nedoločen čas')],
    [t('Odpovedni rok'), c.noticeDays ? pluralDays(c.noticeDays) : t('Brez odpovednega roka')],
    ...(c.endDate ? [[t('Rok za ukrepanje'), note ? `${date}, ${note}` : date], [t('Opozorilo'), t('{days} pred rokom', { days: pluralDays(c.warnDays) })]] as [string, string][] : []),
    [t('Vrednost'), c.valueCents === null ? t('Ni podatka') : formatValue(c.valueCents, c.valuePeriod)],
  ];

  return (
    <>
      <Link className="back" to="/pogodbe"><Icon of={ArrowLeft} />{t('Nazaj na pogodbe')}</Link>
      <div className="page-head"><div className="head-title"><h1>{c.title}</h1><Badge status={c.status} /></div></div>
      {c.status === 'prihodnja' && <div className="notice"><Icon of={CircleEllipsis} /><div>{t('Pogodba začne veljati {date}.', { date: formatDate(c.startDate) })}</div></div>}
      {c.status === 'kmalu' && <div className="notice notice-warning"><Icon of={Clock} /><div>{(c.daysLeft ?? 0) < 0 ? t('Rok za ukrepanje je minil {date}, pogodba poteče {end}.', { date, end: formatDate(c.endDate!) }) : t('Rok za ukrepanje je {date}, {note}.', { date, note })} {t('Pogodbo podaljšajte ali prekinite.')}</div></div>}
      {c.status === 'potekla' && <div className="notice notice-error"><Icon of={CircleX} /><div>{t('Pogodba je potekla {end}. Podaljšajte jo ali prekinite.', { end: formatDate(c.endDate!) })}</div></div>}
      {(may.edit || may.remove) && <div className="actions">
        {open && c.endDate && <button type="button" className="btn btn-primary" onClick={() => setAction('extend')}><Icon of={CalendarPlus} />{t('Podaljšaj')}</button>}
        {open && <button type="button" className="btn btn-secondary" onClick={() => setAction('terminate')}><Icon of={Ban} />{t('Prekini')}</button>}
        {may.edit && <Link className="btn btn-secondary" to={`/pogodbe/${c.id}/uredi`}><Icon of={Pencil} />{t('Uredi')}</Link>}
        {may.remove && <button type="button" className="btn btn-text btn-text-danger" onClick={() => setAction('remove')}><Icon of={Trash2} />{t('Izbriši')}</button>}
      </div>}
      <div className="cols">
        <section className="panel">
          <div className="panel-head"><h2>{t('Podatki o pogodbi')}</h2></div>
          <div className="panel-body"><dl className="data">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="num">{value}</dd></div>)}
            {c.notes && <div style={{ gridColumn: '1 / -1' }}><dt>{t('Opombe')}</dt><dd className="notes">{c.notes}</dd></div>}
          </dl></div>
        </section>
        <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>{t('Dokument')}</h2><a className="btn btn-secondary" href={`${file}?prenos`} download><Icon of={Download} />{t('Prenesi PDF')}</a></div>
          <div className="panel-body stack">
            <iframe className="pdf" src={file} title={t('Predogled dokumenta {name}', { name: c.fileName })} loading="lazy" />
            <div className="file"><Icon of={FileText} /><div className="file-body"><a className="link file-name" href={file} target="_blank" rel="noreferrer">{c.fileName}</a><div className="file-meta num">{formatSize(c.fileSize)}<TextStatus state={c.textState} /></div></div></div>
          </div>
        </section>
        {may.edit && states.includes('failed') && <div className="notice notice-warning"><div>{t('Besedila nekaterih dokumentov ni bilo mogoče prebrati, zato jih iskanje po vsebini ne zajame.')} <button type="button" className="btn btn-text" onClick={retry}>{t('Poskusi znova')}</button></div></div>}
        <Attachments contractId={c.id} attachments={c.attachments} onChange={onAttachments} />
        </div>
      </div>
      {action === 'extend' && <ExtendDialog c={c} close={() => setAction(null)} done={(n) => changed(n, t('Pogodba je podaljšana.'))} />}
      {action === 'terminate' && (
        <ConfirmDialog title={t('Prekinitev pogodbe')} label={t('Prekini pogodbo')} busyLabel={t('Prekinjanje')} close={() => setAction(null)}
          text={t('Pogodba {title} bo označena kot prekinjena. Opozoril zanjo ne boste več prejemali.', { title: c.title })}
          run={async () => changed(await api.terminate(c.id), t('Pogodba je prekinjena.'))} />
      )}
      {action === 'remove' && <RemoveDialog c={c} close={() => setAction(null)} />}
    </>
  );
}

function ExtendDialog({ c, close, done }: { c: Contract; close: () => void; done: (c: Contract) => void }) {
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isIsoDate(endDate)) return setError(t('Vnesite nov datum poteka, na primer {date}.', { date: formatDate('2028-01-15') }));
    if (endDate <= c.endDate!) return setError(msg('Nov datum mora biti po sedanjem datumu poteka.'));
    setBusy(true);
    try { done(await api.extend(c.id, endDate)); } catch (err) {
      const e2 = err as ApiError;
      setError(e2.fields.endDate ?? e2.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('Podaljšanje pogodbe')} onClose={close}>
      <p>{c.status === 'potekla' ? t('{title} je potekla {end}.', { title: c.title, end: formatDate(c.endDate!) }) : t('{title} poteče {end}.', { title: c.title, end: formatDate(c.endDate!) })}</p>
      <form onSubmit={submit} noValidate>
        <Field id="newEndDate" label={t('Nov datum poteka')} error={error}>{(a) => <DateInput {...a} value={endDate} onChange={setEndDate} data-autofocus />}</Field>
        <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={close}>{t('Prekliči')}</button><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Podaljšaj pogodbo')}</Submit></div>
      </form>
    </Dialog>
  );
}

function RemoveDialog({ c, close }: { c: Contract; close: () => void }) {
  const navigate = useNavigate();
  const { toast } = useApp();
  return (
    <ConfirmDialog title={t('Brisanje pogodbe')} label={t('Izbriši pogodbo')} busyLabel={t('Brisanje')} close={close}
      text={t('Pogodba {title} in datoteka PDF bosta trajno izbrisani.', { title: c.title })}
      run={async () => { await api.remove(c.id); toast(t('Pogodba je izbrisana.')); navigate('/pogodbe', { replace: true }); }} />
  );
}
