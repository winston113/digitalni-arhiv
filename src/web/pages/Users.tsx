import { Plus, Users as UsersIcon } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { AccountBadge, Empty, ErrorNotice, Icon, Skeleton } from '../components/ui.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { t } from '../i18n.js';

export function Users() {
  usePageTitle(t('Uporabniki'));
  const { config, user: me } = useApp();
  const { data, error, retry } = useLoad(api.users, []);
  return (
    <>
      <div className="page-head"><h1>{t('Uporabniki')}</h1><Link className="btn btn-primary" to="/skrbnistvo/uporabniki/nov"><Icon of={Plus} />{t('Nov uporabnik')}</Link></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label={t('Nalaganje uporabnikov')} />}
      {data?.length === 0 && <Empty icon={UsersIcon} title={t('Ni uporabnikov')} text={t('Ustvarite prvega uporabnika.')} />}
      {data && data.length > 0 && (
        <div className="list">
          <table className="table" role="table">
            <thead role="rowgroup"><tr role="row">{[t('Uporabnik'), t('Vloga'), t('Prijava'), t('Pogodbe'), t('Stanje')].map((h) => <th key={h} role="columnheader" scope="col">{h}</th>)}</tr></thead>
            <tbody role="rowgroup">
              {data.map((u) => (
                <tr key={u.id} role="row">
                  <td role="cell" className="main"><Link className="title" to={`/skrbnistvo/uporabniki/${u.id}`}>{u.name}</Link>{u.id === me?.id && <span className="muted"> {t('(vi)')}</span>}<span className="sub">{u.email}</span></td>
                  <td role="cell" data-label={t('Vloga')}>{u.role === 'admin' ? t('Skrbnik') : t('Uporabnik')}</td>
                  <td role="cell" data-label={t('Prijava')}>{[u.hasPassword && t('Geslo'), u.hasOidc && (config.oidc?.name ?? t('Zunanji ponudnik'))].filter(Boolean).join(', ')}</td>
                  <td role="cell" className="num" data-label={t('Pogodbe')}>{u.contracts}</td>
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
