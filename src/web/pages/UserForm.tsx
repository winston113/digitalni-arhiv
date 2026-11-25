import { ArrowLeft, Ban, KeyRound, Mail, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fieldErrors } from '../../shared/contracts.js';
import { today } from '../../shared/dates.js';
import { formatDate } from '../format.js';
import { passwordReset, userCreate, userUpdate, type ManagedUser, type Role } from '../../shared/users.js';
import { api, ApiError } from '../api.js';
import { AccountBadge, ConfirmDialog, Dialog, ErrorNotice, Field, Icon, Skeleton, Submit } from '../components/ui.js';
import { generatePassword, PermissionFields, RoleField, TemporaryPassword } from '../components/UserFields.js';
import { useApp, useLoad, usePageTitle } from '../state.js';
import { NotFound } from './NotFound.js';
import { t } from '../i18n.js';

const ALL = { create: true, edit: true, remove: true, ai: false };
const Back = () => <Link className="back" to="/skrbnistvo/uporabniki"><Icon of={ArrowLeft} />{t('Nazaj na uporabnike')}</Link>;

export function NewUser() {
  usePageTitle(t('Nov uporabnik'));
  const { toast } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState(() => ({ name: '', email: '', password: generatePassword(), mustChangePassword: true, role: 'user' as Role, permissions: ALL }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = userCreate.safeParse(f);
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.createUser(parsed.data);
      toast(t('Uporabnik je ustvarjen.'));
      navigate('/skrbnistvo/uporabniki', { replace: true });
    } catch (err) {
      const { message, fields: invalid } = err as ApiError;
      setFields(invalid);
      if (!Object.keys(invalid).length) setError(message);
      setBusy(false);
    }
  };
  return (
    <>
      <Back />
      <div className="page-head"><h1>{t('Nov uporabnik')}</h1></div>
      {error && <ErrorNotice message={error} />}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="name" label={t('Ime in priimek')} error={fields.name} full>{(a) => <input {...a} className="input" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field id="email" label={t('E-pošta')} error={fields.email} full>{(a) => <input {...a} className="input" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <TemporaryPassword value={f.password} onChange={(password) => setF({ ...f, password })} must={f.mustChangePassword} onMust={(mustChangePassword) => setF({ ...f, mustChangePassword })} error={fields.password} />
        <RoleField value={f.role} onChange={(role) => setF({ ...f, role })} error={fields.role} />
        <PermissionFields value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} />
        <div className="form-actions full"><Submit busy={busy} busyLabel={t('Ustvarjanje')}>{t('Ustvari uporabnika')}</Submit><Link className="btn btn-secondary" to="/skrbnistvo/uporabniki">{t('Prekliči')}</Link></div>
      </form>
    </>
  );
}

export function EditUser() {
  const { id = '' } = useParams();
  const { data, setData, error, retry } = useLoad(() => api.user(id), [id]);
  if (error?.status === 404) return <NotFound title={t('Uporabnik ne obstaja')} text={t('Morda je bil izbrisan.')} to="/skrbnistvo/uporabniki" label={t('Na seznam uporabnikov')} />;
  if (error) return <ErrorNotice message={error.message} retry={retry} />;
  if (!data || data.id !== id) return <Skeleton label={t('Nalaganje uporabnika')} />;
  return <Editor key={data.id} u={data} onChange={setData} />;
}

function Editor({ u, onChange }: { u: ManagedUser; onChange: (u: ManagedUser) => void }) {
  usePageTitle(u.name);
  const { config, user: me, toast, refreshUser } = useApp();
  const navigate = useNavigate();
  const self = u.id === me?.id;
  const [f, setF] = useState({ name: u.name, role: u.role, permissions: u.permissions });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'password' | 'block' | 'remove' | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = userUpdate.safeParse({ ...f, disabled: u.disabled });
    setFields(parsed.success ? {} : fieldErrors(parsed.error));
    setError('');
    if (!parsed.success) return;
    setBusy(true);
    try {
      onChange(await api.updateUser(u.id, parsed.data));
      if (self) refreshUser();
      toast(t('Uporabnik je shranjen.'));
    } catch (err) { setError((err as ApiError).message); }
    setBusy(false);
  };
  const setDisabled = async (disabled: boolean) => {
    onChange(await api.updateUser(u.id, { name: u.name, role: u.role, permissions: u.permissions, disabled }));
    setDialog(null);
    toast(disabled ? t('Uporabnik je blokiran.') : t('Uporabnik je odblokiran.'));
  };
  const sendLink = () => { setError(''); api.sendResetLink(u.id).then(() => toast(t('Povezava je poslana na {email}.', { email: u.email })), (err: ApiError) => setError(err.message)); };
  const unblock = () => setDisabled(false).catch((err: ApiError) => setError(err.message));

  return (
    <>
      <Back />
      <div className="page-head"><div className="head-title"><h1>{u.name}</h1><AccountBadge disabled={u.disabled} /></div></div>
      <p className="muted">{t('{email}, račun ustvarjen {date}', { email: u.email, date: formatDate(today(new Date(u.createdAt))) })}</p>
      {error && <ErrorNotice message={error} />}
      {!self && (
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => setDialog('password')}><Icon of={KeyRound} />{t('Ponastavi geslo')}</button>
          {config.passwordReset && <button type="button" className="btn btn-secondary" onClick={sendLink}><Icon of={Mail} />{t('Pošlji povezavo za geslo')}</button>}
          {u.disabled
            ? <button type="button" className="btn btn-secondary" onClick={unblock}>{t('Odblokiraj')}</button>
            : <button type="button" className="btn btn-secondary" onClick={() => setDialog('block')}><Icon of={Ban} />{t('Blokiraj')}</button>}
          <button type="button" className="btn btn-text btn-text-danger" onClick={() => setDialog('remove')}><Icon of={Trash2} />{t('Izbriši')}</button>
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="name" label={t('Ime in priimek')} error={fields.name} full>{(a) => <input {...a} className="input" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <RoleField value={f.role} onChange={(role) => setF({ ...f, role })} disabled={self} error={fields.role} />
        <PermissionFields value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} />
        <div className="form-actions full"><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Shrani uporabnika')}</Submit></div>
      </form>
      {dialog === 'password' && <ResetDialog u={u} close={() => setDialog(null)} done={(next) => { onChange(next); setDialog(null); toast(t('Geslo je ponastavljeno.')); }} />}
      {dialog === 'block' && <ConfirmDialog title={t('Blokiranje uporabnika')} label={t('Blokiraj')} busyLabel={t('Blokiranje')} close={() => setDialog(null)} run={() => setDisabled(true)} text={t('Uporabnik {name} bo takoj odjavljen na vseh napravah in se ne bo mogel prijaviti. Pogodbe ostanejo shranjene.', { name: u.name })} />}
      {dialog === 'remove' && <ConfirmDialog title={t('Brisanje uporabnika')} label={t('Izbriši uporabnika')} busyLabel={t('Brisanje')} close={() => setDialog(null)}
        run={async () => { await api.removeUser(u.id); toast(t('Uporabnik je izbrisan.')); navigate('/skrbnistvo/uporabniki', { replace: true }); }}
        text={t('Račun {email} bo trajno izbrisan skupaj z vsemi pogodbami in datotekami. Število pogodb: {n}.', { email: u.email, n: u.contracts })} />}
    </>
  );
}

function ResetDialog({ u, close, done }: { u: ManagedUser; close: () => void; done: (u: ManagedUser) => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [must, setMust] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = passwordReset.safeParse({ password, mustChangePassword: must });
    if (!parsed.success) return setError(fieldErrors(parsed.error).password ?? '');
    setBusy(true);
    try { done(await api.setUserPassword(u.id, parsed.data)); } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };
  return (
    <Dialog title={t('Ponastavitev gesla')} onClose={close}>
      <p>{t('Uporabnik {name} bo odjavljen na vseh napravah.', { name: u.name })}</p>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <TemporaryPassword value={password} onChange={setPassword} must={must} onMust={setMust} error={error} />
        <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={close}>{t('Prekliči')}</button><Submit busy={busy} busyLabel={t('Shranjevanje')}>{t('Ponastavi geslo')}</Submit></div>
      </form>
    </Dialog>
  );
}
