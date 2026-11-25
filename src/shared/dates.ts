import type { Lang } from './i18n.js';

// Vsi datumi so zapisani kot YYYY-MM-DD, brez ure in časovnega pasu.

const DAY = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

// Letnice od 1900 do 2999; pogodbe so lahko sklenjene tudi za več kot sto let.
export function isIsoDate(value: string): boolean {
  if (!/^(19|2\d)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
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

const MONTH_PREFIXES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, avg: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };

// Sprejme običajne zapise: 15. 1. 2027, 15/1/2027, 15-01-27, 15. januar 2027, January 15, 2027 in 2027-01-15.
// Dan je vedno pred mesecem, razen pri zapisu z imenom meseca. Za vse drugo vrne null.
export function parseDate(text: string): string | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const iso = (day: string, month: number | string | undefined, year: string): string | null => {
    // Letnica z dvema števkama: do 69 v tem stoletju, sicer v prejšnjem.
    const full = year.length === 2 ? `${Number(year) < 70 ? '20' : '19'}${year}` : year;
    const date = `${full}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
    return isIsoDate(date) ? date : null;
  };
  const numbers = /^(\d{1,2}) ?[./-] ?(\d{1,2}) ?[./-] ?(\d{4}|\d{2})\.?$/.exec(t);
  if (numbers) return iso(numbers[1]!, numbers[2]!, numbers[3]!);
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th|\.)? ?([a-z]{3,9})\.?,? ?(\d{4})\.?$/.exec(t);
  if (dayFirst) return iso(dayFirst[1]!, MONTH_PREFIXES[dayFirst[2]!.slice(0, 3)], dayFirst[3]!);
  const monthFirst = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(t);
  if (monthFirst) return iso(monthFirst[2]!, MONTH_PREFIXES[monthFirst[1]!.slice(0, 3)], monthFirst[3]!);
  return isIsoDate(t) ? t : null;
}
