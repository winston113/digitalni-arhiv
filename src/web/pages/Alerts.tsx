import { CircleCheck } from 'lucide-react';
import { sortByDeadline, type Status } from '../../shared/contracts.js';
import type { Key } from '../../shared/i18n.js';
import { api } from '../api.js';
import { ContractTable } from '../components/ContractTable.js';
import { Empty, ErrorNotice, Skeleton } from '../components/ui.js';
import { useLoad, usePageTitle } from '../state.js';
import { t } from '../i18n.js';

const GROUPS: [Status, Key][] = [['potekla', 'Pogodba je potekla'], ['kmalu', 'Rok se bliža']];

export function Alerts() {
  usePageTitle(t('Opozorila'));
  const { data, error, retry } = useLoad(api.list, []);
  const due = data?.filter((c) => GROUPS.some(([s]) => s === c.status)).sort(sortByDeadline);
  return (
    <>
      <div className="page-head"><h1>{t('Opozorila')}</h1></div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!due && !error && <Skeleton label={t('Nalaganje opozoril')} />}
      {due?.length === 0 && <Empty icon={CircleCheck} title={t('Ni opozoril')} text={t('Nobena pogodba ne zahteva ukrepanja.')} />}
      {due && due.length > 0 && (
        <>
          <p className="muted">{t('Pogodbe, ki jih je treba podaljšati ali prekiniti. Izberite pogodbo in uredite njen rok.')}</p>
          {GROUPS.map(([status, title]) => {
            const contracts = due.filter((c) => c.status === status);
            return contracts.length > 0 && <section key={status} className="panel"><div className="panel-head"><h2>{t(title)}</h2></div><ContractTable contracts={contracts} /></section>;
          })}
        </>
      )}
    </>
  );
}
