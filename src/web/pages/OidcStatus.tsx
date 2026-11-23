import { CircleCheck, CircleAlert } from 'lucide-react';
import { api } from '../api.js';
import { AdminTabs } from '../components/AdminTabs.js';
import { ErrorNotice, Icon, Skeleton } from '../components/ui.js';
import { useLoad, usePageTitle } from '../state.js';

export function OidcStatus() {
  usePageTitle('Zunanja prijava');
  const { data, error, retry } = useLoad(api.oidc, []);
  return (
    <>
      <div className="page-head"><h1>Zunanja prijava</h1></div>
      <AdminTabs />
      {error && <ErrorNotice message={error.message} retry={retry} />}
      {!data && !error && <Skeleton label="Nalaganje nastavitev" />}
      {data && (
        <section className="panel">
          <div className="panel-head"><h2>OpenID Connect</h2></div>
          <div className="panel-body stack">
            {data.issuer
              ? <div className="notice notice-success"><Icon of={CircleCheck} /><div>Prijava prek ponudnika {data.name} je nastavljena.</div></div>
              : <div className="notice notice-warning"><Icon of={CircleAlert} /><div>Ponudnik ni nastavljen, zato gumba na prijavi in registraciji ni. Nastavite <code>OIDC_ISSUER</code> in <code>OIDC_CLIENT_ID</code> v okolju vsebnika ter ga znova zaženite.</div></div>}
            <dl className="data">
              <div style={{ gridColumn: '1 / -1' }}><dt>Naslov za preusmeritev (vnesite ga pri ponudniku)</dt><dd><code>{data.redirectUri}</code></dd></div>
              {data.issuer && (
                <>
                  <div><dt>Ponudnik</dt><dd>{data.issuer}</dd></div>
                  <div><dt>Odjemalec</dt><dd>{data.clientId}</dd></div>
                  <div><dt>Način</dt><dd>{data.hasSecret ? 'S skrivnostjo in PKCE' : 'PKCE brez skrivnosti'}</dd></div>
                  <div><dt>Registracija prek ponudnika</dt><dd>{data.registration ? 'Vklopljena' : 'Izklopljena'}</dd></div>
                </>
              )}
            </dl>
          </div>
        </section>
      )}
    </>
  );
}
