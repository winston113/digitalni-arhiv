import { ArrowLeft, Ban, CalendarPlus, Clock, CircleX, Download, FileText, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ContractView } from '../../shared/contracts.js';
import { formatDate, isIsoDate, pluralDays } from '../../shared/dates.js';
import { api, ApiError } from '../api.js';
import { DateInput } from '../components/DateInput.js';
import { Badge, Dialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { deadline, formatSize, formatValue } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { NotFound } from './NotFound.js';

type Action = 'extend' | 'terminate' | 'remove';

export function ContractDetails() {
  const { id = '' } = useParams();
  const { data, setData, error, retry } = useLoad(() => api.get(id), [id]);
  if (error?.status === 404) return <NotFound title="Pogodba ne obstaja" text="Morda je bila izbrisana." />;
  if (error) return <ErrorNotice message={error.message} retry={retry} />;
  if (!data || data.id !== id) return <Skeleton label="Nalaganje pogodbe" />;
  return <Details c={data} onChange={setData} />;
}

function Details({ c, onChange }: { c: ContractView; onChange: (c: ContractView) => void }) {
  usePageTitle(c.title);
  const { toast, refreshAlerts } = useApp();
  const [action, setAction] = useState<Action | null>(null);
  const { date, note } = deadline(c);
  const file = `/api/contracts/${c.id}/file`;
  const open = c.status !== 'prekinjena';
  const changed = (next: ContractView, message: string) => { onChange(next); setAction(null); toast(message); refreshAlerts(); };

  const rows: [string, string][] = [
    ['Pogodbena stranka', c.party],
    ['Kategorija', c.category],
    ['Številka pogodbe', c.number ?? 'Ni podatka'],
    ['Datum začetka', formatDate(c.startDate)],
    ['Datum poteka', c.endDate ? formatDate(c.endDate) : 'Nedoločen čas'],
    ['Odpovedni rok', c.noticeDays ? pluralDays(c.noticeDays) : 'Brez odpovednega roka'],
    ...(c.endDate ? [['Rok za ukrepanje', note ? `${date}, ${note}` : date], ['Opozorilo', `${pluralDays(c.warnDays)} pred rokom`]] as [string, string][] : []),
    ['Vrednost', c.valueCents === null ? 'Ni podatka' : formatValue(c.valueCents, c.valuePeriod)],
  ];

  return (
    <>
      <Link className="back" to="/pogodbe"><Icon of={ArrowLeft} />Nazaj na pogodbe</Link>
      <div className="page-head"><div className="head-title"><h1>{c.title}</h1><Badge status={c.status} /></div></div>
      {c.status === 'kmalu' && <div className="notice notice-warning"><Icon of={Clock} /><div>{(c.daysLeft ?? 0) < 0 ? `Rok za ukrepanje je minil ${date}, pogodba poteče ${formatDate(c.endDate!)}.` : `Rok za ukrepanje je ${date}, ${note}.`} Pogodbo podaljšajte ali prekinite.</div></div>}
      {c.status === 'potekla' && <div className="notice notice-error"><Icon of={CircleX} /><div>Pogodba je potekla {formatDate(c.endDate!)}. Podaljšajte jo ali prekinite.</div></div>}
      <div className="actions">
        {open && c.endDate && <button type="button" className="btn btn-primary" onClick={() => setAction('extend')}><Icon of={CalendarPlus} />Podaljšaj</button>}
        {open && <button type="button" className="btn btn-secondary" onClick={() => setAction('terminate')}><Icon of={Ban} />Prekini</button>}
        <Link className="btn btn-secondary" to={`/pogodbe/${c.id}/uredi`}><Icon of={Pencil} />Uredi</Link>
        <button type="button" className="btn btn-text btn-text-danger" onClick={() => setAction('remove')}><Icon of={Trash2} />Izbriši</button>
      </div>
      <div className="cols">
        <section className="panel">
          <div className="panel-head"><h2>Podatki o pogodbi</h2></div>
          <div className="panel-body"><dl className="data">
            {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="num">{value}</dd></div>)}
            {c.notes && <div style={{ gridColumn: '1 / -1' }}><dt>Opombe</dt><dd className="notes">{c.notes}</dd></div>}
          </dl></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Dokument</h2><a className="btn btn-secondary" href={`${file}?prenos`} download><Icon of={Download} />Prenesi PDF</a></div>
          <div className="panel-body stack">
            <iframe className="pdf" src={file} title={`Predogled dokumenta ${c.fileName}`} loading="lazy" />
            <div className="file"><Icon of={FileText} /><div className="file-body"><a className="link file-name" href={file} target="_blank" rel="noreferrer">{c.fileName}</a><div className="file-meta num">{formatSize(c.fileSize)}</div></div></div>
          </div>
        </section>
      </div>
      {action === 'extend' && <ExtendDialog c={c} close={() => setAction(null)} done={(n) => changed(n, 'Pogodba je podaljšana.')} />}
      {action === 'terminate' && (
        <ConfirmDialog title="Prekinitev pogodbe" label="Prekini pogodbo" busyLabel="Prekinjanje" close={() => setAction(null)}
          text={`Pogodba ${c.title} bo označena kot prekinjena. Opozoril zanjo ne boste več prejemali.`}
          run={async () => changed(await api.terminate(c.id), 'Pogodba je prekinjena.')} />
      )}
      {action === 'remove' && <RemoveDialog c={c} close={() => setAction(null)} />}
    </>
  );
}

function ExtendDialog({ c, close, done }: { c: ContractView; close: () => void; done: (c: ContractView) => void }) {
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isIsoDate(endDate)) return setError('Vnesite nov datum poteka, na primer 15. 1. 2028.');
    if (endDate <= c.endDate!) return setError('Nov datum mora biti po sedanjem datumu poteka.');
    setBusy(true);
    try { done(await api.extend(c.id, endDate)); } catch (err) {
      const e2 = err as ApiError;
      setError(e2.fields.endDate ?? e2.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Podaljšanje pogodbe" onClose={close}>
      <p>{c.title} {c.status === 'potekla' ? 'je potekla' : 'poteče'} {formatDate(c.endDate!)}.</p>
      <form onSubmit={submit} noValidate>
        <Field id="newEndDate" label="Nov datum poteka" error={error}>{(a) => <DateInput {...a} value={endDate} onChange={setEndDate} data-autofocus />}</Field>
        <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={close}>Prekliči</button><Submit busy={busy} busyLabel="Shranjevanje">Podaljšaj pogodbo</Submit></div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog({ title, text, label, busyLabel, run, close }: { title: string; text: string; label: string; busyLabel: string; run: () => Promise<void>; close: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await run(); } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={close}>
      <p>{text}</p>
      {error && <ErrorNotice message={error} />}
      <form className="dialog-actions" onSubmit={submit}>
        <button type="button" className="btn btn-secondary" onClick={close} data-autofocus>Prekliči</button>
        <Submit busy={busy} busyLabel={busyLabel} className="btn btn-danger">{label}</Submit>
      </form>
    </Dialog>
  );
}

function RemoveDialog({ c, close }: { c: ContractView; close: () => void }) {
  const navigate = useNavigate();
  const { toast } = useApp();
  return (
    <ConfirmDialog title="Brisanje pogodbe" label="Izbriši pogodbo" busyLabel="Brisanje" close={close}
      text={`Pogodba ${c.title} in datoteka PDF bosta trajno izbrisani.`}
      run={async () => { await api.remove(c.id); toast('Pogodba je izbrisana.'); navigate('/pogodbe', { replace: true }); }} />
  );
}
