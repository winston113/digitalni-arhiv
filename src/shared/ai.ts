import { z } from 'zod';
import type { Category, ValuePeriod } from './contracts.js';

export const AI_PROVIDERS = ['ollama', 'openai', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_DEFAULT_URL: Record<AiProvider, string> = { ollama: 'http://localhost:11434', openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' };

function allowedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const connection = {
  provider: z.enum(AI_PROVIDERS, { error: 'Izberite ponudnika.' }),
  baseUrl: z.string({ error: 'Vnesite naslov strežnika.' }).trim().max(500, { error: 'Naslov je predolg.' }).transform((v) => v.replace(/\/+$/, ''))
    .refine(allowedUrl, { error: 'Vnesite naslov, ki se začne s http:// ali https://.' }),
  // null: obdrži shranjen ključ.
  apiKey: z.string().trim().max(500, { error: 'Ključ je predolg.' }).regex(/^[\x21-\x7e]*$/, { error: 'Ključ vsebuje neveljavne znake.' }).nullable(),
};

// Anthropic ima stalen naslov, Ollama pa svojega brez dodatkov /v1 ali /api.
const fixUrl = <T extends { provider: AiProvider; baseUrl: string }>(v: T): T => ({
  ...v, baseUrl: v.provider === 'anthropic' ? AI_DEFAULT_URL.anthropic : v.provider === 'ollama' ? v.baseUrl.replace(/\/(v1|api)$/, '') : v.baseUrl,
});

export const aiConnection = z.object(connection).transform(fixUrl);
export type AiConnection = z.infer<typeof aiConnection>;

export const aiInput = z.object({
  ...connection,
  model: z.string({ error: 'Vnesite model.' }).trim().min(1, { error: 'Vnesite model.' }).max(200, { error: 'Ime modela je predolgo.' }),
  organisation: z.string().trim().max(200, { error: 'Ime je predolgo. Največ 200 znakov.' }),
  dailyLimit: z.number({ error: 'Vnesite celo število od 1 do 1000.' }).int({ error: 'Vnesite celo število od 1 do 1000.' }).min(1, { error: 'Vnesite celo število od 1 do 1000.' }).max(1000, { error: 'Vnesite celo število od 1 do 1000.' }),
}).transform(fixUrl);
export type AiInput = z.infer<typeof aiInput>;

// Ključ se nikoli ne vrne.
export interface AiView { settings: (Omit<AiInput, 'apiKey'> & { hasKey: boolean }) | null; unreadableKey: boolean }

// Kar sme vedeti uporabnik: kam se pošlje besedilo.
export interface AiInfo { destination: string }

export interface Suggestion<T> { value: T; quote?: string; page?: number }

export interface Suggestions {
  title?: Suggestion<string>;
  party?: Suggestion<string>;
  category?: Suggestion<Category>;
  number?: Suggestion<string>;
  startDate?: Suggestion<string>;
  endDate?: Suggestion<string>;
  openEnded?: Suggestion<true>;
  noticeDays?: Suggestion<number>;
  valueCents?: Suggestion<number>;
  valuePeriod?: Suggestion<ValuePeriod>;
}

export interface SuggestResult { suggestions: Suggestions; pagesRead: number; pagesTotal: number }
