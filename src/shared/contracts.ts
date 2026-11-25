import { z } from 'zod';
import type { Key } from './i18n.js';
import type { TextState } from './search.js';
import { addDays, daysBetween, isIsoDate } from './dates.js';

export const CATEGORIES = [
  'Najem', 'Dobava', 'Storitve', 'Zaposlitev', 'Zavarovanje', 'Licence in naročnine', 'Drugo',
] as const;

export const VALUE_PERIODS = ['enkratno', 'mesecno', 'letno'] as const;
export const STATUSES = ['aktivna', 'kmalu', 'potekla', 'prekinjena'] as const;

export type Category = (typeof CATEGORIES)[number];
export type ValuePeriod = (typeof VALUE_PERIODS)[number];
export type Status = (typeof STATUSES)[number];

const isoDate = (message: string) => z.string({ error: message }).refine(isIsoDate, { error: message });
const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, { error: message }).nullish().transform((v) => v || null);
const wholeDays = (message: string) =>
  z.number({ error: message }).int({ error: message }).min(0, { error: message }).max(3650, { error: message });

export const contractInput = z
  .object({
    title: z.string({ error: 'Vnesite naziv pogodbe.' }).trim().min(1, { error: 'Vnesite naziv pogodbe.' }).max(200, { error: 'Naziv je predolg. Največ 200 znakov.' }),
    party: z.string({ error: 'Vnesite pogodbeno stranko.' }).trim().min(1, { error: 'Vnesite pogodbeno stranko.' }).max(200, { error: 'Ime stranke je predolgo. Največ 200 znakov.' }),
    category: z.enum(CATEGORIES, { error: 'Izberite kategorijo.' }),
    number: optionalText(60, 'Številka je predolga. Največ 60 znakov.'),
    startDate: isoDate('Vnesite datum začetka, na primer 15. 1. 2027.'),
    endDate: isoDate('Vnesite datum poteka, na primer 15. 1. 2027, ali označite nedoločen čas.').nullable(),
    noticeDays: wholeDays('Vnesite celo število dni od 0 do 3650.'),
    warnDays: wholeDays('Vnesite celo število dni od 0 do 3650.'),
    valueCents: z.number({ error: 'Vnesite znesek, na primer 480,00.' }).int().min(0, { error: 'Znesek ne sme biti negativen.' }).max(100_000_000_000, { error: 'Znesek je previsok.' }).nullable(),
    valuePeriod: z.enum(VALUE_PERIODS, { error: 'Izberite način plačila.' }),
    notes: optionalText(2000, 'Opombe so predolge. Največ 2000 znakov.'),
  })
  .refine((c) => c.endDate === null || c.endDate >= c.startDate, {
    path: ['endDate'],
    error: 'Datum poteka ne sme biti pred datumom začetka.',
  });

export type ContractInput = z.infer<typeof contractInput>;

export interface Contract extends ContractInput {
  id: string;
  fileName: string;
  fileSize: number;
  terminatedAt: string | null;
  createdAt: string;
}

export interface ContractView extends Contract {
  status: Status;
  actionDate: string | null;
  daysLeft: number | null;
}

export interface Attachment { id: string; name: string; size: number; createdAt: string; textState: TextState }

// Ena pogodba s prilogami; seznam prilog ne vsebuje.
export interface ContractDetails extends ContractView { attachments: Attachment[]; textState: TextState }

export const MAX_ATTACHMENTS = 30;

export const STATUS_LABELS: Record<Status, Key> = { aktivna: 'Aktivna', kmalu: 'Kmalu poteče', potekla: 'Potekla', prekinjena: 'Prekinjena' };
export const VALUE_PERIOD_LABELS: Record<ValuePeriod, Key> = { enkratno: 'Enkratno', mesecno: 'Mesečno', letno: 'Letno' };

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    result[key] ??= issue.message;
  }
  return result;
}

// Rok za ukrepanje je datum poteka, zmanjšan za odpovedni rok.
export function actionDate(c: Pick<Contract, 'endDate' | 'noticeDays'>): string | null {
  return c.endDate === null ? null : addDays(c.endDate, -c.noticeDays);
}

export function status(
  c: Pick<Contract, 'endDate' | 'noticeDays' | 'warnDays' | 'terminatedAt'>,
  now: string,
): Status {
  if (c.terminatedAt) return 'prekinjena';
  const action = actionDate(c);
  if (c.endDate === null || action === null) return 'aktivna';
  if (now > c.endDate) return 'potekla';
  return now >= addDays(action, -c.warnDays) ? 'kmalu' : 'aktivna';
}

export function toView(c: Contract, now: string): ContractView {
  const action = actionDate(c);
  return { ...c, status: status(c, now), actionDate: action, daysLeft: action === null ? null : daysBetween(now, action) };
}

// Najprej pogodbe z najbližjim rokom, nato brez roka, na koncu prekinjene.
export function sortByDeadline(a: ContractView, b: ContractView): number {
  const rank = (c: ContractView) => (c.status === 'prekinjena' ? 2 : c.actionDate === null ? 1 : 0);
  return rank(a) - rank(b)
    || (a.actionDate ?? '').localeCompare(b.actionDate ?? '')
    || a.title.localeCompare(b.title, 'sl');
}
