import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { sortByDeadline, toView, type Contract } from '../shared/contracts.js';
import { today } from '../shared/dates.js';
import type { Excerpt, Part, SearchHit, SearchInput, SearchResult } from '../shared/search.js';
import type { ContractStore } from './contracts.js';
import type { Db } from './db.js';

const MAX_HITS = 200;
const EXCERPTS = 3;
const MAX_TERMS = 12;
const REGEX_TIMEOUT = 4000;
const MAX_WORKERS = 2;
const OPEN = '\u0001';
const CLOSE = '\u0002';

// Napaka, ki jo povzroči iskani izraz; sporočilo vidi uporabnik.
export class SearchError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 422) { super(message); }
}

interface Term { text: string; phrase: boolean; negative: boolean }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function parseTerms(query: string): Term[] {
  const terms: Term[] = [];
  for (const m of query.matchAll(/(-?)"([^"]*)"|(-?)([^\s"]+)/g)) {
    const phrase = m[2] !== undefined;
    const text = (m[2] ?? m[4] ?? '').trim();
    if (/[\p{L}\p{N}]/u.test(text)) terms.push({ text, phrase, negative: (m[1] ?? m[3]) === '-' });
  }
  return terms.slice(0, MAX_TERMS);
}

// Slovenske besede se sklanjajo, zato se končni samoglasnik izpusti in išče po začetku besede.
const stem = (word: string) => (/^\p{L}{5,}$/u.test(word) && /[aeiou]$/i.test(word) ? word.slice(0, -1) : word);

const ftsTerm = (t: Term) => {
  const quoted = `"${(t.phrase ? t.text : stem(t.text)).replace(/"/g, '""')}"`;
  return t.phrase ? quoted : `${quoted}*`;
};

function splitSnippet(snippet: string): Part[] {
  const parts: Part[] = [];
  let hit = false;
  for (const piece of snippet.split(/([\u0001\u0002])/)) {
    if (piece === OPEN) hit = true;
    else if (piece === CLOSE) hit = false;
    else if (piece) parts.push({ text: piece, hit });
  }
  return parts;
}

const worker = ['./regex-worker.js', './regex-worker.ts'].map((f) => new URL(f, import.meta.url)).find((u) => existsSync(fileURLToPath(u)));

export class Search {
  private busy = new Set<string>();

  constructor(private db: Db, private dataDir: string, private store: ContractStore) {}

  async run(userId: string, input: SearchInput): Promise<SearchResult> {
    const contracts = new Map(this.store.list(userId).map((c) => [c.id, c]));
    const found = input.mode === 'regex' ? await this.regex(userId, input) : this.keyword(userId, input.query, contracts);
    const names = this.names(userId);
    const now = today();
    const hits = found.hits.flatMap(({ id, inData, excerpts }): SearchHit[] => {
      const contract = contracts.get(id);
      if (!contract) return [];
      const named = excerpts.flatMap((e): Excerpt[] => {
        const name = e.attachmentId === null ? contract.fileName : names.get(e.attachmentId);
        return name === undefined ? [] : [{ ...e, name }];
      });
      return [{ contract: toView(contract, now), inData, excerpts: named }];
    });
    const state = this.db.prepare(`SELECT COALESCE(SUM(d.status IN ('pending', 'processing')), 0) AS pending, COALESCE(SUM(d.status = 'failed'), 0) AS failed
      FROM documents d JOIN contracts c ON c.id = d.contract_id WHERE c.user_id = ?`).get(userId) as { pending: number; failed: number };
    return { hits, truncated: found.truncated, ...state };
  }

  private names(userId: string): Map<string, string> {
    return new Map([...this.store.allAttachments(userId).values()].flat().map((a) => [a.id, a.name]));
  }

  // Pogodba ustreza, če se vsaka beseda pojavi v njenih podatkih ali v katerem koli njenem dokumentu.
  private keyword(userId: string, query: string, contracts: Map<string, Contract>): Found {
    const terms = parseTerms(query);
    const wanted = terms.filter((t) => !t.negative);
    if (wanted.length === 0) throw new SearchError('Vnesite vsaj eno besedo.', 400);

    const inDocuments = this.db.prepare(`SELECT DISTINCT d.contract_id AS id FROM document_fts f JOIN document_pages p ON p.id = f.rowid
      JOIN documents d ON d.file_id = p.file_id JOIN contracts c ON c.id = d.contract_id WHERE document_fts MATCH ? AND c.user_id = ?`);
    const data = new Map([...contracts.values()].map((c) => [c.id, fold([c.title, c.party, c.category, c.number, c.notes].filter(Boolean).join('\n'))]));
    const dataHit = (id: string, t: Term) => data.get(id)!.includes(fold(t.phrase ? t.text : stem(t.text)));
    const matching = (t: Term) => {
      const ids = new Set((inDocuments.all(ftsTerm(t), userId) as { id: string }[]).map((r) => r.id));
      for (const id of data.keys()) if (dataHit(id, t)) ids.add(id);
      return ids;
    };
    let ids = new Set(contracts.keys());
    for (const t of terms) {
      const set = matching(t);
      ids = new Set([...ids].filter((id) => set.has(id) !== t.negative));
    }

    const excerpts = new Map<string, RawExcerpt[]>();
    const best = new Map<string, number>();
    const rows = this.db.prepare(`SELECT d.contract_id AS id, d.attachment_id AS attachmentId, p.page, snippet(document_fts, 0, char(1), char(2), '…', 28) AS snippet, bm25(document_fts) AS rank
      FROM document_fts JOIN document_pages p ON p.id = document_fts.rowid JOIN documents d ON d.file_id = p.file_id JOIN contracts c ON c.id = d.contract_id
      WHERE document_fts MATCH ? AND c.user_id = ? ORDER BY rank LIMIT 3000`)
      .iterate(wanted.map(ftsTerm).join(' OR '), userId) as Iterable<{ id: string; attachmentId: string | null; page: number; snippet: string; rank: number }>;
    for (const r of rows) {
      if (!ids.has(r.id)) continue;
      if (!best.has(r.id)) best.set(r.id, r.rank);
      const list = excerpts.get(r.id) ?? [];
      if (list.length < EXCERPTS) excerpts.set(r.id, [...list, { attachmentId: r.attachmentId, page: r.page, parts: splitSnippet(r.snippet) }]);
    }
    const hits = [...ids].map((id) => ({ id, inData: wanted.some((t) => dataHit(id, t)), excerpts: excerpts.get(id) ?? [] }))
      .sort((a, b) => Number(b.inData) - Number(a.inData) || (best.get(a.id) ?? 0) - (best.get(b.id) ?? 0));
    return { hits: hits.slice(0, MAX_HITS), truncated: hits.length > MAX_HITS };
  }

  private async regex(userId: string, { query, caseSensitive }: SearchInput): Promise<Found> {
    const flags = `gm${caseSensitive ? '' : 'i'}`;
    // Najprej strogi zapis z Unicode; če ga izraz ne prenese, še običajni.
    const valid = [`${flags}u`, flags].find((f) => { try { new RegExp(query, f); return true; } catch { return false; } });
    if (!valid) throw new SearchError('Regularni izraz ni veljaven.', 400);
    if (this.busy.has(userId) || this.busy.size >= MAX_WORKERS) throw new SearchError('Drugo iskanje še poteka. Poskusite čez nekaj sekund.', 409);
    if (!worker) throw new Error('regex-worker manjka');
    this.busy.add(userId);
    try {
      const { found, truncated } = await new Promise<{ found: [string, { inData: boolean; excerpts: RawExcerpt[] }][]; truncated: boolean }>((resolve, reject) => {
        const w = new Worker(worker, {
          workerData: { file: join(this.dataDir, 'arhiv.db'), userId, pattern: query, flags: valid, limit: MAX_HITS, perContract: EXCERPTS },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
        const timer = setTimeout(() => { void w.terminate(); reject(new SearchError('Izraz je prezahteven. Poenostavite ga.', 422)); }, REGEX_TIMEOUT);
        w.once('message', resolve);
        w.once('error', reject);
        w.once('exit', () => { clearTimeout(timer); reject(new Error('Iskanje se je prekinilo.')); });
      });
      const contracts = new Map(this.store.list(userId).map((c) => [c.id, toView(c, today())]));
      const hits = found.filter(([id]) => contracts.has(id)).sort(([a], [b]) => sortByDeadline(contracts.get(a)!, contracts.get(b)!))
        .map(([id, rest]) => ({ id, ...rest }));
      return { hits, truncated };
    } finally {
      this.busy.delete(userId);
    }
  }
}

type RawExcerpt = Omit<Excerpt, 'name'>;
interface Found { hits: { id: string; inData: boolean; excerpts: RawExcerpt[] }[]; truncated: boolean }
