import { Ban, CircleAlert, CircleCheck, CircleX, Clock, FileText, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import type { Status } from '../../shared/contracts.js';
import type { Key } from '../../shared/i18n.js';
import type { ApiError } from '../api.js';
import { t, tr } from '../i18n.js';

export function Icon({ of: Glyph, size = '' }: { of: LucideIcon; size?: '' | 'sm' | 'lg' }) {
  return <Glyph className={size ? `icon icon-${size}` : 'icon'} aria-hidden="true" />;
}

const BADGES: Record<Status, [string, Key, LucideIcon]> = {
  aktivna: ['badge-active', 'Aktivna', CircleCheck],
  kmalu: ['badge-soon', 'Kmalu poteče', Clock],
  potekla: ['badge-expired', 'Potekla', CircleX],
  prekinjena: ['badge-ended', 'Prekinjena', Ban],
};
export const statusName = (s: Status) => t(BADGES[s][1]);

export function Badge({ status }: { status: Status }) {
  const [cls, label, icon] = BADGES[status];
  return <span className={`badge ${cls}`}><Icon of={icon} size="sm" />{t(label)}</span>;
}

export function AccountBadge({ disabled }: { disabled: boolean }) {
  return disabled
    ? <span className="badge badge-ended"><Icon of={Ban} size="sm" />{t('Blokiran')}</span>
    : <span className="badge badge-active"><Icon of={CircleCheck} size="sm" />{t('Dejaven')}</span>;
}

export function Submit({ busy, busyLabel, children, className = 'btn btn-primary', onClick, ...rest }:
  { busy: boolean; busyLabel: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="submit" className={className} aria-busy={busy} {...rest} onClick={busy ? (e) => e.preventDefault() : onClick}>
      {busy ? <><Icon of={LoaderCircle} />{busyLabel}</> : children}
    </button>
  );
}

export function Field({ id, label, optional, hint, error, full, children }: {
  id: string; label: string; optional?: boolean; hint?: string; error?: string; full?: boolean;
  children: (aria: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const describedBy = error || hint ? `${id}-opis` : undefined;
  return (
    <div className={full ? 'field full' : 'field'}>
      <label className="field-label" htmlFor={id}>{label}{optional && <span className="muted"> ({t('neobvezno')})</span>}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error
        ? <span className="field-error" id={describedBy}><Icon of={CircleAlert} size="sm" />{tr(error)}</span>
        : hint && <span className="field-hint" id={describedBy}>{hint}</span>}
    </div>
  );
}

export function ErrorNotice({ message, detail, retry }: { message: string; detail?: string; retry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <Icon of={CircleAlert} />
      <div>{tr(message)}{detail && <> {t('Odgovor strežnika: {detail}', { detail })}</>}{retry && <> <button type="button" className="btn btn-text" onClick={retry}>{t('Poskusi znova')}</button></>}</div>
    </div>
  );
}

export function Empty({ icon = FileText, title, text, children }: { icon?: LucideIcon; title: string; text: string; children?: ReactNode }) {
  return <div className="panel empty"><Icon of={icon} size="lg" /><h2>{title}</h2><p>{text}</p>{children}</div>;
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="panel"><div className="panel-body stack" aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {[45, 80, 60, 72, 52].map((w) => <span key={w} className="skeleton" style={{ width: `${w}%` }} />)}
    </div></div>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { dialog.close(); opener?.focus(); };
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

export function ConfirmDialog({ title, text, label, busyLabel, run, close }: { title: string; text: string; label: string; busyLabel: string; run: () => Promise<void>; close: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await run(); } catch (err) { setError((err as ApiError).message); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={close}>
      <p>{text}</p>
      {error && <ErrorNotice message={error} />}
      <form className="dialog-actions" onSubmit={submit}>
        <button type="button" className="btn btn-secondary" onClick={close} data-autofocus>{t('Prekliči')}</button>
        <Submit busy={busy} busyLabel={busyLabel} className="btn btn-danger">{label}</Submit>
      </form>
    </Dialog>
  );
}
