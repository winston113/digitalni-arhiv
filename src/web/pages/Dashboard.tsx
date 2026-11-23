import { CircleCheck, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { sortByDeadline, STATUSES } from '../../shared/contracts.js';
import { formatDate, today } from '../../shared/dates.js';
import { api } from '../api.js';
import { ContractTable } from '../components/ContractTable.js';
import { Badge, Empty, ErrorNotice, Icon, Skeleton } from '../components/ui.js';
import { useLoad, usePageTitle } from '../state.js';

export function Dashboard() {
  usePageTitle('Nadzorna plošča');
  const { data, error, retry } = useLoad(api.list, []);
  const add = <Link className="btn btn-primary" to="/pogodbe/nova"><Icon of={Plus} />Nova pogodba</Link>;
  const upcoming = data?.filter((c) => c.status !== 'prekinjena' && c.actionDate !== null).sort(sortByDeadline).slice(0, 3) ?? [];
  const recent = data ? [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3) : [];

  return (
    <>
      <div className="page-head"><h1>Nadzorna plošča</h1>{data && data.length > 0 && add}</div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label="Nalaganje pogodb" />}
      {data?.length === 0 && <Empty title="V arhivu še ni pogodb" text="Dodajte prvo pogodbo in aplikacija bo spremljala njene roke.">{add}</Empty>}
      {data && data.length > 0 && (
        <>
          <div className="counts">
            {STATUSES.map((s) => (
              <Link key={s} className="count" to={`/pogodbe?status=${s}`}>
                <span className="count-value">{data.filter((c) => c.status === s).length}</span><Badge status={s} />
              </Link>
            ))}
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Najbližji roki</h2><Link className="btn btn-text" to="/opozorila">Vsa opozorila</Link></div>
            {upcoming.length > 0 ? <ContractTable contracts={upcoming} />
              : <div className="empty"><Icon of={CircleCheck} size="lg" /><p>Nobena pogodba nima prihajajočega roka.</p></div>}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Nazadnje dodane</h2></div>
            <ul className="recent">
              {recent.map((c) => <li key={c.id}><Link to={`/pogodbe/${c.id}`}>{c.title}</Link><span className="muted num">{formatDate(today(new Date(c.createdAt)))}</span></li>)}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
