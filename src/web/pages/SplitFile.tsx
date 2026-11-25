import { ArrowLeft, CircleAlert, CircleCheck, Merge, ScanText, Scissors } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS } from '../../shared/contracts.js';
import { MAX_PARTS, type Upload } from '../../shared/uploads.js';
import { api, type ApiError } from '../api.js';
import PdfPreview from '../components/PdfPreview.js';
import { PageImage, usePdf } from '../components/pdf.js';
import { Dialog, ErrorNotice, Icon, Skeleton, Submit } from '../components/ui.js';
import { t } from '../i18n.js';
import { useApp, usePageTitle } from '../state.js';

export interface QueueItem { upload: Upload; attachments: Upload[] }

interface Part { page: number; name: string; role: 'contract' | 'annex' | 'skip'; to: number | null }

const baseName = (file: File) => file.name.replace(/\.pdf$/i, '').slice(0, 100);

// Pogodba, ki ji priloga pripada: izbrana, sicer najbližja pred njo, sicer prva.
function contractFor(parts: Part[], part: Part): Part | null {
  const contracts = parts.filter((p) => p.role === 'contract');
  return contracts.find((p) => p.page === part.to) ?? contracts.findLast((p) => p.page < part.page) ?? contracts[0] ?? null;
}

// Razdelitev ene datoteke z več dokumenti. Uporabnik označi začetke; umetna inteligenca jih lahko predlaga.
export default function SplitFile({ file, ensureUpload, onBack, onDone }: { file: File; ensureUpload: (onProgress: (percent: number) => void) => Promise<Upload>; onBack: () => void; onDone: (items: QueueItem[]) => void }) {
  usePageTitle(t('Razdelitev datoteke'));
  const { user, setUser } = useApp();
  const { pages, total, failed } = usePdf(file);
  const [parts, setParts] = useState<Part[]>([{ page: 1, name: baseName(file), role: 'contract', to: null }]);
  const [busy, setBusy] = useState<'outline' | 'split' | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [found, setFound] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { scrollTo(0, 0); heading.current?.focus(); return () => abort.current?.abort(); }, []);

  const change = (page: number, changes: Partial<Part>) => setParts(parts.map((p) => (p.page === page ? { ...p, ...changes } : p)));
  const start = (page: number) => setParts([...parts, { page, name: t('{name}, stran {page}', { name: baseName(file), page }), role: 'contract' as const, to: null }].sort((a, b) => a.page - b.page));
  const merge = (page: number) => setParts(parts.filter((p) => p.page !== page));
  const last = (i: number) => (parts[i + 1]?.page ?? total + 1) - 1;
  const range = (i: number) => (parts[i]!.page === last(i) ? t('Stran {page}', { page: last(i) }) : t('Strani {from} do {to}', { from: parts[i]!.page, to: last(i) }));

  const fail = (err: unknown) => {
    const { message, status, name } = err as ApiError;
    if (name === 'AbortError') return;
    if (status === 401) return setUser(null);
    setError(message);
  };
  const begin = (kind: 'outline' | 'split') => { setBusy(kind); setError(''); setFound(null); abort.current = new AbortController(); };
  const upload = async () => { const done = await ensureUpload(setPercent); setPercent(null); return done; };

  const outline = async () => {
    begin('outline');
    try {
      const result = await api.outline((await upload()).id, abort.current!.signal);
      setParts(result.parts.map((p) => ({ page: p.page, name: p.title ?? t('{name}, stran {page}', { name: baseName(file), page: p.page }), role: p.kind, to: null })));
      setFound(result.parts.length);
    } catch (err) { fail(err); }
    setPercent(null);
    setBusy(null);
  };

  const contracts = parts.filter((p) => p.role === 'contract');
  const problem = contracts.length === 0 ? t('Vsaj en dokument mora biti pogodba.')
    : parts.length > MAX_PARTS ? t('Datoteko je mogoče razdeliti na največ {n} dokumentov.', { n: MAX_PARTS })
      : contracts.some((c) => parts.filter((p) => p.role === 'annex' && contractFor(parts, p) === c).length > MAX_ATTACHMENTS) ? t('Pogodba ima lahko največ 30 prilog.')
        : parts.some((p) => p.role !== 'skip' && !p.name.trim()) ? t('Vpišite ime vsakega dokumenta.') : '';

  const next = async () => {
    if (problem) return setError(problem);
    begin('split');
    try {
      const source = await upload();
      const kept = parts.map((part, i) => ({ part, from: part.page, to: last(i) })).filter(({ part }) => part.role !== 'skip');
      const uploads = await api.split(source.id, kept.map(({ part, from, to }) => ({ from, to, name: part.name.trim() })));
      const byPage = new Map(kept.map(({ part }, i) => [part.page, uploads[i]!]));
      void api.removeUpload(source.id).catch(() => {});
      onDone(contracts.map((c) => ({
        upload: byPage.get(c.page)!,
        attachments: parts.filter((p) => p.role === 'annex' && contractFor(parts, p) === c).map((p) => byPage.get(p.page)!),
      })));
      return;
    } catch (err) { fail(err); }
    setPercent(null);
    setBusy(null);
  };

  const loading = percent !== null ? t('Nalaganje datoteke: {n} %', { n: percent }) : null;
  return (
    <>
      <button type="button" className="back btn-back" onClick={onBack}><Icon of={ArrowLeft} />{t('Nazaj na obrazec')}</button>
      <div className="page-head"><h1 tabIndex={-1} ref={heading}>{t('Razdelitev datoteke')}</h1></div>
      <p className="muted">{t('Označite, kje se začne nov dokument. Vsaka pogodba bo dobila svoj obrazec, priloge pa se ji dodajo ob shranjevanju.')}</p>
      {failed && <ErrorNotice message={t('Te datoteke ni mogoče razdeliti.')} />}
      {!failed && (
        <>
          {user?.ai && total > 1 && (
            <div className="read">
              <Submit type="button" busy={busy === 'outline'} busyLabel={loading ?? t('Branje datoteke')} className="btn btn-secondary" onClick={busy ? undefined : outline}><Icon of={ScanText} />{t('Predlagaj razdelitev')}</Submit>
              <span className="field-hint">{busy === 'outline' ? t('Pri velikih skenih lahko traja več minut.') : t('Začetek in konec vsake strani se pošljeta na {destination}, kjer ju prebere umetna inteligenca.', { destination: user.ai.destination })}</span>
            </div>
          )}
          <div role="status">{found !== null && <div className="notice notice-success"><Icon of={CircleCheck} /><div>{t('Predlaganih dokumentov: {n}. Preverite začetke, vrste in imena.', { n: found })}</div></div>}</div>
          {error && <ErrorNotice message={error} />}
          {pages.length === 0 && <Skeleton label={t('Nalaganje strani')} />}
          {pages.length > 0 && parts.map((part, i) => (
            <section key={part.page} className={`panel${part.role === 'skip' ? ' is-skipped' : ''}`} aria-label={t('Dokument {n}', { n: i + 1 })}>
              <div className="panel-head"><h2>{t('Dokument {n}', { n: i + 1 })} <span className="muted num">{range(i)}</span></h2>
                {i > 0 && <button type="button" className="btn btn-text" onClick={() => merge(part.page)}><Icon of={Merge} />{t('Združi s prejšnjim')}</button>}</div>
              <div className="panel-body stack">
                <div className="split-fields">
                  <div className="field"><label className="field-label" htmlFor={`role-${part.page}`}>{t('Vrsta')}</label>
                    <span className="select"><select id={`role-${part.page}`} className="input" value={part.role === 'annex' ? `annex:${contractFor(parts, part)?.page ?? ''}` : part.role}
                      onChange={(e) => { const [role, to] = e.target.value.split(':') as [Part['role'], string?]; change(part.page, { role, to: to ? Number(to) : null }); }}>
                      <option value="contract">{t('Pogodba')}</option>
                      {contracts.filter((c) => c.page !== part.page).map((c) => <option key={c.page} value={`annex:${c.page}`}>{t('Priloga k: {name}', { name: c.name })}</option>)}
                      <option value="skip">{t('Izpusti')}</option>
                    </select><Icon of={ChevronDown} /></span></div>
                  {part.role !== 'skip' && <div className="field"><label className="field-label" htmlFor={`name-${part.page}`}>{t('Ime datoteke')}</label>
                    <input id={`name-${part.page}`} className="input" maxLength={140} value={part.name} onChange={(e) => change(part.page, { name: e.target.value })} /></div>}
                </div>
                <ul className="thumbs">
                  {pages.slice(part.page - 1, last(i)).map((page, k) => {
                    const number = part.page + k;
                    return (
                      <li key={number}>
                        <button type="button" className="thumb" data-theme="light" aria-label={t('Povečaj stran {page}', { page: number })} onClick={() => setShown(number)}><PageImage page={page} root={null} /></button>
                        <span className="num">{t('Stran {page}', { page: number })}</span>
                        {k > 0 && <button type="button" className="btn btn-text thumb-split" aria-label={t('Nov dokument od strani {page}', { page: number })} onClick={() => start(number)}><Icon of={Scissors} size="sm" />{t('Nov dokument')}</button>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
          {pages.length > 0 && pages.length < total && <p className="muted" role="status">{t('Nalaganje strani')}</p>}
          <div className="form-actions split-actions">
            <Submit type="button" busy={busy === 'split'} busyLabel={loading ?? t('Razdeljevanje')} onClick={busy || pages.length < total || total === 0 ? undefined : next}>{t('Nadaljuj na obrazce ({n})', { n: contracts.length })}</Submit>
            <button type="button" className="btn btn-secondary" onClick={onBack}>{t('Prekliči')}</button>
            {problem && <span className="field-error"><Icon of={CircleAlert} size="sm" />{problem}</span>}
          </div>
        </>
      )}
      {shown !== null && (
        <Dialog title={file.name} wide onClose={() => setShown(null)}>
          <PdfPreview file={file} marks={[]} target={{ key: '', page: shown, n: 0 }} onPick={() => {}} />
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" data-autofocus onClick={() => setShown(null)}>{t('Zapri')}</button></div>
        </Dialog>
      )}
    </>
  );
}
