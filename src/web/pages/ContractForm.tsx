import { ArrowLeft, ChevronDown, CircleAlert, CircleCheck, Eye, FileText, ScanText, Upload, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type FocusEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CATEGORIES, contractInput, fieldErrors, MAX_FILE_SIZE, type Category, type ContractView, type ValuePeriod } from '../../shared/contracts.js';
import type { SuggestResult, Suggestion, Suggestions } from '../../shared/ai.js';
import { parseAmount } from '../../shared/amounts.js';
import type { Key } from '../../shared/i18n.js';
import { api, ApiError } from '../api.js';
import type { PreviewMark, PreviewTarget } from '../components/PdfPreview.js';
import { DateInput } from '../components/DateInput.js';
import { Dialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { formatDate, formatSize, pluralDays } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { NotFound } from './NotFound.js';
import { getLang, msg, t, tr } from '../i18n.js';

// Pregledovalnik je velik, zato se naloži šele, ko je izbrana datoteka.
const PdfPreview = lazy(() => import('../components/PdfPreview.js'));

const WIDE = '(min-width: 1100px)';
const useWide = () => useSyncExternalStore((changed) => { const m = matchMedia(WIDE); m.addEventListener('change', changed); return () => m.removeEventListener('change', changed); }, () => matchMedia(WIDE).matches);

const FIELD_LABELS: Record<keyof Suggestions, Key> = {
  title: 'Naziv', party: 'Pogodbena stranka', category: 'Kategorija', number: 'Številka pogodbe', startDate: 'Datum začetka', endDate: 'Datum poteka',
  openEnded: 'Pogodba za nedoločen čas', noticeDays: 'Odpovedni rok', valueCents: 'Vrednost v evrih', valuePeriod: 'Plačilo',
};

const PERIODS: [ValuePeriod, Key][] = [['enkratno', 'Enkratno'], ['mesecno', 'Mesečno'], ['letno', 'Letno']];

const amountText = (cents: number) => (getLang() === 'en' ? (cents / 100).toFixed(2) : (cents / 100).toFixed(2).replace('.', ','));

const toForm = (c: ContractView | null) => ({
  title: c?.title ?? '', party: c?.party ?? '', category: c?.category ?? '', number: c?.number ?? '',
  startDate: c?.startDate ?? '', endDate: c?.endDate ?? '', openEnded: c ? c.endDate === null : false,
  noticeDays: c ? String(c.noticeDays) : '', warnDays: c ? String(c.warnDays) : '30',
  value: c?.valueCents != null ? amountText(c.valueCents) : '',
  valuePeriod: c?.valuePeriod ?? 'enkratno', notes: c?.notes ?? '',
});
const days = (text: string, empty: number) => (text.trim() === '' ? empty : /^\d+$/.test(text.trim()) ? Number(text) : NaN);

type FormValues = ReturnType<typeof toForm>;

// Predlog, prepisan v polja obrazca.
const asValues: { [K in keyof Suggestions]-?: (value: NonNullable<Suggestions[K]>['value']) => Partial<FormValues> } = {
  title: (title) => ({ title }), party: (party) => ({ party }), category: (category) => ({ category }), number: (number) => ({ number }),
  startDate: (startDate) => ({ startDate }), endDate: (endDate) => ({ endDate, openEnded: false }), openEnded: () => ({ openEnded: true }),
  noticeDays: (n) => ({ noticeDays: String(n) }), valueCents: (n) => ({ value: amountText(n) }), valuePeriod: (valuePeriod) => ({ valuePeriod }),
};
const changesFor = (s: Suggestions, key: keyof Suggestions) => (asValues[key] as (v: unknown) => Partial<FormValues>)(s[key]!.value);

// Ali je predlog enak vnosu.
function agrees(f: FormValues, s: Suggestions, key: keyof Suggestions): boolean {
  const changes = changesFor(s, key);
  return (Object.keys(changes) as (keyof FormValues)[]).every((k) => (k === 'value' ? parseAmount(f.value) === parseAmount(changes.value!) : f[k] === changes[k]));
}

// Izpolni samo prazna polja; kar je uporabnik že vnesel, ostane.
function fillEmpty(f: FormValues, s: Suggestions): { values: FormValues; filled: number; differ: number } {
  const empty: Record<keyof Suggestions, boolean> = {
    title: !f.title, party: !f.party, category: !f.category, number: !f.number, startDate: !f.startDate,
    endDate: !f.endDate && !f.openEnded, openEnded: !f.endDate && !f.openEnded, noticeDays: !f.noticeDays, valueCents: !f.value, valuePeriod: !f.value,
  };
  const all = Object.keys(s) as (keyof Suggestions)[];
  const keys = all.filter((k) => empty[k]);
  const values = Object.assign({}, f, ...keys.map((k) => changesFor(s, k))) as FormValues;
  return { values, filled: keys.length, differ: all.filter((k) => !agrees(values, s, k)).length };
}

// Od kod je predlog; če se vnos razlikuje, ponudi zamenjavo.
function Note({ id, f, suggestions, shown, apply, show }: { id: keyof Suggestions; f: FormValues; suggestions: Suggestions | undefined; shown: (value: never) => string; apply: (changes: Partial<FormValues>) => void; show: () => void }) {
  const s = suggestions?.[id] as Suggestion<never> | undefined;
  if (!s) return null;
  const changes = changesFor(suggestions!, id);
  const same = agrees(f, suggestions!, id);
  return (
    <span className="field-note">
      {!same && <span>{t('Predlog: {value}', { value: shown(s.value) })} <button type="button" className="btn btn-text" onClick={() => apply(changes)}>{t('Uporabi')}</button></span>}
      {s.quote
        ? <button type="button" className="source" title={t('Pokaži v dokumentu')} onClick={show}><Icon of={Eye} size="sm" /><span>{t('Iz pogodbe, stran {page}: »{quote}«', { page: s.page!, quote: s.quote })}</span></button>
        : same && <span>{t('Predlog, preverite ga.')}</span>}
    </span>
  );
}

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
  const { toast, user, setUser } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState(() => toForm(contract));
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(!contract);
  const [stored, setStored] = useState<File | null>(null);
  const [storedFailed, setStoredFailed] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<AbortController | null>(null);
  const [read, setRead] = useState<(SuggestResult & { filled: number; differ: number }) | null>(null);
  const [readError, setReadError] = useState('');
  const latest = useRef(f);
  latest.current = f;
  const wide = useWide();
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [opened, setOpened] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const back = contract ? `/pogodbe/${contract.id}` : '/pogodbe';

  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  useEffect(() => {
    if (Object.keys(fields).length) form.current?.querySelector<HTMLElement>('[aria-invalid=true], .is-invalid button')?.focus();
  }, [fields]);

  // Pri urejanju je v predogledu shranjena datoteka, dokler je uporabnik ne zamenja.
  useEffect(() => {
    if (!contract) return;
    let active = true;
    api.file(contract.id, contract.fileName).then((loaded) => { if (active) setStored(loaded); }, (err: ApiError) => {
      if (!active) return;
      if (err.status === 401) setUser(null); else setStoredFailed(true);
    });
    return () => { active = false; };
  }, [contract, setUser]);
  const shown = file ?? (replacing ? null : stored);

  useEffect(() => () => reading?.abort(), [reading]);
  const forget = () => { reading?.abort(); setReading(null); setRead(null); setReadError(''); setTarget(null); setOpened(false); };
  const suggest = async () => {
    if (!shown) return;
    const controller = new AbortController();
    setReading(controller);
    setRead(null);
    setReadError('');
    setTarget(null);
    try {
      const result = await api.suggest(shown, controller.signal);
      if (controller.signal.aborted) return;
      const { values, filled, differ } = fillEmpty(latest.current, result.suggestions);
      setF(values);
      setRead({ ...result, filled, differ });
    } catch (err) {
      if (controller.signal.aborted) return;
      const { message, status } = err as ApiError;
      if (status === 401) return setUser(null);
      setReadError(message);
    }
    setReading(null);
  };
  const apply = (changes: Partial<FormValues>) => setF({ ...f, ...changes });
  const note = (id: keyof Suggestions, shown: (value: never) => string = String) => <Note id={id} f={f} suggestions={read?.suggestions} shown={shown} apply={apply} show={() => { if (point(id) && !wide) setOpened(true); }} />;

  const found = read?.suggestions;
  // Plačilo in vrednost imata isti vir, zato skupno oznako. Manjše oznake so nad večjimi, da je vsako mogoče klikniti.
  const marks = useMemo<PreviewMark[]>(() => Object.entries(found ?? {}).flatMap(([key, s]) => (key === 'valuePeriod' ? [] : (s as Suggestion<unknown>).marks ?? []).map((m) => ({ ...m, key, label: t(FIELD_LABELS[key as keyof Suggestions]) })))
    .sort((a, b) => b.w * b.h - a.w * a.h), [found]);
  const point = (id: string): boolean => {
    const s = found?.[id as keyof Suggestions] as Suggestion<unknown> | undefined;
    if (!s?.page) return false;
    setTarget((old) => ({ key: id === 'valuePeriod' ? 'valueCents' : id, page: s.page!, n: (old?.n ?? 0) + 1 }));
    return true;
  };
  // Ob vstopu v polje pogled pokaže njegov vir.
  const follow = (e: FocusEvent) => { const id = (e.target as HTMLElement).id; if (wide && id && (id === 'valuePeriod' ? 'valueCents' : id) !== target?.key) point(id); };
  // Klik na oznako odpre polje, ki ga je treba preveriti.
  const pick = (key: string) => {
    setOpened(false);
    setTarget((old) => ({ key, page: (found![key as keyof Suggestions] as Suggestion<unknown>).page!, n: old?.n ?? 0 }));
    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`#${key}`)?.focus());
  };
  const preview = shown && <Suspense fallback={<Skeleton label={t('Nalaganje predogleda')} />}><PdfPreview file={shown} marks={marks} target={target} onPick={pick} /></Suspense>;

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    forget();
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

  const side = wide && (file !== null || (contract !== null && !replacing));
  const good = read !== null && Object.keys(read.suggestions).length > 0 && (read.filled > 0 || read.differ === 0);

  return (
    <>
      <Link className="back" to={back}><Icon of={ArrowLeft} />{contract ? t('Nazaj na pogodbo') : t('Nazaj na pogodbe')}</Link>
      <div className="page-head"><h1>{heading}</h1></div>
      {error && <ErrorNotice message={error} />}
      <div className={side ? 'with-preview' : undefined}>
      <form className="form" ref={form} onSubmit={submit} onFocus={follow} noValidate>
        <div className="field full" role="group" aria-labelledby="file-label">
          <span className="field-label" id="file-label">{t('Datoteka pogodbe')}</span>
          <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          {shownFile ? (
            <div className="file"><Icon of={FileText} /><div className="file-body"><div className="file-name">{shownFile.name}</div><div className="file-meta num">{formatSize(shownFile.size)}</div></div>
              <button type="button" className="btn btn-icon" aria-label={file ? t('Odstrani datoteko') : t('Zamenjaj datoteko')} onClick={() => { forget(); if (file) setFile(null); else setReplacing(true); }}><Icon of={X} /></button></div>
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
          {shown && !wide && <button type="button" className="btn btn-secondary btn-preview" onClick={() => setOpened(true)}><Icon of={Eye} />{t('Pokaži dokument')}</button>}
          {shown && user?.ai && (
            <div className="read">
              <Submit type="button" busy={reading !== null} busyLabel={t('Branje pogodbe')} className="btn btn-secondary" onClick={suggest}><Icon of={ScanText} />{t('Izpolni iz PDF')}</Submit>
              <span className="field-hint">{reading ? t('To lahko traja nekaj minut. Polja lahko medtem izpolnjujete sami.') : t('Besedilo pogodbe se pošlje na {destination}, kjer ga prebere umetna inteligenca.', { destination: user.ai.destination })}</span>
            </div>
          )}
          {readError && <ErrorNotice message={readError} />}
          <div role="status">{read && (
            <div className={`notice${good ? ' notice-success' : ''}`}><Icon of={good ? CircleCheck : CircleAlert} /><div>
              {Object.keys(read.suggestions).length === 0 ? t('V pogodbi ni bilo mogoče zanesljivo najti podatkov. Polja izpolnite ročno.')
                : read.filled ? t('Izpolnjenih podatkov: {n}. Pred shranjevanjem preverite vsakega.', { n: read.filled })
                : !read.differ ? t('Vsi najdeni podatki se ujemajo z vnesenimi.') : ''}
              {read.differ > 0 && <> {t('Predlogov, ki se razlikujejo od vnesenih podatkov: {n}. Prikazani so ob poljih.', { n: read.differ })}</>}
              {read.pagesRead < read.pagesTotal && <> {t('Prebranih je {read} od {total} strani z besedilom, ker je pogodba predolga.', { read: read.pagesRead, total: read.pagesTotal })}</>}
            </div></div>
          )}</div>
          {fields.file && <span className="field-error" role="alert"><Icon of={CircleAlert} size="sm" />{tr(fields.file)}</span>}
        </div>
        <Field id="title" note={note('title')} label={t('Naziv')} error={fields.title} full>{(a) => <input {...a} className="input" maxLength={200} value={f.title} onChange={set('title')} />}</Field>
        <Field id="party" note={note('party')} label={t('Pogodbena stranka')} error={fields.party} full>{(a) => <input {...a} className="input" maxLength={200} value={f.party} onChange={set('party')} />}</Field>
        <Field id="category" note={note('category', (v: Category) => t(v))} label={t('Kategorija')} error={fields.category}>{(a) => <span className="select"><select {...a} className="input" value={f.category} onChange={set('category')}><option value="" disabled>{t('Izberite kategorijo')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
        <Field id="number" note={note('number')} label={t('Številka pogodbe')} optional error={fields.number}>{(a) => <input {...a} className="input" maxLength={60} value={f.number} onChange={set('number')} />}</Field>
        <Field id="startDate" note={note('startDate', formatDate)} label={t('Datum začetka')} error={fields.startDate}>{(a) => <DateInput {...a} value={f.startDate} onChange={(startDate) => setF({ ...f, startDate })} />}</Field>
        <Field id="endDate" note={note('endDate', formatDate)} label={t('Datum poteka')} error={fields.endDate}>{(a) => <DateInput {...a} disabled={f.openEnded} value={f.endDate} onChange={(endDate) => setF({ ...f, endDate })} />}</Field>
        <label className="check full" htmlFor="openEnded"><input id="openEnded" type="checkbox" checked={f.openEnded} onChange={(e) => setF({ ...f, openEnded: e.target.checked })} />{t('Pogodba za nedoločen čas')}</label>
        {read?.suggestions.openEnded && <div className="full">{note('openEnded', () => t('Pogodba za nedoločen čas'))}</div>}
        <Field id="noticeDays" note={note('noticeDays', pluralDays)} label={t('Odpovedni rok')} optional hint={t('Število dni pred potekom.')} error={fields.noticeDays}>{(a) => <input {...a} className="input num" inputMode="numeric" value={f.noticeDays} onChange={set('noticeDays')} />}</Field>
        <Field id="warnDays" label={t('Opozorilo')} hint={t('Število dni pred rokom za ukrepanje.')} error={fields.warnDays}>{(a) => <input {...a} className="input num" inputMode="numeric" value={f.warnDays} onChange={set('warnDays')} />}</Field>
        <Field id="valueCents" note={note('valueCents', amountText)} label={t('Vrednost v evrih')} optional error={fields.valueCents}>{(a) => <input {...a} className="input num" inputMode="decimal" value={f.value} onChange={set('value')} />}</Field>
        <Field id="valuePeriod" note={note('valuePeriod', (v: ValuePeriod) => t(PERIODS.find(([p]) => p === v)![1]))} label={t('Plačilo')} error={fields.valuePeriod}>{(a) => <span className="select"><select {...a} className="input" value={f.valuePeriod} onChange={set('valuePeriod')}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
        <Field id="notes" label={t('Opombe')} optional error={fields.notes} full>{(a) => <textarea {...a} className="input" maxLength={2000} value={f.notes} onChange={set('notes')} />}</Field>
        <div className="form-actions full"><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Shrani pogodbo')}</Submit><Link className="btn btn-secondary" to={back}>{t('Prekliči')}</Link></div>
      </form>
      {side && <aside className="preview-side">{preview ?? (storedFailed ? <ErrorNotice message={t('Predogleda te datoteke ni mogoče prikazati.')} /> : <Skeleton label={t('Nalaganje predogleda')} />)}</aside>}
      </div>
      {shown && !wide && opened && (
        <Dialog title={shown.name} wide onClose={() => setOpened(false)}>
          {preview}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" data-autofocus onClick={() => setOpened(false)}>{t('Zapri')}</button></div>
        </Dialog>
      )}
    </>
  );
}
