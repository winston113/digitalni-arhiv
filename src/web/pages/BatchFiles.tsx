import { ArrowLeft, ChevronDown, CircleAlert, FileText, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, MAX_ATTACHMENTS } from '../../shared/contracts.js';
import { ACCEPT, isAllowedName } from '../../shared/files.js';
import type { Upload } from '../../shared/uploads.js';
import { api, type ApiError } from '../api.js';
import { DateInput } from '../components/DateInput.js';
import { ErrorNotice, Field, Icon, Submit } from '../components/ui.js';
import { formatSize } from '../format.js';
import { msg, t, tr } from '../i18n.js';
import { useApp, usePageTitle } from '../state.js';
import type { FormValues } from './ContractForm.js';
import { ReadAll, type QueueItem, type QueueOptions } from './queue.js';

export const MAX_BATCH = 20;

interface Entry { id: number; file: File; role: string; problem: string }

// Več datotek naenkrat: vsaka je pogodba ali priloga k eni od njih. Skupni podatki se prepišejo v vse obrazce.
export default function BatchFiles({ files, onBack, onDone }: { files: File[]; onBack: () => void; onDone: (items: QueueItem[], options: QueueOptions) => void }) {
  usePageTitle(t('Več pogodb'));
  const { config, user, setUser } = useApp();
  const nextId = useRef(0);
  const check = (file: File) => (!isAllowedName(file.name) ? msg('Datoteka ni v obliki PDF ali DOCX. Izberite drugo.')
    : file.size > config.maxFileMb * 1024 * 1024 ? msg('Datoteka je prevelika. Izberite manjšo.') : '');
  const entry = (file: File): Entry => ({ id: nextId.current++, file, role: 'contract', problem: check(file) });
  const [entries, setEntries] = useState<Entry[]>(() => files.map(entry));
  const [shared, setShared] = useState({ category: '', startDate: '', endDate: '', openEnded: false, noticeDays: '', warnDays: '30' });
  const [auto, setAuto] = useState(Boolean(user?.ai));
  const [progress, setProgress] = useState<{ n: number; total: number; percent: number } | null>(null);
  const [error, setError] = useState('');
  const uploaded = useRef(new Map<number, Upload>());
  const finished = useRef(false);
  const alive = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    scrollTo(0, 0);
    heading.current?.focus();
    alive.current = true;
    const done = uploaded.current;
    return () => {
      alive.current = false;
      if (!finished.current) for (const u of done.values()) api.removeUpload(u.id).catch(() => {});
    };
  }, []);

  const set = (key: keyof typeof shared) => (e: { target: { value: string } }) => setShared({ ...shared, [key]: e.target.value });
  const contracts = entries.filter((e) => e.role === 'contract');
  // Priloga k pogodbi, ki ni več pogodba, spet postane samostojna.
  const roleOf = (e: Entry) => (e.role === 'contract' || contracts.some((c) => String(c.id) === e.role) ? e.role : 'contract');
  const own = entries.map((e) => ({ ...e, role: roleOf(e) }));
  const change = (id: number, role: string) => setEntries(own.map((e) => (e.id === id ? { ...e, role } : e)));
  const remove = (id: number) => {
    const upload = uploaded.current.get(id);
    if (upload) { uploaded.current.delete(id); api.removeUpload(upload.id).catch(() => {}); }
    setEntries(own.filter((e) => e.id !== id));
  };
  const add = (more: File[]) => setEntries([...own, ...more.map(entry)]);

  const heads = own.filter((e) => e.role === 'contract');
  const problem = own.length > MAX_BATCH ? t('Naenkrat lahko dodate največ {n} datotek.', { n: MAX_BATCH })
    : heads.length === 0 ? t('Vsaj en dokument mora biti pogodba.')
      : own.some((e) => e.problem) ? t('Odstranite datoteke, ki jih ni mogoče dodati.')
        : heads.some((c) => own.filter((e) => e.role === String(c.id)).length > MAX_ATTACHMENTS) ? t('Pogodba ima lahko največ 30 prilog.') : '';

  const next = async () => {
    if (problem) return setError(problem);
    setError('');
    let failed = false;
    const list = [...own];
    for (const [i, e] of list.entries()) {
      if (uploaded.current.has(e.id)) continue;
      setProgress({ n: i + 1, total: list.length, percent: 0 });
      try {
        const upload = await api.upload(e.file, (percent) => setProgress({ n: i + 1, total: list.length, percent }));
        if (!alive.current) { api.removeUpload(upload.id).catch(() => {}); return; }
        uploaded.current.set(e.id, upload);
      } catch (err) {
        const { message, status } = err as ApiError;
        if (status === 401) return setUser(null);
        failed = true;
        // Nekatere napake so stalne, druge ne; datoteko lahko uporabnik odstrani ali poskusi znova.
        list[i] = { ...e, problem: status === 400 || status === 413 ? message : '' };
        setError(status === 400 || status === 413 ? t('Nekaterih datotek ni bilo mogoče naložiti.') : message);
        if (status !== 400 && status !== 413) break;
      }
    }
    setProgress(null);
    if (failed) return setEntries(list);
    finished.current = true;
    const { category, startDate, endDate, openEnded, noticeDays, warnDays } = shared;
    const defaults: Partial<FormValues> = { category, startDate, endDate: openEnded ? '' : endDate, openEnded, noticeDays, warnDays };
    onDone(heads.map((c) => ({ upload: uploaded.current.get(c.id)!, attachments: list.filter((e) => e.role === String(c.id)).map((e) => uploaded.current.get(e.id)!) })), { auto: auto && Boolean(user?.ai), defaults });
  };

  return (
    <>
      <button type="button" className="back btn-back" onClick={onBack}><Icon of={ArrowLeft} />{t('Nazaj na obrazec')}</button>
      <div className="page-head"><h1 tabIndex={-1} ref={heading}>{t('Več pogodb')}</h1></div>
      <p className="muted">{t('Vsaka pogodba bo dobila svoj obrazec, ki ga preverite in shranite. Priloge se dodajo k izbrani pogodbi.')}</p>
      {error && <ErrorNotice message={error} />}
      <section className="panel">
        <div className="panel-head"><h2>{t('Datoteke')} <span className="muted num">{own.length}</span></h2>
          <button type="button" className="btn btn-secondary" disabled={progress !== null || own.length >= MAX_BATCH} onClick={() => picker.current?.click()}><Icon of={Plus} />{t('Dodaj datoteke')}</button></div>
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden aria-label={t('Dodaj datoteke')} onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <ul className="panel-body file-list">
          {own.map((e) => (
            <li key={e.id} className="batch-row">
              <div className="file"><Icon of={FileText} /><div className="file-body"><div className="file-name">{e.file.name}</div><div className="file-meta num">{formatSize(e.file.size)}</div></div>
                <button type="button" className="btn btn-icon" disabled={progress !== null} aria-label={t('Odstrani {name}', { name: e.file.name })} onClick={() => remove(e.id)}><Icon of={X} /></button></div>
              {e.problem ? <span className="field-error"><Icon of={CircleAlert} size="sm" />{tr(e.problem)}</span> : (
                <span className="select"><select className="input" aria-label={t('Vrsta: {name}', { name: e.file.name })} disabled={progress !== null} value={e.role} onChange={(x) => change(e.id, x.target.value)}>
                  <option value="contract">{t('Pogodba')}</option>
                  {heads.filter((c) => c.id !== e.id).map((c) => <option key={c.id} value={c.id}>{t('Priloga k: {name}', { name: c.file.name })}</option>)}
                </select><Icon of={ChevronDown} /></span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{t('Skupni podatki')} <span className="muted">({t('neobvezno')})</span></h2></div>
        <div className="panel-body stack">
          <p className="muted">{t('Vpišejo se v vse obrazce. Pri posamezni pogodbi jih lahko spremenite.')}</p>
          <div className="form">
            <Field id="b-category" label={t('Kategorija')}>{(a) => <span className="select"><select {...a} className="input" value={shared.category} onChange={set('category')}><option value="">{t('Ni skupne')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select><Icon of={ChevronDown} /></span>}</Field>
            <Field id="b-startDate" label={t('Datum začetka')}>{(a) => <DateInput {...a} value={shared.startDate} onChange={(startDate) => setShared({ ...shared, startDate })} />}</Field>
            <Field id="b-endDate" label={t('Datum poteka')}>{(a) => <DateInput {...a} disabled={shared.openEnded} value={shared.endDate} onChange={(endDate) => setShared({ ...shared, endDate })} />}</Field>
            <label className="check full" htmlFor="b-openEnded"><input id="b-openEnded" type="checkbox" checked={shared.openEnded} onChange={(e) => setShared({ ...shared, openEnded: e.target.checked })} />{t('Pogodba za nedoločen čas')}</label>
            <Field id="b-noticeDays" label={t('Odpovedni rok')} hint={t('Število dni pred potekom.')}>{(a) => <input {...a} className="input num" inputMode="numeric" value={shared.noticeDays} onChange={set('noticeDays')} />}</Field>
            <Field id="b-warnDays" label={t('Opozorilo')} hint={t('Število dni pred rokom za ukrepanje.')}>{(a) => <input {...a} className="input num" inputMode="numeric" value={shared.warnDays} onChange={set('warnDays')} />}</Field>
          </div>
        </div>
      </section>
      <ReadAll value={auto} onChange={setAuto} count={heads.length} />
      <div className="form-actions split-actions">
        <Submit type="button" busy={progress !== null} busyLabel={progress ? t('Nalaganje {n} od {total}: {percent} %', progress) : ''} onClick={progress ? undefined : next}>{t('Nadaljuj na obrazce ({n})', { n: heads.length })}</Submit>
        <button type="button" className="btn btn-secondary" onClick={onBack}>{t('Prekliči')}</button>
        {problem && <span className="field-error"><Icon of={CircleAlert} size="sm" />{problem}</span>}
      </div>
    </>
  );
}
