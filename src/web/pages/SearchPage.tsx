import { ArrowLeft, ChevronDown, FileText, Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Key } from '../../shared/i18n.js';
import type { Excerpt, SearchHit, SearchInput, SearchMode, SearchResult } from '../../shared/search.js';
import { api, ApiError } from '../api.js';
import { Badge, Empty, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { t } from '../i18n.js';
import { useApp, usePageTitle } from '../state.js';

const MODES: [SearchMode, Key][] = [['keyword', 'Ključne besede'], ['regex', 'Regularni izraz']];
const HINTS: Record<SearchMode, Key> = {
  keyword: 'Najde tudi druge oblike besed. Točno zvezo zapišite v narekovaje, pred izključeno besedo dajte minus.',
  regex: 'Na primer \\d{1,2}\\. \\d{1,2}\\. 2027 za vse datume v letu 2027.',
};

interface Saved { form: SearchInput; result: SearchResult | null }

// Iskani izraz je shranjen v zgodovini brskalnika, ne v naslovu, da ne pride v dnevnike.
export function SearchPage() {
  usePageTitle(t('Iskanje po vsebini'));
  const { setUser } = useApp();
  const navigate = useNavigate();
  const saved = useLocation().state as Partial<Saved> | null;
  const [f, setF] = useState<SearchInput>({ query: '', mode: 'keyword', caseSensitive: false, ...saved?.form });
  const [result, setResult] = useState<SearchResult | null>(saved?.result ?? null);
  const [field, setField] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const run = async () => {
    const id = ++request.current;
    setField('');
    setError('');
    setBusy(true);
    try {
      const next = await api.search(f);
      if (id !== request.current) return;
      setResult(next);
      navigate('.', { replace: true, state: { form: f, result: next } satisfies Saved });
    } catch (err) {
      if (id !== request.current) return;
      const { message, status, fields } = err as ApiError;
      if (status === 401) return setUser(null);
      setResult(null);
      if (fields.query) setField(fields.query); else setError(message);
    }
    setBusy(false);
  };
  // Izraz, prenesen s seznama pogodb, se poišče takoj.
  const start = useRef(Boolean(saved?.form?.query) && !saved?.result);
  useEffect(() => {
    if (!start.current) return;
    start.current = false;
    void run();
  });
  const submit = (e: FormEvent) => { e.preventDefault(); void run(); };

  return (
    <>
      <Link className="back" to="/pogodbe"><Icon of={ArrowLeft} />{t('Nazaj na pogodbe')}</Link>
      <div className="page-head"><h1>{t('Iskanje po vsebini')}</h1></div>
      {error && <ErrorNotice message={error} />}
      <form className="search-form" onSubmit={submit} noValidate role="search">
        <Field id="query" label={t('Iskani izraz')} error={field} hint={t(HINTS[f.mode])}>
          {(a) => <span className="search"><Icon of={Search} /><input {...a} className="input" type="search" maxLength={300} autoComplete="off" spellCheck={false} value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} autoFocus={!result} /></span>}
        </Field>
        <Field id="mode" label={t('Način iskanja')}>
          {(a) => <span className="select"><select {...a} className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as SearchMode })}>{MODES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select><Icon of={ChevronDown} /></span>}
        </Field>
        {f.mode === 'regex' && <label className="check" htmlFor="case"><input id="case" type="checkbox" checked={f.caseSensitive} onChange={(e) => setF({ ...f, caseSensitive: e.target.checked })} />{t('Razlikuj velike in male črke')}</label>}
        <div className="form-actions"><Submit busy={busy} busyLabel={t('Iskanje')}><Icon of={Search} />{t('Išči')}</Submit></div>
      </form>
      {busy && !result && <Skeleton label={t('Iskanje')} />}
      {result && <Results result={result} />}
    </>
  );
}

function Results({ result: { hits, truncated, pending, failed } }: { result: SearchResult }) {
  return (
    <>
      {pending > 0 && <div className="notice"><div>{t('Dokumenti, ki še čakajo na obdelavo: {n}. Njihove vsebine iskanje še ne zajame.', { n: pending })}</div></div>}
      {failed > 0 && <div className="notice notice-warning"><div>{t('Dokumenti, ki jih ni bilo mogoče prebrati: {n}.', { n: failed })}</div></div>}
      <p className="filter-result" role="status">{t('Najdenih pogodb: {n}', { n: hits.length })}{truncated && ` ${t('Prikazanih je prvih 200, izraz zožite.')}`}</p>
      {hits.length === 0 ? <Empty icon={Search} title={t('Ni zadetkov')} text={t('Nobena pogodba ne ustreza iskanju.')} /> : (
        <ul className="results">{hits.map((hit) => <Hit key={hit.contract.id} hit={hit} />)}</ul>
      )}
    </>
  );
}

function Hit({ hit: { contract: c, inData, excerpts } }: { hit: SearchHit }) {
  return (
    <li className="panel">
      <div className="panel-body result">
        <div className="head-title"><h2><Link to={`/pogodbe/${c.id}`}>{c.title}</Link></h2><Badge status={c.status} /></div>
        <p className="muted">{c.party}, {t(c.category)}</p>
        {inData && <p className="field-hint">{t('Ujemanje v podatkih pogodbe.')}</p>}
        {excerpts.map((e, i) => <ExcerptLine key={i} contractId={c.id} excerpt={e} />)}
      </div>
    </li>
  );
}

function ExcerptLine({ contractId, excerpt: e }: { contractId: string; excerpt: Excerpt }) {
  const base = e.attachmentId ? `/api/contracts/${contractId}/attachments/${e.attachmentId}/file` : `/api/contracts/${contractId}/file`;
  return (
    <div className="excerpt">
      <p>{e.parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>
      <a className="link excerpt-source" href={`${base}#page=${e.page}`} target="_blank" rel="noreferrer"><Icon of={FileText} size="sm" />{t('{name}, stran {page}', { name: e.name, page: e.page })}</a>
    </div>
  );
}
