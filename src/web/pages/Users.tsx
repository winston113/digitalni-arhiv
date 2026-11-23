import { Plus, Users as UsersIcon } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api.js';
import { AccountBadge, Empty, ErrorNotice, Icon, Skeleton } from '../components/ui.js';
import { useApp, useLoad, usePageTitle } from '../state.js';

export function Users() {
  usePageTitle('Uporabniki');
  const { config, user: me } = useApp();
  const { data, error, retry } = useLoad(api.users, []);
  return (
    <>
      <div className="page-head"><h1>Uporabniki</h1>{config.localLogin && <Link className="btn btn-primary" to="/uporabniki/nov"><Icon of={Plus} />Nov uporabnik</Link>}</div>
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label="Nalaganje uporabnikov" />}
      {data?.length === 0 && <Empty icon={UsersIcon} title="Ni uporabnikov" text="Ustvarite prvega uporabnika." />}
      {data && data.length > 0 && (
        <div className="list">
          <table className="table" role="table">
            <thead role="rowgroup"><tr role="row">{['Uporabnik', 'Vloga', 'Prijava', 'Pogodbe', 'Stanje'].map((h) => <th key={h} role="columnheader" scope="col">{h}</th>)}</tr></thead>
            <tbody role="rowgroup">
              {data.map((u) => (
                <tr key={u.id} role="row">
                  <td role="cell" className="main"><Link className="title" to={`/uporabniki/${u.id}`}>{u.name}</Link>{u.id === me?.id && <span className="muted"> (vi)</span>}<span className="sub">{u.email}</span></td>
                  <td role="cell" data-label="Vloga">{u.role === 'admin' ? 'Skrbnik' : 'Uporabnik'}</td>
                  <td role="cell" data-label="Prijava">{[u.hasPassword && 'Geslo', u.hasOidc && (config.oidc?.name ?? 'Zunanji ponudnik')].filter(Boolean).join(', ')}</td>
                  <td role="cell" className="num" data-label="Pogodbe">{u.contracts}</td>
                  <td role="cell"><AccountBadge disabled={u.disabled} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
