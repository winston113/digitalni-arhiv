import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';

export function ChangePasswordForm() {
  const { toast, refreshUser } = useApp();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = { ...(!current && { currentPassword: 'Vnesite sedanje geslo.' }), ...(next.length < 8 && { newPassword: 'Geslo je prekratko. Vnesite najmanj 8 znakov.' }) };
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await api.changePassword(current, next);
      await refreshUser();
      toast('Geslo je spremenjeno.');
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
        <Field id="currentPassword" label="Sedanje geslo" error={fields.currentPassword}>{(a) => <input {...a} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field id="newPassword" label="Novo geslo" hint="Najmanj 8 znakov." error={fields.newPassword}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <div className="form-actions"><Submit busy={busy} busyLabel="Shranjevanje">Shrani geslo</Submit></div>
      </form>
    </>
  );
}

export function ChangePassword() {
  usePageTitle('Sprememba gesla');
  return <><div className="page-head"><h1>Sprememba gesla</h1></div><p className="muted">Na drugih napravah boste odjavljeni.</p><div className="narrow"><ChangePasswordForm /></div></>;
}
