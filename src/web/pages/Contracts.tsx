import { ChevronDown, Download, FileSearch, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CATEGORIES, sortByDeadline, STATUSES } from '../../shared/contracts.js';
import { api } from '../api.js';
import { ContractTable } from '../components/ContractTable.js';
import { Empty, ErrorNotice, Icon, Skeleton, statusName } from '../components/ui.js';
import { shownOf } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { getLang, t } from '../i18n.js';

const fold = (s: string) => s.toLocaleLowerCase(getLang()).normalize('NFD').replace(/\p{M}/gu, '');

type Filters = { q: string; kategorija: string; status: string };
const read = (p: URLSearchParams): Filters => ({ q: p.get('q') ?? '', kategorija: p.get('kategorija') ?? '', status: p.get('status') ?? '' });

export function Contracts() {
  usePageTitle(t('Pogodbe'));
  const { data, error, retry } = useLoad(api.list, []);
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => read(params));
  const { q, kategorija: category, status } = filters;

  // Naslov sledi filtrom; če se naslov spremeni drugje (povezava, nazaj), mu sledijo filtri.
  const written = useRef(params.toString());
  useEffect(() => {
    const next = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    if (next === written.current) return;
    written.current = next;
    setParams(next, { replace: true });
  }, [filters, setParams]);
  const current = params.toString();
  const seen = useRef(current);
  useEffect(() => {
    if (current === seen.current) return;
    seen.current = current;
    if (current === written.current || document.activeElement?.closest('.filters')) return;
    written.current = current;
    setFilters(read(new URLSearchParams(current)));
  }, [current]);

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => { const { value } = e.target; setFilters((x) => ({ ...x, [key]: value })); };
  const clear = () => setFilters({ q: '', kategorija: '', status: '' });

  const words = fold(q).split(/\s+/).filter(Boolean);
  const shown = (data ?? []).filter((c) => {
    const text = fold([c.title, c.party, c.number ?? ''].join(' '));
    return words.every((w) => text.includes(w)) && (!category || c.category === category) && (!status || c.status === status);
  }).sort(sortByDeadline);
  const { create } = useApp().user!.permissions;
  const add = create && <Link className="btn btn-primary" to="/pogodbe/nova"><Icon of={Plus} />{t('Nova pogodba')}</Link>;

  return (
    <>
      <div className="page-head"><h1>{t('Pogodbe')}</h1>{data && data.length > 0 && <div className="actions"><a className="btn btn-secondary" href="/api/export" download><Icon of={Download} />{t('Izvozi vse')}</a>{add}</div>}</div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label={t('Nalaganje pogodb')} />}
      {data?.length === 0 && <Empty title={t('V arhivu še ni pogodb')} text={create ? t('Dodajte prvo pogodbo in aplikacija bo spremljala njene roke.') : t('Za dodajanje pogodb nimate dovoljenja. Obrnite se na skrbnika.')}>{add}</Empty>}
      {data && data.length > 0 && (
        <>
          <div className="filters">
            <div className="field"><label className="field-label" htmlFor="q">{t('Iskanje')}</label><span className="search"><Icon of={Search} /><input id="q" className="input" type="search" placeholder={t('Naziv, stranka ali številka')} value={q} onChange={set('q')} /></span></div>
            <div className="field"><label className="field-label" htmlFor="category">{t('Kategorija')}</label><span className="select"><select id="category" className="input" value={category} onChange={set('kategorija')}><option value="">{t('Vse kategorije')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select><Icon of={ChevronDown} /></span></div>
            <div className="field"><label className="field-label" htmlFor="status">{t('Status')}</label><span className="select"><select id="status" className="input" value={status} onChange={set('status')}><option value="">{t('Vsi statusi')}</option>{STATUSES.map((s) => <option key={s} value={s}>{statusName(s)}</option>)}</select><Icon of={ChevronDown} /></span></div>
          </div>
          <div className="filter-line">
            <span className="filter-result" role="status">{shownOf(shown.length, data.length)}</span>
            <Link className="btn btn-text" to="/pogodbe/iskanje" state={{ form: { query: q } }}><Icon of={FileSearch} />{t('Iskanje po vsebini')}</Link>
            {(q || category || status) && <button type="button" className="btn btn-text" onClick={clear}>{t('Počisti filtre')}</button>}
          </div>
          {shown.length > 0 ? <ContractTable contracts={shown} />
            : <Empty icon={Search} title={t('Ni zadetkov')} text={t('Nobena pogodba ne ustreza iskanju.')}><button type="button" className="btn btn-secondary" onClick={clear}>{t('Počisti filtre')}</button></Empty>}
        </>
      )}
    </>
  );
}
