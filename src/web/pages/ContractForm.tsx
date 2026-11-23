import { ArrowLeft, ChevronDown, CircleAlert, FileText, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CATEGORIES, contractInput, fieldErrors, MAX_FILE_SIZE, type ContractView, type ValuePeriod } from '../../shared/contracts.js';
import type { Key } from '../../shared/i18n.js';
import { api, ApiError } from '../api.js';
import { DateInput } from '../components/DateInput.js';
import { ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { formatSize, parseAmount } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { NotFound } from './NotFound.js';
import { getLang, msg, t, tr } from '../i18n.js';

const PERIODS: [ValuePeriod, Key][] = [['enkratno', 'Enkratno'], ['mesecno', 'Mesečno'], ['letno', 'Letno']];

const toForm = (c: ContractView | null) => ({
  title: c?.title ?? '', party: c?.party ?? '', category: c?.category ?? '', number: c?.number ?? '',
  startDate: c?.startDate ?? '', endDate: c?.endDate ?? '', openEnded: c ? c.endDate === null : false,
  noticeDays: c ? String(c.noticeDays) : '', warnDays: c ? String(c.warnDays) : '30',
  value: c?.valueCents != null ? (getLang() === 'en' ? (c.valueCents / 100).toFixed(2) : (c.valueCents / 100).toFixed(2).replace('.', ',')) : '',
  valuePeriod: c?.valuePeriod ?? 'enkratno', notes: c?.notes ?? '',
});
const days = (text: string, empty: number) => (text.trim() === '' ? empty : /^\d+$/.test(text.trim()) ? Number(text) : NaN);

export function ContractForm() {
  const { id } = useParams();
  const { data, error, retry } = useLoad<ContractView | null>(() => (id ? api.get(id) : Promise.resolve(null)), [id]);
  if (error?.status === 404) return <NotFound title={t('Pogodba ne obstaja')} text={t('Morda je bila izbrisana.')} />;
  if (error) return <ErrorNotice message={error.message} retry={retry} />;
  if (id && !data) return <Skeleton label={t('Nalaganje pogodbe')} />;
  return <Form key={data?.id ?? 'nova'} contract={data} />;
}

function Form({ contract }: { contract: ContractView | null }) {
  const heading = contract ? t('Urejanje pogodbe') : t('Nova pogodba');
  usePageTitle(heading);
  const { toast, setUser } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState(() => toForm(contract));
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(!contract);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const back = contract ? `/pogodbe/${contract.id}` : '/pogodbe';

  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  useEffect(() => {
    if (Object.keys(fields).length) form.current?.querySelector<HTMLElement>('[aria-invalid=true], .is-invalid button')?.focus();
  }, [fields]);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    const problem = !/\.pdf$/i.test(chosen.name) ? msg('Datoteka ni v obliki PDF. Izberite datoteko PDF.')
      : chosen.size > MAX_FILE_SIZE ? msg('Datoteka je prevelika. Izberite datoteko PDF, manjšo od 10 MB.') : '';
    const { file: _, ...rest } = fields;
    setFields(problem ? { ...rest, file: problem } : rest);
    setFile(problem ? null : chosen);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const data = {
      title: f.title, party: f.party, category: f.category, number: f.number, startDate: f.startDate,
      endDate: f.openEnded ? null : f.endDate, noticeDays: days(f.noticeDays, 0),
      warnDays: days(f.warnDays, NaN), valueCents: parseAmount(f.value), valuePeriod: f.valuePeriod, notes: f.notes,
    };
    const parsed = contractInput.safeParse(data);
    const invalid = { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(replacing && !file && { file: fields.file ?? msg('Izberite datoteko PDF.') }) };
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      const saved = contract ? await api.update(contract.id, data, file) : await api.create(data, file);
      toast(t('Pogodba je shranjena.'));
      navigate(`/pogodbe/${saved.id}`, { replace: true });
    } catch (err) {
      const { message, status, fields: invalidFields } = err as ApiError;
      if (status === 401) return setUser(null);
      setFields(invalidFields);
      setError(message);
      setBusy(false);
    }
  };

  const shownFile = file ? { name: file.name, size: file.size } : !replacing && contract ? { name: contract.fileName, size: contract.fileSize } : null;

  return (
    <>
      <Link className="back" to={back}><Icon of={ArrowLeft} />{contract ? t('Nazaj na pogodbo') : t('Nazaj na pogodbe')}</Link>
      <div className="page-head"><h1>{heading}</h1></div>
      {error && <ErrorNotice message={error} />}
      <form className="form" ref={form} onSubmit={submit} noValidate>
        <div className="field full" role="group" aria-labelledby="file-label">
          <span className="field-label" id="file-label">{t('Datoteka pogodbe')}</span>
          <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          {shownFile ? (
            <div className="file"><Icon of={FileText} /><div className="file-body"><div className="file-name">{shownFile.name}</div><div className="file-meta num">{formatSize(shownFile.size)}</div></div>
              <button type="button" className="btn btn-icon" aria-label={file ? t('Odstrani datoteko') : t('Zamenjaj datoteko')} onClick={() => { if (file) setFile(null); else setReplacing(true); }}><Icon of={X} /></button></div>
          ) : (
            <div className={`upload${dragging ? ' is-dragging' : ''}${fields.file ? ' is-invalid' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <Icon of={Upload} /><p>{t('Povlecite datoteko sem ali jo izberite iz naprave.')}</p>
              <div className="actions">
                <button type="button" className="btn btn-secondary" aria-describedby="file-hint" onClick={() => picker.current?.click()}>{t('Izberi datoteko')}</button>
                {contract && <button type="button" className="btn btn-text" onClick={() => { setReplacing(false); const { file: _, ...rest } = fields; setFields(rest); }}>{t('Obdrži sedanjo')}</button>}
              </div>
              <p className="field-hint" id="file-hint">{t('Datoteka PDF, največ 10 MB.')}</p>
            </div>
          )}
          {fields.file && <span className="field-error" role="alert"><Icon of={CircleAlert} size="sm" />{tr(fields.file)}</span>}
        </div>
        <Field id="title" label={t('Naziv')} error={fields.title} full>{(a) => <input {...a} className="input" maxLength={200} value={f.title} onChange={set('title')} />}</Field>
        <Field id="party" label={t('Pogodbena stranka')} error={fields.party} full>{(a) => <input {...a} className="input" maxLength={200} value={f.party} onChange={set('party')} />}</Field>
        <Field id="category" label={t('Kategorija')} error={fields.category}>{(a) => <span className="select"><select {...a} className="input" value={f.category} onChange={set('category')}><option value="" disabled>{t('Izberite kategorijo')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
        <Field id="number" label={t('Številka pogodbe')} optional error={fields.number}>{(a) => <input {...a} className="input" maxLength={60} value={f.number} onChange={set('number')} />}</Field>
        <Field id="startDate" label={t('Datum začetka')} error={fields.startDate}>{(a) => <DateInput {...a} value={f.startDate} onChange={(startDate) => setF({ ...f, startDate })} />}</Field>
        <Field id="endDate" label={t('Datum poteka')} error={fields.endDate}>{(a) => <DateInput {...a} disabled={f.openEnded} value={f.endDate} onChange={(endDate) => setF({ ...f, endDate })} />}</Field>
        <label className="check full" htmlFor="openEnded"><input id="openEnded" type="checkbox" checked={f.openEnded} onChange={(e) => setF({ ...f, openEnded: e.target.checked })} />{t('Pogodba za nedoločen čas')}</label>
        <Field id="noticeDays" label={t('Odpovedni rok')} optional hint={t('Število dni pred potekom.')} error={fields.noticeDays}>{(a) => <input {...a} className="input num" inputMode="numeric" value={f.noticeDays} onChange={set('noticeDays')} />}</Field>
        <Field id="warnDays" label={t('Opozorilo')} hint={t('Število dni pred rokom za ukrepanje.')} error={fields.warnDays}>{(a) => <input {...a} className="input num" inputMode="numeric" value={f.warnDays} onChange={set('warnDays')} />}</Field>
        <Field id="valueCents" label={t('Vrednost v evrih')} optional error={fields.valueCents}>{(a) => <input {...a} className="input num" inputMode="decimal" value={f.value} onChange={set('value')} />}</Field>
        <Field id="valuePeriod" label={t('Plačilo')} error={fields.valuePeriod}>{(a) => <span className="select"><select {...a} className="input" value={f.valuePeriod} onChange={set('valuePeriod')}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
        <Field id="notes" label={t('Opombe')} optional error={fields.notes} full>{(a) => <textarea {...a} className="input" maxLength={2000} value={f.notes} onChange={set('notes')} />}</Field>
        <div className="form-actions full"><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Shrani pogodbo')}</Submit><Link className="btn btn-secondary" to={back}>{t('Prekliči')}</Link></div>
      </form>
    </>
  );
}
