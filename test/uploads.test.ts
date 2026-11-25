import { createServer, type Server } from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UploadStore } from '../src/server/uploads.js';
import { verifyOutline } from '../src/server/suggest.js';
import type { ContractDetails } from '../src/shared/contracts.js';
import type { Outline, Upload } from '../src/shared/uploads.js';
import type { ManagedUser } from '../src/shared/users.js';
import { input, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let ana: string;
let bor: string;
const files = () => readdirSync(join(t.dataDir, 'files'));
const bytes = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}`);
const BUNDLE = 'Pogodba A o najemu\fstran dve\fAneks 1 k pogodbi A\fPogodba B o dobavi\fkonec';

const raw = (body: BodyInit, cookie = ana, headers: Record<string, string> = {}) =>
  t.request('/api/uploads', { method: 'POST', body, cookie, headers: { 'x-file-name': encodeURIComponent('sveženj č.pdf'), ...headers }, duplex: 'half' } as RequestInit);
const upload = async (text = BUNDLE, cookie = ana) => (await (await raw(bytes(text), cookie)).json()) as Upload;
const split = (id: string, parts: unknown, cookie = ana) => t.json(`/api/uploads/${id}/split`, { parts }, { cookie });
const create = (body: object, cookie = ana) => t.json('/api/contracts', { data: input, ...body }, { cookie });
const text = async (path: string, cookie = ana) => new TextDecoder().decode(await (await t.request(path, { cookie })).arrayBuffer());

beforeEach(async () => {
  t = await setup({ MAX_FILE_MB: '1' });
  ana = await t.register('ana@primer.si');
  bor = await t.register('bor@primer.si');
});

describe('nalaganje', () => {
  it('shrani datoteko, prešteje strani in jo prevzame brez kopije', async () => {
    const up = await upload();
    expect(up).toMatchObject({ name: 'sveženj č.pdf', pages: 5, size: bytes(BUNDLE).length });
    expect(await text(`/api/uploads/${up.id}/file`)).toBe(new TextDecoder().decode(bytes(BUNDLE)));
    const r = await create({ upload: up.id });
    expect(r.status).toBe(201);
    expect(((await r.json()) as ContractDetails).fileName).toBe('sveženj č.pdf');
    expect(files()).toEqual([`${up.id}.pdf`]);
    expect((await t.request(`/api/uploads/${up.id}/file`, { cookie: ana })).status).toBe(404);
    expect((await t.json(`/api/uploads/${up.id}`, {}, { method: 'DELETE', cookie: ana })).status).toBe(404);
    expect(files()).toHaveLength(1);
  });

  it('iste datoteke ni mogoče uporabiti dvakrat, tudi sočasno', async () => {
    const up = await upload();
    const all = await Promise.all([create({ upload: up.id }), create({ upload: up.id }), create({ upload: up.id })]);
    expect(all.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const other = await upload();
    expect((await create({ upload: other.id, attachments: [other.id] })).status).toBe(409);
    expect(t.db.prepare('SELECT COUNT(*) n FROM contracts').get()).toEqual({ n: 1 });
    expect(t.db.prepare('SELECT COUNT(*) n FROM attachments').get()).toEqual({ n: 0 });
    expect((await t.request(`/api/uploads/${other.id}/file`, { cookie: ana })).status).toBe(200);
  });

  it('drug uporabnik in gost je ne dosežeta', async () => {
    const up = await upload();
    for (const [method, path] of [['GET', '/file'], ['DELETE', ''], ['POST', '/suggest'], ['POST', '/outline'], ['POST', '/split']] as const) {
      const r = await t.request(`/api/uploads/${up.id}${path}`, { method, cookie: bor, ...(method === 'POST' && { body: JSON.stringify({ parts: [{ from: 1, to: 1, name: 'x' }] }), headers: { 'content-type': 'application/json' } }) });
      expect([403, 404], `${method} ${path}`).toContain(r.status);
      expect((await t.request(`/api/uploads/${up.id}${path}`, { method })).status).toBe(401);
    }
    expect((await create({ upload: up.id }, bor)).status).toBe(409);
    const mine = await upload('moja', bor);
    expect((await create({ upload: mine.id, attachments: [up.id] }, bor)).status).toBe(409);
    expect((await raw(bytes('x'), ana, { origin: 'https://zlo.test' })).status).toBe(403);
    expect(await text(`/api/uploads/${up.id}/file`)).toContain('Pogodba A');
  });

  it('prekoračitev med pošiljanjem ustavi in pobriše', async () => {
    const stream = (chunks: number) => new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes('')); for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(256 * 1024)); c.close(); },
    });
    expect((await raw(stream(8))).status).toBe(413);
    expect((await raw(stream(8), ana, { 'content-length': '10' })).status).toBe(413);
    expect((await raw(stream(2))).status).toBe(201);
    const broken = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes('a')); }, pull(c) { c.error(new Error('prekinjeno')); } });
    expect((await raw(broken)).status).toBe(500);
    expect(files()).toHaveLength(1);
  });

  it('omeji čakajoče datoteke in prostor', async () => {
    const big = new Uint8Array(1024 * 1024 - 10); big.set(bytes(''));
    for (let i = 0; i < 4; i++) expect((await raw(big)).status).toBe(201);
    expect((await raw(big)).status).toBe(409);
    expect((await raw(big, bor)).status).toBe(201);
    t = await setup({ STORAGE_LIMIT_MB: '0.00004' });
    ana = await t.register('x@primer.si');
    expect((await raw(bytes('kratko'))).status).toBe(201);
    expect((await raw(bytes('precej daljše besedilo'.repeat(3)))).status).toBe(507);
    expect(files()).toHaveLength(1);
  });

  it('stare in datoteke izbrisanih uporabnikov izginejo', async () => {
    const up = await upload();
    await upload('b', bor);
    const store = new UploadStore(t.db, t.dataDir, { countPages: async () => 1, split: async () => {} }, 1e6, null);
    expect(await store.cleanup()).toBe(0);
    expect(await store.cleanup(Date.now() + 23 * 3600_000)).toBe(0);
    const user = t.db.prepare("SELECT id FROM user WHERE email = 'bor@primer.si'").get() as { id: string };
    expect((await t.json(`/api/admin/users/${user.id}`, {}, { method: 'DELETE', cookie: ana })).status).toBe(204);
    expect(files()).toEqual([`${up.id}.pdf`]);
    expect(await store.cleanup(Date.now() + 25 * 3600_000)).toBe(1);
    expect(files()).toEqual([]);
  });

  it('ime datoteke ne more zapustiti mape ali vriniti glave', async () => {
    for (const [name, expected] of [['../../etc/x.pdf', 'x.pdf'], ['a"\r\nX: y.pdf', 'aX: y.pdf'], ['', 'pogodba.pdf'], ['ime.docx', 'ime.pdf']] as const) {
      expect(((await (await raw(bytes('x'), ana, { 'x-file-name': encodeURIComponent(name) })).json()) as Upload).name).toBe(expected);
    }
    expect((await raw(bytes('x'), ana, { 'x-file-name': '%E0%A4%A' })).status).toBe(201);
  });

  it('brez dovoljenja za dodajanje ali urejanje ni nalaganja', async () => {
    const user = t.db.prepare("SELECT id FROM user WHERE email = 'bor@primer.si'").get() as { id: string };
    const set = (permissions: object) => t.json(`/api/admin/users/${user.id}`, { name: 'B', role: 'user', disabled: false, permissions }, { method: 'PUT', cookie: ana });
    const up = await upload(BUNDLE, bor);
    await set({ create: false, edit: true, remove: false, ai: false });
    expect((await raw(bytes('x'), bor)).status).toBe(201);
    expect((await split(up.id, [{ from: 1, to: 1, name: 'x' }], bor)).status).toBe(403);
    await set({ create: false, edit: false, remove: true, ai: false });
    expect((await raw(bytes('x'), bor)).status).toBe(403);
    expect((await t.request(`/api/uploads/${up.id}/file`, { cookie: bor })).status).toBe(403);
  });
});

describe('razdelitev', () => {
  it('ustvari dele, ki postanejo pogodba s prilogami', async () => {
    const up = await upload();
    const r = await split(up.id, [{ from: 1, to: 2, name: 'Pogodba S-2026/014' }, { from: 3, to: 3, name: 'Aneks 1.pdf' }, { from: 4, to: 5, name: 'Pogodba B' }]);
    expect(r.status).toBe(201);
    const parts = (await r.json()) as Upload[];
    expect(parts.map((p) => [p.name, p.pages])).toEqual([['Pogodba S-2026-014.pdf', 2], ['Aneks 1.pdf', 1], ['Pogodba B.pdf', 2]]);
    expect(await text(`/api/uploads/${parts[2]!.id}/file`)).toBe('%PDF-1.4\nPogodba B o dobavi\fkonec');
    const saved = (await (await create({ upload: parts[0]!.id, attachments: [parts[1]!.id] })).json()) as ContractDetails;
    expect(saved.attachments.map((a) => a.name)).toEqual(['Aneks 1.pdf']);
    expect(await text(`/api/contracts/${saved.id}/attachments/${saved.attachments[0]!.id}/file`)).toContain('Aneks 1');
    await t.indexer.drain();
    const found = (await (await t.json('/api/search', { query: 'aneks', mode: 'keyword', caseSensitive: false }, { cookie: ana })).json()) as { hits: unknown[] };
    expect(found.hits).toHaveLength(1);
    expect(files()).toHaveLength(4);
  });

  it('zavrne neveljavne dele in ob napaki ne pusti ničesar', async () => {
    const up = await upload();
    for (const parts of [[], [{ from: 0, to: 1, name: 'x' }], [{ from: 2, to: 1, name: 'x' }], [{ from: 1, to: 1.5, name: 'x' }], [{ from: 1, to: 1, name: '' }], 'x', Array.from({ length: 61 }, () => ({ from: 1, to: 1, name: 'x' }))]) {
      expect((await split(up.id, parts)).status, JSON.stringify(parts).slice(0, 40)).toBe(400);
    }
    expect((await split(up.id, [{ from: 1, to: 1, name: 'x' }, { from: 5, to: 6, name: 'y' }])).status).toBe(422);
    expect(files()).toEqual([`${up.id}.pdf`]);
    const broken = await upload('!');
    expect(broken.pages).toBeNull();
    expect((await split(broken.id, [{ from: 1, to: 1, name: 'x' }])).status).toBe(422);
    expect(files()).toHaveLength(2);
  });

  it('največ trideset prilog', async () => {
    const up = await upload('a');
    const ids = Array.from({ length: 31 }, () => crypto.randomUUID());
    expect((await create({ upload: up.id, attachments: ids })).status).toBe(400);
  });
});

describe('predlog razdelitve', () => {
  let server: Server;
  let answer: unknown;
  let seen = '';
  beforeEach(async () => {
    server = createServer(async (req, res) => { let body = ''; for await (const c of req) body += c; seen = body; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: { content: JSON.stringify(answer) } })); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    await t.json('/api/admin/ai', { provider: 'ollama', baseUrl: `http://127.0.0.1:${port}`, apiKey: null, model: 'm', organisation: '', dailyLimit: 2 }, { method: 'PUT', cookie: ana });
    const [user] = ((await (await t.request('/api/admin/users', { cookie: ana })).json()) as ManagedUser[]).filter((u) => u.email.startsWith('bor'));
    await t.json(`/api/admin/users/${user!.id}`, { name: 'B', role: 'user', disabled: false, permissions: { create: true, edit: true, remove: true, ai: true } }, { method: 'PUT', cookie: ana });
  });
  afterEach(() => { server.closeAllConnections(); return new Promise((r) => server.close(r)); });

  it('vrne potrjene začetke in šteje v dnevno omejitev', async () => {
    answer = { documents: [
      { page: 1, kind: 'contract', title: 'Najem', quote: 'Pogodba A o najemu' }, { page: 3, kind: 'annex', title: 'Aneks 1', quote: 'Aneks 1 k pogodbi A' },
      { page: 5, kind: 'contract', title: 'Dobava', quote: 'Pogodba B o dobavi' }, { page: 2, kind: 'contract', title: 'Izmišljeno', quote: 'Pogodba X' },
    ] };
    const up = await upload(BUNDLE, bor);
    const r = await t.request(`/api/uploads/${up.id}/outline`, { method: 'POST', cookie: bor });
    expect((await r.json()) as Outline).toEqual({ pagesRead: 5, pagesTotal: 5, parts: [
      { page: 1, kind: 'contract', title: 'Najem' }, { page: 3, kind: 'annex', title: 'Aneks 1' }, { page: 4, kind: 'contract', title: 'Dobava' },
    ] });
    expect(seen).toContain('[page 4]');
    expect((await t.request(`/api/uploads/${up.id}/outline`, { method: 'POST', cookie: ana })).status).toBe(403);
    await t.request(`/api/uploads/${up.id}/outline`, { method: 'POST', cookie: bor });
    expect((await t.request(`/api/uploads/${up.id}/outline`, { method: 'POST', cookie: bor })).status).toBe(409);
  });

  it('prvi dokument je vedno pogodba na prvi strani', () => {
    const pages = ['Uvodna stran', 'Aneks številka 1'];
    expect(verifyOutline({ documents: [{ page: 2, kind: 'annex', title: null, quote: 'ANEKS ŠTEVILKA 1' }] }, pages)).toEqual([{ page: 1, kind: 'contract', title: null }, { page: 2, kind: 'annex', title: null }]);
    expect(verifyOutline({ documents: [{ page: 1, kind: 'annex', title: 'x', quote: 'Uvodna stran' }] }, pages)[0]).toMatchObject({ kind: 'contract' });
    for (const bad of [null, {}, { documents: 'x' }, { documents: [null, 3, { page: 'a' }, { page: 9, kind: 'contract', title: 'x', quote: 'ni' }] }]) expect(verifyOutline(bad, pages)).toEqual([{ page: 1, kind: 'contract', title: null }]);
    expect(verifyOutline({ documents: [{ page: 7, kind: 'contract', title: 'x', quote: 'stran' }] }, ['ista stran', 'ista stran'])).toHaveLength(1);
  });
});
