import { z } from 'zod';
import type { ContractView } from './contracts.js';

// pending: čaka na obdelavo; text: besedilo iz PDF; ocr: prepoznano s slike; empty: brez besedila; failed: ni uspelo.
export type TextState = 'pending' | 'text' | 'ocr' | 'empty' | 'failed';

export const SEARCH_MODES = ['keyword', 'regex'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const searchInput = z.object({
  // Krmilni znaki nimajo pomena in bi zmotili razčlenjevalnik iskanja.
  query: z.string({ error: 'Vnesite iskani izraz.' }).transform((s) => s.toWellFormed().replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).pipe(z.string().min(1, { error: 'Vnesite iskani izraz.' }).max(300, { error: 'Iskani izraz je predolg. Največ 300 znakov.' })),
  mode: z.enum(SEARCH_MODES),
  caseSensitive: z.boolean(),
});
export type SearchInput = z.infer<typeof searchInput>;

export interface Part { text: string; hit: boolean }
export interface Excerpt { attachmentId: string | null; name: string; page: number; parts: Part[] }
export interface SearchHit { contract: ContractView; inData: boolean; excerpts: Excerpt[] }
export interface SearchResult { hits: SearchHit[]; truncated: boolean; pending: number; failed: number }
