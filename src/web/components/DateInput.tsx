import { CalendarDays } from 'lucide-react';
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { parseDate } from '../../shared/dates.js';
import { formatDate } from '../format.js';
import { Icon } from './ui.js';
import { t } from '../i18n.js';

// Besedilno polje v slovenskem zapisu; koledar brskalnika je dodatna možnost.
export function DateInput({ value, onChange, disabled, ...aria }: { value: string; onChange: (iso: string) => void }
  & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value ? formatDate(value) : '');
  const picker = useRef<HTMLInputElement>(null);
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current) { sent.current = value; setText(value ? formatDate(value) : ''); }
  }, [value]);
  const update = (iso: string) => { sent.current = iso; onChange(iso); };

  return (
    <span className="date">
      <input {...aria} className="input num" inputMode="text" autoComplete="off" placeholder={formatDate('2027-01-15')} disabled={disabled}
        value={disabled ? '' : text}
        onChange={(e) => { setText(e.target.value); update(parseDate(e.target.value) ?? e.target.value.trim()); }}
        onBlur={() => { const iso = parseDate(text); if (iso) setText(formatDate(iso)); }} />
      <button type="button" className="btn btn-icon" aria-label={t('Odpri koledar')} disabled={disabled}
        onClick={() => { try { picker.current?.showPicker(); } catch { /* brskalnik nima koledarja */ } }}><Icon of={CalendarDays} /></button>
      <input ref={picker} type="date" className="date-picker" tabIndex={-1} aria-hidden="true" disabled={disabled} value={parseDate(text) ?? ''}
        onChange={(e) => { if (e.target.value) { setText(formatDate(e.target.value)); update(e.target.value); } }} />
    </span>
  );
}
