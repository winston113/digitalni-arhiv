import { CircleCheck } from 'lucide-react';
import { sortByDeadline, type Status } from '../../shared/contracts.js';
import { api } from '../api.js';
import { ContractTable } from '../components/ContractTable.js';
import { Empty, ErrorNotice, Skeleton } from '../components/ui.js';
import { useLoad, usePageTitle } from '../state.js';

const GROUPS: [Status, string][] = [['potekla', 'Pogodba je potekla'], ['kmalu', 'Rok se bliža']];

export function Alerts() {
  usePageTitle('Opozorila');
  const { data, error, retry } = useLoad(api.list, []);
  const due = data?.filter((c) => GROUPS.some(([s]) => s === c.status)).sort(sortByDeadline);
  return (
    <>
      <div className="page-head"><h1>Opozorila</h1></div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!due && !error && <Skeleton label="Nalaganje opozoril" />}
      {due?.length === 0 && <Empty icon={CircleCheck} title="Ni opozoril" text="Nobena pogodba ne zahteva ukrepanja." />}
      {due && due.length > 0 && (
        <>
          <p className="muted">Pogodbe, ki jih je treba podaljšati ali prekiniti. Izberite pogodbo in uredite njen rok.</p>
          {GROUPS.map(([status, title]) => {
            const contracts = due.filter((c) => c.status === status);
            return contracts.length > 0 && <section key={status} className="panel"><div className="panel-head"><h2>{title}</h2></div><ContractTable contracts={contracts} /></section>;
          })}
        </>
      )}
    </>
  );
}
