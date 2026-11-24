// Teče v ločeni niti, ki jo glavna nit po izteku časa ustavi. Vidi samo pogodbe enega uporabnika.
import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';

const { file, userId, pattern, flags, limit, perContract } = workerData as { file: string; userId: string; pattern: string; flags: string; limit: number; perContract: number };
const CONTEXT = 70;
const regex = new RegExp(pattern, flags);
const found = new Map<string, { inData: boolean; excerpts: unknown[] }>();
let truncated = false;

function matches(text: string, max: number): { index: number; length: number }[] {
  const result: { index: number; length: number }[] = [];
  regex.lastIndex = 0;
  for (let m = regex.exec(text); m && result.length < max; m = regex.exec(text)) {
    if (m[0].length === 0) { regex.lastIndex++; continue; }
    result.push({ index: m.index, length: m[0].length });
  }
  return result;
}

function entry(id: string) {
  let e = found.get(id);
  if (!e) {
    if (found.size >= limit) { truncated = true; return null; }
    e = { inData: false, excerpts: [] };
    found.set(id, e);
  }
  return e;
}

const db = new Database(file, { readonly: true });
for (const row of db.prepare('SELECT id, title, party, category, number, notes FROM contracts WHERE user_id = ?').iterate(userId) as Iterable<Record<string, string | null>>) {
  if ([row.title, row.party, row.category, row.number, row.notes].some((v) => v && matches(v, 1).length > 0)) {
    const e = entry(row.id!);
    if (e) e.inData = true;
  }
}
const pages = db.prepare(`SELECT d.contract_id, d.attachment_id, p.page, p.text FROM document_pages p JOIN documents d ON d.file_id = p.file_id
  JOIN contracts c ON c.id = d.contract_id WHERE c.user_id = ? ORDER BY d.contract_id, d.attachment_id IS NOT NULL, d.file_id, p.page`);
for (const row of pages.iterate(userId) as Iterable<{ contract_id: string; attachment_id: string | null; page: number; text: string }>) {
  const known = found.get(row.contract_id);
  if (known && known.excerpts.length >= perContract) continue;
  for (const m of matches(row.text, 2)) {
    const e = entry(row.contract_id);
    if (!e || e.excerpts.length >= perContract) break;
    const start = Math.max(0, m.index - CONTEXT);
    const hitEnd = m.index + Math.min(m.length, 300);
    const end = Math.min(row.text.length, hitEnd + CONTEXT);
    e.excerpts.push({
      attachmentId: row.attachment_id, page: row.page,
      parts: [
        { text: (start > 0 ? '…' : '') + row.text.slice(start, m.index), hit: false },
        { text: row.text.slice(m.index, hitEnd), hit: true },
        { text: row.text.slice(hitEnd, end) + (end < row.text.length ? '…' : ''), hit: false },
      ].filter((p) => p.text),
    });
  }
}
db.close();
parentPort!.postMessage({ found: [...found], truncated });
