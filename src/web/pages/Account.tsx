import { CircleCheck, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { ErrorNotice, Icon, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';
import { ChangePasswordForm } from './ChangePassword.js';

export function Account() {
  usePageTitle('Moj račun');
  const { config, user } = useApp();
  return (
    <>
      <div className="page-head"><h1>Moj račun</h1></div>
      <p className="muted">{user!.name}, {user!.email}</p>
      {config.reminders && <Reminders />}
      {user!.hasPassword && (
        <section className="panel">
          <div className="panel-head"><h2>Sprememba gesla</h2></div>
          <div className="panel-body"><div className="narrow"><p className="muted intro">Na drugih napravah boste odjavljeni.</p><ChangePasswordForm /></div></div>
        </section>
      )}
    </>
  );
}

function Reminders() {
  const { user, toast, refreshUser } = useApp();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.has('error')) setError('Povezava je potekla ali je že bila uporabljena. Pošljite novo.');
    else if (params.has('potrjeno')) toast('E-poštni naslov je potrjen.');
    else return;
    setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const verify = async () => {
    setError('');
    setBusy(true);
    try { await api.sendVerification(user!.email); setSent(true); } catch (err) { setError((err as ApiError).message); }
    setBusy(false);
  };
  const toggle = async (enabled: boolean) => {
    setError('');
    try { await api.setReminders(enabled); await refreshUser(); toast(enabled ? 'Opozorila so vklopljena.' : 'Opozorila so izklopljena.'); } catch (err) { setError((err as ApiError).message); }
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Opozorila po e-pošti</h2></div>
      <div className="panel-body stack">
        {error && <ErrorNotice message={error} />}
        {user!.emailVerified ? (
          <div>
            <label className="check" htmlFor="reminders"><input id="reminders" type="checkbox" checked={user!.reminders} onChange={(e) => toggle(e.target.checked)} />Pošiljaj mi opozorila pred potekom pogodb</label>
            <p className="field-hint">Najprej ob začetku opozorila, nato teden pred rokom za ukrepanje in ob poteku.</p>
          </div>
        ) : sent ? (
          <div className="notice notice-success" role="status"><Icon of={CircleCheck} /><div>Povezavo za potrditev smo poslali na {user!.email}. Velja eno uro.</div></div>
        ) : (
          <>
            <p>Preden vam lahko pošiljamo opozorila, potrdite svoj e-poštni naslov.</p>
            <div className="actions"><Submit type="button" busy={busy} busyLabel="Pošiljanje" className="btn btn-secondary" onClick={verify}><Icon of={Mail} />Pošlji povezavo za potrditev</Submit></div>
          </>
        )}
      </div>
    </section>
  );
}
