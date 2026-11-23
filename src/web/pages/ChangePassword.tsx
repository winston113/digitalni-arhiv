import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { useApp } from '../state.js';
import { msg, t } from '../i18n.js';

// Brez sedanjega gesla (first) za uporabnike, ki so se doslej prijavljali samo prek ponudnika.
export function ChangePasswordForm({ first = false }: { first?: boolean }) {
  const { toast, refreshUser } = useApp();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = { ...(!first && !current && { currentPassword: msg('Vnesite sedanje geslo.') }), ...(next.length < 8 && { newPassword: msg('Geslo je prekratko. Vnesite najmanj 8 znakov.') }) };
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await (first ? api.firstPassword(next) : api.changePassword(current, next));
      await refreshUser();
      toast(first ? t('Geslo je nastavljeno.') : t('Geslo je spremenjeno.'));
      navigate('/', { replace: true });
    } catch (err) {
      const { message, fields: bad } = err as ApiError;
      setFields(bad);
      if (!Object.keys(bad).length) setError(message);
      setBusy(false);
    }
  };
  return (
    <>
      {error && <ErrorNotice message={error} />}
      <form className="stack" onSubmit={submit} noValidate>
        {!first && <Field id="currentPassword" label={t('Sedanje geslo')} error={fields.currentPassword}>{(a) => <input {...a} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>}
        <Field id="newPassword" label={t('Novo geslo')} hint={t('Najmanj 8 znakov.')} error={fields.newPassword}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <div className="form-actions"><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Shrani geslo')}</Submit></div>
      </form>
    </>
  );
}
