import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/server/db.js';
import { ToolsMissing, type Extract } from '../src/server/extract.js';
import { Indexer } from '../src/server/indexer.js';
import { autoWorkers, eachLimited, Limiter } from '../src/server/limiter.js';

const GB = 1024 ** 3;
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

describe('število delavcev', () => {
  it('upošteva jedra, pomnilnik in zgornjo mejo', () => {
    expect(autoWorkers(20, 32 * GB)).toBe(8);
    expect(autoWorkers(4, 32 * GB)).toBe(3);
    expect(autoWorkers(1, 32 * GB)).toBe(1);
    expect(autoWorkers(20, 0.5 * GB)).toBe(1);
    expect(autoWorkers(20, 2 * GB)).toBe(6);
    expect(autoWorkers(1, 0.1 * GB)).toBe(1);
  });
});

describe('omejevanje', () => {
  it('nikoli ne preseže meje in izkoristi vsa mesta, tudi ob napakah', async () => {
    const limiter = new Limiter(3);
    let now = 0;
    let peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => limiter.run(async () => {
      peak = Math.max(peak, ++now);
      await tick();
      now--;
      if (i % 5 === 0) throw new Error('x');
      return i;
    })));
    expect(peak).toBe(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(6);
    expect(await limiter.run(async () => 'prosto')).toBe('prosto');
  });

  it('eachLimited počaka na začete in vrne prvo napako', async () => {
    const done: number[] = [];
    await expect(eachLimited([1, 2, 3, 4, 5, 6], 2, async (n) => {
      if (n === 2) throw new Error('dve');
      await tick(10);
      done.push(n);
    })).rejects.toThrow('dve');
    expect(done).toContain(1);
    expect(done.length).toBeLessThan(5);
    await eachLimited([], 4, async () => { throw new Error('ne'); });
  });
});

describe('vrsta dokumentov', () => {
  const setup = (extract: Extract, workers: number, docs: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'vrsta-'));
    const db = openDb(dir);
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY, createdAt TEXT)');
    migrate(db);
    const add = (n: number) => db.prepare(`INSERT INTO contracts (id, user_id, title, party, category, start_date, notice_days, warn_days, value_period, file_id, file_name, file_size, created_at, updated_at)
      VALUES (?, 'u', 'T', 'P', 'Najem', '2026-01-01', 0, 0, 'letno', ?, 'a', 1, '', '')`).run(`c${n}`, `f${n}`);
    for (let n = 0; n < docs; n++) add(n);
    const count = (status: string) => (db.prepare('SELECT COUNT(*) n FROM documents WHERE status = ?').get(status) as { n: number }).n;
    return { db, add, count, indexer: new Indexer(db, dir, extract, workers) };
  };

  it('obdela vse natanko enkrat, hkrati največ toliko, kolikor je delavcev', async () => {
    let now = 0;
    let peak = 0;
    const seen: string[] = [];
    const t = setup(async (path) => { peak = Math.max(peak, ++now); seen.push(path); await tick(); now--; return { pages: ['besedilo'], method: 'text' }; }, 4, 25);
    t.indexer.kick();
    t.indexer.kick();
    await Promise.all([t.indexer.drain(), t.indexer.drain()]);
    expect([peak, t.count('text'), new Set(seen).size, seen.length]).toEqual([4, 25, 25, 25]);
  });

  it('nov dokument ne čaka na dolgega, če je mesto prosto', async () => {
    let release = () => {};
    const t = setup((path) => (path.endsWith('f0.pdf') ? new Promise((r) => { release = () => r({ pages: ['dolg'], method: 'text' }); }) : Promise.resolve({ pages: ['kratek'], method: 'text' })), 2, 2);
    t.indexer.kick();
    await tick(20);
    expect(t.count('text')).toBe(1);
    t.add(5);
    t.indexer.kick();
    await tick(20);
    expect(t.count('text')).toBe(2);
    release();
    await t.indexer.drain();
    expect(t.count('text')).toBe(3);
  });

  it('brez orodij se ustavi in dokumente pusti v vrsti', async () => {
    const t = setup(() => Promise.reject(new ToolsMissing('tesseract')), 3, 5);
    await t.indexer.drain();
    expect(t.count('pending')).toBe(5);
  });

  it('po prekinitvi nadaljuje nedokončane', async () => {
    const t = setup(async () => ({ pages: ['x'], method: 'text' }), 2, 2);
    t.db.prepare("UPDATE documents SET status = 'processing'").run();
    await new Indexer(t.db, '', async () => ({ pages: ['x'], method: 'text' }), 2).drain();
    expect(t.count('text')).toBe(2);
  });
});
