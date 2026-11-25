import type { Upload } from '../../shared/uploads.js';
import { t } from '../i18n.js';
import { useApp } from '../state.js';
import type { FormValues } from './ContractForm.js';

// Pogodba, ki čaka na svoj obrazec: datoteka in priloge so že na strežniku.
export interface QueueItem { upload: Upload; attachments: Upload[] }
export interface QueueOptions { auto: boolean; defaults: Partial<FormValues> }

export function ReadAll({ value, onChange, count }: { value: boolean; onChange: (v: boolean) => void; count: number }) {
  const { user } = useApp();
  if (!user?.ai) return null;
  return (
    <div className="field">
      <label className="check" htmlFor="read-all"><input id="read-all" type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{t('Samodejno izpolni obrazce iz datotek')}</label>
      <span className="field-hint">{t('Besedilo vseh pogodb se pošlje na {destination}, kjer ga prebere umetna inteligenca. Porabljenih branj: {n}.', { destination: user.ai.destination, n: count })}</span>
    </div>
  );
}
