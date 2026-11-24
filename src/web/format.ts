import type { ContractView, ValuePeriod } from '../shared/contracts.js';
import { formatDate as formatIn, pluralDays as daysIn } from '../shared/dates.js';
import { getLang, t } from './i18n.js';

export const formatDate = (iso: string) => formatIn(iso, getLang());
export const pluralDays = (n: number) => daysIn(n, getLang());

export function formatValue(cents: number, period: ValuePeriod): string {
  const amount = new Intl.NumberFormat(getLang() === 'en' ? 'en-GB' : 'de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  const text = getLang() === 'en' ? `€${amount}` : `${amount} €`;
  return period === 'mesecno' ? t('{amount} na mesec', { amount: text }) : period === 'letno' ? t('{amount} na leto', { amount: text }) : text;
}

export function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} kB`;
  const mb = (bytes / 1_000_000).toFixed(1);
  return `${getLang() === 'en' ? mb : mb.replace('.', ',')} MB`;
}

export function formatTime(d: Date): string {
  const min = String(d.getMinutes()).padStart(2, '0');
  return getLang() === 'en' ? `${String(d.getHours()).padStart(2, '0')}:${min}` : `${d.getHours()}.${min}`;
}

export function deadline(c: ContractView): { date: string; note: string } {
  if (c.actionDate === null || c.daysLeft === null) return { date: t('Nedoločen čas'), note: '' };
  const note = c.status === 'prekinjena' ? ''
    : c.daysLeft < 0 ? t('rok je minil') : c.daysLeft === 0 ? t('danes') : t('čez {days}', { days: pluralDays(c.daysLeft) });
  return { date: formatDate(c.actionDate), note };
}

export function shownOf(shown: number, total: number): string {
  if (getLang() === 'en') return `Showing ${shown} of ${total} ${total === 1 ? 'contract' : 'contracts'}`;
  return `Prikazanih ${shown} od ${total} ${total % 100 === 1 ? 'pogodbe' : 'pogodb'}`;
}
