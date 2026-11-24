import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/server/db.js';
import { cleanText } from '../src/server/extract.js';
import { Indexer } from '../src/server/indexer.js';
import { parseTerms } from '../src/server/search.js';
import type { Attachment, ContractDetails } from '../src/shared/contracts.js';
import type { SearchResult } from '../src/shared/search.js';
import { form, input, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let ana: string;
let bor: string;
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}`);
const create = async (text: string, over: object = {}, cookie = ana) => {
  const r = await t.request('/api/contracts', { method: 'POST', body: form({ ...input, title: 'Pogodba', party: 'Stranka', number: null, ...over }, pdf(text)), cookie });
  expect(r.status).toBe(201);
  return ((await r.json()) as ContractDetails).id;
};
const attach = async (id: string, text: string, cookie = ana) =>
  (await (await t.request(`/api/contracts/${id}/attachments`, { method: 'POST', body: form(null, pdf(text), 'aneks.pdf'), cookie })).json()) as Attachment[];
const raw = (query: unknown, over: object = {}, cookie = ana) => t.json('/api/search', { query, mode: 'keyword', caseSensitive: false, ...over }, { cookie });
const find = async (query: string, over: object = {}, cookie = ana) => {
  await t.indexer.drain();
  const r = await raw(query, over, cookie);
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as SearchResult;
};
const titles = async (query: string, over: object = {}, cookie = ana) => (await find(query, over, cookie)).hits.map((h) => h.contract.title).sort();
const regex = (query: string, over: object = {}) => titles(query, { mode: 'regex', ...over });

beforeEach(async () => {
  t = await setup();
  ana = await t.register('ana@primer.si');
  bor = await t.register('bor@primer.si');
});

describe('ključne besede', () => {
  beforeEach(async () => {
    await create('Najemnina znaša 1.250,00 EUR na mesec.\fČiščenje stopnišča opravi izvajalec.', { title: 'A', notes: 'parkirišče' });
    await attach(await create('Dobava papirja po naročilu.', { title: 'B', number: 'D-2026/021' }), 'Aneks spreminja ceno najemnine.');
    await create('Nekaj povsem drugega.', { title: 'C' });
  });

  it('najde besede v dokumentih, prilogah in podatkih, brez razlik v šumnikih in končnicah', async () => {
    expect(await titles('najemnina')).toEqual(['A', 'B']);
    expect(await titles('NAJEMNINE')).toEqual(['A', 'B']);
    expect(await titles('ciscenje')).toEqual(['A']);
    expect(await titles('parkirisce')).toEqual(['A']);
    expect(await titles('D-2026/021')).toEqual(['B']);
    expect(await titles('1.250,00')).toEqual(['A']);
    expect(await titles('neobstoječe')).toEqual([]);
  });

  it('vse besede morajo ustrezati, tudi v različnih dokumentih iste pogodbe', async () => {
    expect(await titles('papir najemnina')).toEqual(['B']);
    expect(await titles('najemnina -papir')).toEqual(['A']);
    expect(await titles('"znaša 1.250,00"')).toEqual(['A']);
    expect(await titles('"1.250,00 znaša"')).toEqual([]);
    expect(await titles('najemnina -"znaša 1.250,00"')).toEqual(['B']);
  });

  it('vrne odlomek s stranjo in označenim zadetkom', async () => {
    const { hits } = await find('stopnišče');
    expect(hits[0]!.excerpts).toMatchObject([{ attachmentId: null, name: 'pogodba č.pdf', page: 2 }]);
    expect(hits[0]!.excerpts[0]!.parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['stopnišča']);
    const b = (await find('najemnina papir')).hits[0]!;
    expect(b.excerpts.map((e) => e.name).sort()).toEqual(['aneks.pdf', 'pogodba č.pdf']);
  });

  it('skladnje FTS ni mogoče vriniti', async () => {
    for (const q of ['"', '*', 'a OR b', 'NEAR(a b)', 'text:najemnina', '"a" "', '-', '((', 'a AND', "'; DROP TABLE contracts; --", '^najem', '\u0000x', '-"', 'é́'.repeat(40)]) {
      expect([200, 400], q).toContain((await raw(q)).status);
    }
    expect(await titles('najemnina OR papir')).toEqual([]);
    expect((await raw('')).status).toBe(400);
    expect((await raw('x'.repeat(301))).status).toBe(400);
    expect((await raw('-samo')).status).toBe(400);
    expect((await raw({ $ne: 1 })).status).toBe(400);
    expect(await titles('najemnina')).toEqual(['A', 'B']);
  });

  it('razčleni iskani izraz', () => {
    expect(parseTerms('a -b "c d" -"e f" !').map((x) => [x.text, x.phrase, x.negative])).toEqual([['a', false, false], ['b', false, true], ['c d', true, false], ['e f', true, true]]);
  });
});

describe('regularni izrazi', () => {
  beforeEach(async () => {
    await create('Rok je 15. 1. 2027.\nCena: 1.250,00 EUR', { title: 'A', number: 'S-2026/014' });
    await create('Šifra ŽABA in sledi AAA.', { title: 'B' });
  });

  it('najde vzorce v besedilu in podatkih', async () => {
    expect(await regex('\\d{1,2}\\. \\d{1,2}\\. 20\\d\\d')).toEqual(['A']);
    expect(await regex('^cena:')).toEqual(['A']);
    expect(await regex('S-\\d{4}/\\d{3}')).toEqual(['A']);
    expect(await regex('žaba')).toEqual(['B']);
    expect(await regex('žaba', { caseSensitive: true })).toEqual([]);
    expect(await regex('\\p{Lu}{4}', { caseSensitive: true })).toEqual(['B']);
    expect(await regex('a\\-z|cena\\:')).toEqual(['A']);
    expect(await regex('x*')).toEqual([]);
    const { hits } = await find('1\\.250', { mode: 'regex' });
    expect(hits[0]!.excerpts[0]!.parts).toContainEqual({ text: '1.250', hit: true });
  });

  it('neveljaven izraz zavrne, prezahtevnega ustavi, strežnik pa deluje naprej', async () => {
    expect((await raw('(', { mode: 'regex' })).status).toBe(400);
    await create(`${'a'.repeat(60)}!`, { title: 'Past' });
    await t.indexer.drain();
    const started = Date.now();
    const evil = raw('(a+)+$', { mode: 'regex' });
    expect((await t.request('/api/health')).status).toBe(200);
    expect((await raw('b', { mode: 'regex' })).status).toBe(409);
    expect((await evil).status).toBe(422);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(await regex('žaba')).toEqual(['B']);
  }, 12_000);
});

describe('ločenost uporabnikov', () => {
  it('drug uporabnik ne najde ničesar, ne v besedilu ne v podatkih', async () => {
    const id = await create('Skrivnost podjetja', { title: 'Zaupno', party: 'Tajna stranka', notes: 'opomba' });
    await attach(id, 'Priloga skrivnost');
    for (const q of ['skrivnost', 'zaupno', 'tajna', 'opomba']) {
      expect(await titles(q)).toEqual(['Zaupno']);
      expect(await titles(q, {}, bor)).toEqual([]);
      expect(await titles(q, { mode: 'regex' }, bor)).toEqual([]);
    }
    expect(await titles('.', { mode: 'regex' }, bor)).toEqual([]);
    expect(await find('skrivnost', {}, bor)).toMatchObject({ hits: [], pending: 0, failed: 0 });
    expect((await t.json('/api/search', { query: 'a', mode: 'keyword', caseSensitive: false })).status).toBe(401);
    expect((await t.request(`/api/contracts/${id}/reindex`, { method: 'POST', cookie: bor })).status).toBe(404);
  });
});

describe('kazalo', () => {
  const pages = () => (t.db.prepare('SELECT COUNT(*) n FROM document_pages').get() as { n: number }).n;
  const indexed = (word: string) => (t.db.prepare('SELECT COUNT(*) n FROM document_fts WHERE document_fts MATCH ?').get(word) as { n: number }).n;

  it('sledi zamenjavi in brisanju datotek, prilog in uporabnikov', async () => {
    const id = await create('prvotno');
    const [a] = await attach(id, 'dodatno');
    expect(await titles('prvotno')).toHaveLength(1);
    await t.request(`/api/contracts/${id}`, { method: 'PUT', body: form(input, pdf('zamenjano')), cookie: ana });
    expect(await titles('prvotno')).toEqual([]);
    expect(await titles('zamenjano')).toHaveLength(1);
    await t.request(`/api/contracts/${id}/attachments/${a!.id}`, { method: 'DELETE', cookie: ana });
    expect(await titles('dodatno')).toEqual([]);
    expect(pages()).toBe(1);
    await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana });
    expect([pages(), indexed('zamenjano')]).toEqual([0, 0]);
    await create('borovo', {}, bor);
    await t.indexer.drain();
    expect(indexed('borovo')).toBe(1);
    const user = t.db.prepare("SELECT id FROM user WHERE email = 'bor@primer.si'").get() as { id: string };
    await t.json(`/api/admin/users/${user.id}`, {}, { method: 'DELETE', cookie: ana });
    expect([pages(), indexed('borovo')]).toEqual([0, 0]);
    expect(t.db.prepare('SELECT COUNT(*) n FROM documents').get()).toEqual({ n: 0 });
  });

  it('pokvarjena datoteka ne ustavi drugih in jo je mogoče poskusiti znova', async () => {
    const bad = await create('!pokvarjeno', { title: 'Slaba' });
    await create('dobra vsebina', { title: 'Dobra' });
    expect(await titles('dobra')).toEqual(['Dobra']);
    expect(await find('dobra')).toMatchObject({ pending: 0, failed: 1 });
    const state = async () => ((await (await t.request(`/api/contracts/${bad}`, { cookie: ana })).json()) as ContractDetails).textState;
    expect(await state()).toBe('failed');
    const r = await t.request(`/api/contracts/${bad}/reindex`, { method: 'POST', cookie: ana });
    expect(((await r.json()) as ContractDetails).textState).toBe('pending');
    await t.indexer.drain();
    expect(await state()).toBe('failed');
  });

  it('dokument, izbrisan med obdelavo, ne pusti sledi', async () => {
    const id = await create('minljivo');
    const drain = t.indexer.drain();
    await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana });
    await drain;
    expect([pages(), indexed('minljivo')]).toEqual([0, 0]);
  });

  it('nadgradnja obstoječe baze doda vse datoteke v vrsto', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY, createdAt TEXT)');
    migrate(db, 5);
    db.exec(`INSERT INTO contracts (id, user_id, title, party, category, start_date, notice_days, warn_days, value_period, file_id, file_name, file_size, created_at, updated_at) VALUES ('c', 'u', 'T', 'P', 'Najem', '2026-01-01', 0, 0, 'letno', 'f1', 'a', 1, '', '')`);
    db.exec("INSERT INTO attachments (id, contract_id, file_id, name, size, created_at) VALUES ('a', 'c', 'f2', 'b', 1, '')");
    migrate(db);
    expect(db.prepare('SELECT file_id, attachment_id, status FROM documents ORDER BY file_id').all()).toEqual([{ file_id: 'f1', attachment_id: null, status: 'pending' }, { file_id: 'f2', attachment_id: 'a', status: 'pending' }]);
  });

  it('počisti besedilo iz PDF', () => {
    expect(cleanText('najem-\nnina­  je\u0001 tu\n\n\n\nkonec ')).toBe('najemnina je tu\n\nkonec');
    expect(cleanText('S-2026 -\nNaslov')).toBe('S-2026 -\nNaslov');
  });
});

describe('ponovno branje skenov po izboljšavi', () => {
  it('poteka enkrat, samo za skenirane dokumente, iskanje pa medtem deluje', async () => {
    await create('skenirana beseda', { title: 'Sken' });
    await create('navadna beseda', { title: 'Besedilo' });
    await t.indexer.drain();
    t.db.prepare("UPDATE documents SET status = 'ocr' WHERE contract_id = (SELECT id FROM contracts WHERE title = 'Sken')").run();
    const pending = () => (t.db.prepare("SELECT COUNT(*) n FROM documents WHERE status = 'pending'").get() as { n: number }).n;
    expect(Indexer.rereadScans(t.db, t.settings, 2)).toBe(1);
    expect(pending()).toBe(1);
    const during = (await (await raw('skenirana')).json()) as SearchResult;
    expect(during.hits.map((h) => h.contract.title)).toEqual(['Sken']);
    expect(await titles('beseda')).toEqual(['Besedilo', 'Sken']);
    expect(Indexer.rereadScans(t.db, t.settings, 2)).toBe(0);
    expect(pending()).toBe(0);
    expect(Indexer.rereadScans(t.db, t.settings, 3)).toBe(0);
  });
});
