import { ChevronDown, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CATEGORIES, sortByDeadline, STATUSES } from '../../shared/contracts.js';
import { api } from '../api.js';
import { ContractTable } from '../components/ContractTable.js';
import { Empty, ErrorNotice, Icon, Skeleton, STATUS_NAMES } from '../components/ui.js';
import { pluralContracts } from '../format.js';
import { useApp, useLoad, usePageTitle } from '../state.js';

const fold = (s: string) => s.toLocaleLowerCase('sl').normalize('NFD').replace(/\p{M}/gu, '');

type Filters = { q: string; kategorija: string; status: string };
const read = (p: URLSearchParams): Filters => ({ q: p.get('q') ?? '', kategorija: p.get('kategorija') ?? '', status: p.get('status') ?? '' });

export function Contracts() {
  usePageTitle('Pogodbe');
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
  const add = create && <Link className="btn btn-primary" to="/pogodbe/nova"><Icon of={Plus} />Nova pogodba</Link>;

  return (
    <>
      <div className="page-head"><h1>Pogodbe</h1>{data && data.length > 0 && add}</div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label="Nalaganje pogodb" />}
      {data?.length === 0 && <Empty title="V arhivu še ni pogodb" text={create ? 'Dodajte prvo pogodbo in aplikacija bo spremljala njene roke.' : 'Za dodajanje pogodb nimate dovoljenja. Obrnite se na skrbnika.'}>{add}</Empty>}
      {data && data.length > 0 && (
        <>
          <div className="filters">
            <div className="field"><label className="field-label" htmlFor="q">Iskanje</label><span className="search"><Icon of={Search} /><input id="q" className="input" type="search" placeholder="Naziv, stranka ali številka" value={q} onChange={set('q')} /></span></div>
            <div className="field"><label className="field-label" htmlFor="category">Kategorija</label><span className="select"><select id="category" className="input" value={category} onChange={set('kategorija')}><option value="">Vse kategorije</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select><Icon of={ChevronDown} /></span></div>
            <div className="field"><label className="field-label" htmlFor="status">Status</label><span className="select"><select id="status" className="input" value={status} onChange={set('status')}><option value="">Vsi statusi</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_NAMES[s]}</option>)}</select><Icon of={ChevronDown} /></span></div>
          </div>
          <div className="filter-line">
            <span className="filter-result" role="status">Prikazanih {shown.length} od {data.length} {pluralContracts(data.length)}</span>
            {(q || category || status) && <button type="button" className="btn btn-text" onClick={clear}>Počisti filtre</button>}
          </div>
          {shown.length > 0 ? <ContractTable contracts={shown} />
            : <Empty icon={Search} title="Ni zadetkov" text="Nobena pogodba ne ustreza iskanju."><button type="button" className="btn btn-secondary" onClick={clear}>Počisti filtre</button></Empty>}
        </>
      )}
    </>
  );
}
