import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api.js';
import { AuthShell } from '../components/Shell.js';
import { ErrorNotice, Field, Submit } from '../components/ui.js';
import { useApp, usePageTitle } from '../state.js';

export function SignUp() {
  usePageTitle('Registracija');
  const { setUser } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid: Record<string, string> = {};
    if (!f.name.trim()) invalid.name = 'Vnesite ime in priimek.';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) invalid.email = 'Vnesite veljaven e-poštni naslov.';
    if (f.password.length < 8) invalid.password = 'Geslo je prekratko. Vnesite najmanj 8 znakov.';
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      await api.signUp(f.name.trim(), f.email.trim(), f.password);
      const user = await api.session();
      navigate('/', { replace: true });
      setUser(user);
    } catch (err) {
      const { message, status } = err as ApiError;
      if (status === 422) setFields({ email: message }); else setError(message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Registracija" text="Ustvarite račun za svoj arhiv pogodb.">
      {error && <ErrorNotice message={error} />}
      <form onSubmit={submit} noValidate>
        <Field id="name" label="Ime in priimek" error={fields.name}>{(a) => <input {...a} className="input" autoComplete="name" value={f.name} onChange={set('name')} />}</Field>
        <Field id="email" label="E-pošta" error={fields.email}>{(a) => <input {...a} className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
        <Field id="password" label="Geslo" hint="Najmanj 8 znakov." error={fields.password}>{(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
        <Submit busy={busy} busyLabel="Ustvarjanje računa" className="btn btn-primary btn-block">Ustvari račun</Submit>
      </form>
      <p>Že imate račun? <Link className="link" to="/prijava">Prijavite se</Link></p>
    </AuthShell>
  );
}
