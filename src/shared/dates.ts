import type { Lang } from './i18n.js';

// Vsi datumi so zapisani kot YYYY-MM-DD, brez ure in časovnega pasu.

const DAY = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function isIsoDate(value: string): boolean {
  if (!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(toUtc(value)).toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

// Današnji datum v časovnem pasu procesa oziroma brskalnika.
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string, lang: Lang = 'sl'): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return lang === 'en' ? `${d}\u00a0${MONTHS[m - 1]}\u00a0${y}` : `${d}.\u00a0${m}.\u00a0${y}`;
}

export function pluralDays(n: number, lang: Lang = 'sl'): string {
  if (lang === 'en') return n === 1 ? '1 day' : `${n} days`;
  const r = Math.abs(n) % 100;
  if (r === 1) return `${n} dan`;
  if (r === 2) return `${n} dneva`;
  return `${n} dni`;
}

// Prebere 15. 1. 2027, 15.1.2027, 15 Jan 2027, 15 January 2027 ali 2027-01-15; sicer vrne null.
export function parseDate(text: string): string | null {
  const t = text.replace(/\s/g, '');
  const en = /^(\d{1,2})([A-Za-z]{3,9}),?(\d{4})$/.exec(t);
  if (en) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === en[2]!.slice(0, 3).toLowerCase());
    const date = `${en[3]}-${String(month + 1).padStart(2, '0')}-${en[1]!.padStart(2, '0')}`;
    return month >= 0 && isIsoDate(date) ? date : null;
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(t);
  const iso = m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : t;
  return isIsoDate(iso) ? iso : null;
}
