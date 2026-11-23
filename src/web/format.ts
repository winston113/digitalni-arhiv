import type { ContractView, ValuePeriod } from '../shared/contracts.js';
import { formatDate, pluralDays } from '../shared/dates.js';

const PERIOD: Record<ValuePeriod, string> = { enkratno: '', mesecno: ' na mesec', letno: ' na leto' };
const money = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatValue = (cents: number, period: ValuePeriod) => `${money.format(cents / 100)} €${PERIOD[period]}`;
export const formatSize = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;

export function deadline(c: ContractView): { date: string; note: string } {
  if (c.actionDate === null || c.daysLeft === null) return { date: 'Nedoločen čas', note: '' };
  const note = c.status === 'prekinjena' ? ''
    : c.daysLeft < 0 ? 'rok je minil' : c.daysLeft === 0 ? 'danes' : `čez ${pluralDays(c.daysLeft)}`;
  return { date: formatDate(c.actionDate), note };
}

// Sprejme 480, 480,5, 1.250,00 in 1250.00. Vrne null za prazno in NaN za neveljavno.
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s €]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100);
  if (/^\d+([.,]\d{1,2})?$/.test(t)) return Math.round(Number(t.replace(',', '.')) * 100);
  return NaN;
}

export function pluralContracts(n: number): string {
  const r = n % 100;
  return r === 1 ? 'pogodbe' : 'pogodb';
}
