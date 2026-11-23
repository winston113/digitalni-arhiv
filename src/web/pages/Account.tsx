import { CircleCheck, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../api.js';
import { ErrorNotice, Icon, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';
import { ChangePasswordForm } from './ChangePassword.js';
import { msg, t } from '../i18n.js';

export function Account() {
  usePageTitle(t('Moj račun'));
  const { config, user } = useApp();
  return (
    <>
      <div className="page-head"><h1>{t('Moj račun')}</h1></div>
      <p className="muted">{user!.name}, {user!.email}</p>
      {config.reminders && <Reminders />}
      <section className="panel">
        <div className="panel-head"><h2>{user!.hasPassword ? t('Sprememba gesla') : t('Rezervno geslo')}</h2></div>
        <div className="panel-body"><div className="narrow">
          <p className="muted intro">{user!.hasPassword ? t('Na drugih napravah boste odjavljeni.') : t('Z geslom se lahko prijavite tudi, ko prijava prek ponudnika ne deluje.')}</p>
          <ChangePasswordForm key={String(user!.hasPassword)} first={!user!.hasPassword} />
        </div></div>
      </section>
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
    if (params.has('error')) setError(msg('Povezava je potekla ali je že bila uporabljena. Pošljite novo.'));
    else if (params.has('potrjeno')) toast(t('E-poštni naslov je potrjen.'));
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
    try { await api.setReminders(enabled); await refreshUser(); toast(enabled ? t('Opozorila so vklopljena.') : t('Opozorila so izklopljena.')); } catch (err) { setError((err as ApiError).message); }
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Opozorila po e-pošti')}</h2></div>
      <div className="panel-body stack">
        {error && <ErrorNotice message={error} />}
        {user!.emailVerified ? (
          <div>
            <label className="check" htmlFor="reminders"><input id="reminders" type="checkbox" checked={user!.reminders} onChange={(e) => toggle(e.target.checked)} />{t('Pošiljaj mi opozorila pred potekom pogodb')}</label>
            <p className="field-hint">{t('Najprej ob začetku opozorila, nato teden pred rokom za ukrepanje in ob poteku.')}</p>
          </div>
        ) : sent ? (
          <div className="notice notice-success" role="status"><Icon of={CircleCheck} /><div>{t('Povezavo za potrditev smo poslali na {email}. Velja eno uro.', { email: user!.email })}</div></div>
        ) : (
          <>
            <p>{t('Preden vam lahko pošiljamo opozorila, potrdite svoj e-poštni naslov.')}</p>
            <div className="actions"><Submit type="button" busy={busy} busyLabel={t('Pošiljanje')} className="btn btn-secondary" onClick={verify}><Icon of={Mail} />{t('Pošlji povezavo za potrditev')}</Submit></div>
          </>
        )}
      </div>
    </section>
  );
}
