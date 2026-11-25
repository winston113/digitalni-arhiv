import { ChevronDown, RefreshCw } from 'lucide-react';
import type { Permissions, Role } from '../../shared/users.js';
import type { Key } from '../../shared/i18n.js';
import { Field, Icon } from './ui.js';
import { t } from '../i18n.js';

const PERMISSION_LABELS: [keyof Permissions, Key][] = [
  ['create', 'Dodajanje pogodb'],
  ['edit', 'Urejanje, podaljšanje in prekinitev'],
  ['remove', 'Brisanje pogodb'],
];

// Brez znakov, ki jih je mogoče zamenjati (0/O, 1/l/I).
export function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) if (byte < limit && out.length < 16) out += alphabet[byte % alphabet.length];
  }
  return out.match(/.{4}/g)!.join('-');
}

export function RoleField({ value, onChange, disabled, error }: { value: Role; onChange: (r: Role) => void; disabled?: boolean; error?: string }) {
  return (
    <Field id="role" label={t('Vloga')} full error={error} hint={disabled ? t('Svoje vloge ne morete spremeniti.') : t('Skrbnik upravlja uporabnike. Tujih pogodb ne vidi.')}>
      {(a) => <span className="select"><select {...a} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)}><option value="user">{t('Uporabnik')}</option><option value="admin">{t('Skrbnik')}</option></select><Icon of={ChevronDown} /></span>}
    </Field>
  );
}

export function PermissionFields({ value, onChange }: { value: Permissions; onChange: (p: Permissions) => void }) {
  return (
    <fieldset className="fieldset full">
      <legend className="field-label">{t('Dovoljenja za lastne pogodbe')}</legend>
      {PERMISSION_LABELS.map(([key, label]) => (
        <label key={key} className="check" htmlFor={`p-${key}`}><input id={`p-${key}`} type="checkbox" checked={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} />{t(label)}</label>
      ))}
      <label className="check" htmlFor="p-ai"><input id="p-ai" type="checkbox" checked={value.ai} onChange={(e) => onChange({ ...value, ai: e.target.checked })} />{t('Branje podatkov iz datoteke z umetno inteligenco')}</label>
      <span className="field-hint">{t('Ogled in prenos lastnih pogodb sta vedno mogoča.')}</span>
    </fieldset>
  );
}

export function TemporaryPassword({ value, onChange, must, onMust, error }: { value: string; onChange: (v: string) => void; must: boolean; onMust: (v: boolean) => void; error?: string }) {
  return (
    <div className="stack full">
      <Field id="newUserPassword" label={t('Geslo')} error={error} hint={t('Geslo prepišite ali kopirajte zdaj, pozneje ne bo več vidno.')}>
        {(a) => <span className="with-button"><input {...a} className="input num" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} /><button type="button" className="btn btn-secondary" onClick={() => onChange(generatePassword())}><Icon of={RefreshCw} />{t('Ustvari')}</button></span>}
      </Field>
      <label className="check" htmlFor="must"><input id="must" type="checkbox" checked={must} onChange={(e) => onMust(e.target.checked)} />{t('Uporabnik mora ob naslednji prijavi spremeniti geslo')}</label>
    </div>
  );
}
