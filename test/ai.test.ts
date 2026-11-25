import { readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiView, SuggestResult } from '../src/shared/ai.js';
import { marksFor, parseBbox, parseTsv } from '../src/server/locate.js';
import { amountsIn } from '../src/shared/amounts.js';
import type { CurrentUser, ManagedUser } from '../src/shared/users.js';
import { datesIn, selectPages, Source, verify } from '../src/server/suggest.js';
import { form, setup } from './helpers.js';

const CONTRACT = `Pogodba o vzdrževanju št. S-2026/014, sklenjena med Kranjc Oprema, d. o. o., in Sistemi Koren, d. o. o.
Velja od 15. januarja 2026 do 15. 1. 2027.\fMesečno plačilo znaša 1.480,00 EUR brez DDV. Odpovedni rok je 2 meseca.`;
const ANSWER = {
  title: 'Vzdrževanje računalniške opreme', category: 'Storitve',
  party: { value: 'Sistemi Koren, d. o. o.', quote: 'Sistemi Koren, d. o. o.' },
  number: { value: 'S-2026/014', quote: 'št. S-2026/014' },
  startDate: { value: '2026-01-15', quote: 'od 15. januarja 2026' },
  endDate: { value: '2027-01-15', quote: 'do 15. 1. 2027' },
  openEnded: { value: null, quote: null },
  notice: { amount: 2, unit: 'months', quote: 'Odpovedni rok je 2 meseca' },
  value: { amount: '1.480,00', period: 'mesecno', quote: 'Mesečno plačilo znaša 1.480,00 EUR' },
};

let server: Server;
let url: string;
let seen: { path: string; auth: string | undefined; body: Record<string, any> }[];
let reply: (path: string, body: any) => { status?: number; body: unknown; delay?: number; location?: string } | null;
let t: Awaited<ReturnType<typeof setup>>;
let admin: string;
let ana: string;
let users: Record<string, ManagedUser>;

const answers = (path: string, content: string) => path === '/api/chat' ? { message: { content } }
  : path === '/v1/messages' ? { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: content }], usage: { input_tokens: 1, output_tokens: 1 } }
  : { choices: [{ message: { content } }] };
const settings = (changes: object = {}) => ({ provider: 'ollama', baseUrl: url, apiKey: null, model: 'qwen3:14b', organisation: '', dailyLimit: 20, ...changes });
const save = (changes: object = {}, cookie = admin) => t.json('/api/admin/ai', settings(changes), { method: 'PUT', cookie });
const allow = (name: string, ai = true, rest: object = {}) => t.json(`/api/admin/users/${users[name]!.id}`, { name, role: users[name]!.role, disabled: false, permissions: { create: true, edit: true, remove: true, ai, ...rest } }, { method: 'PUT', cookie: admin });
const suggest = (cookie: string, text = CONTRACT) => t.request('/api/suggestions', { method: 'POST', body: form(null, new TextEncoder().encode(`%PDF-1.4\n${text}`)), cookie });
const me = async (cookie: string) => (await (await t.request('/api/me', { cookie })).json()) as CurrentUser;
const error = async (r: Response) => [r.status, ((await r.json()) as { error: string }).error];

beforeEach(async () => {
  seen = [];
  reply = () => null;
  server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const path = req.url!.split('?')[0]!;
    seen.push({ path, auth: req.headers.authorization, body });
    const custom = reply(path, body);
    const out = custom ?? { body: path === '/api/tags' ? { models: [{ name: 'qwen3:14b' }, { name: 'gemma' }] } : path.endsWith('/models') ? { data: [{ id: 'm-2', type: 'model' }, { id: 'm-1', type: 'model' }], has_more: false } : answers(path, JSON.stringify(ANSWER)) };
    if (out.delay) await new Promise((r) => setTimeout(r, out.delay));
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json', ...(out.location && { location: out.location }) });
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t = await setup({ ANTHROPIC_TEST_URL: url });
  admin = await t.register('skrbnik@primer.si');
  ana = await t.register('ana@primer.si');
  users = Object.fromEntries(((await (await t.request('/api/admin/users', { cookie: admin })).json()) as ManagedUser[]).map((u) => [u.email.split('@')[0], u]));
});
afterEach(() => { server.closeAllConnections(); return new Promise((r) => server.close(r)); });

describe('dovoljenje', () => {
  it('je privzeto izklopljeno za vse, tudi za skrbnika', async () => {
    await save();
    for (const cookie of [admin, ana]) {
      expect((await suggest(cookie)).status).toBe(403);
      expect((await me(cookie)).ai).toBeNull();
    }
    expect((await suggest('')).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('velja šele, ko ga skrbnik dodeli, in preneha, ko ga odvzame', async () => {
    await save();
    await allow('ana');
    expect((await me(ana)).ai).toEqual({ destination: new URL(url).host });
    expect((await me(admin)).ai).toBeNull();
    expect((await suggest(ana)).status).toBe(200);
    await allow('ana', false);
    expect((await suggest(ana)).status).toBe(403);
    await allow('ana', true, { create: false, edit: false });
    expect((await suggest(ana)).status).toBe(403);
  });

  it('nastavitve vidi samo skrbnik', async () => {
    await allow('ana');
    expect((await save({}, ana)).status).toBe(403);
    expect((await t.request('/api/admin/ai', { cookie: ana })).status).toBe(403);
    expect((await t.json('/api/admin/ai/models', settings(), { cookie: ana })).status).toBe(403);
    expect((await t.request('/api/admin/ai')).status).toBe(401);
    expect(JSON.stringify(await (await t.request('/api/config')).json())).not.toContain('ai');
  });

  it('zavrne zahtevo z druge strani', async () => {
    await save();
    await allow('ana');
    expect((await t.request('/api/suggestions', { method: 'POST', body: form(null, new TextEncoder().encode('%PDF-1.4\nx')), cookie: ana, headers: { origin: 'https://zlo.test' } })).status).toBe(403);
  });

  it('brez nastavljenega ponudnika ni na voljo', async () => {
    await allow('ana');
    expect(await error(await suggest(ana))).toEqual([409, 'Umetna inteligenca ni nastavljena.']);
    expect((await me(ana)).ai).toBeNull();
  });
});

describe('ponudniki', () => {
  beforeEach(() => allow('ana'));

  it.each([
    ['ollama', '', '/api/chat'], ['openai', '/v1', '/v1/chat/completions'], ['anthropic', '', '/v1/messages'],
  ])('%s', async (provider, suffix, path) => {
    expect((await save({ provider, baseUrl: url + suffix, apiKey: 'sk-kljuc' })).status).toBe(200);
    const r = await suggest(ana);
    expect(r.status).toBe(200);
    const result = (await r.json()) as SuggestResult;
    // Oznake kažejo na besede navedka; druga stran ima svojo mrežo.
    expect(result.suggestions.valueCents!.marks).toEqual([{ page: 2, x: 0, y: 0, w: 0.49, h: 0.018 }]);
    expect(result.suggestions.startDate!.marks!.every((m) => m.page === 1)).toBe(true);
    expect(result.suggestions.title).not.toHaveProperty('marks');
    for (const s of Object.values(result.suggestions) as { quote?: string; marks?: unknown[] }[]) { if (s.quote) expect(s.marks!.length).toBeGreaterThan(0); delete s.marks; }
    expect(result).toEqual({
      pagesRead: 2, pagesTotal: 2,
      suggestions: {
        title: { value: 'Vzdrževanje računalniške opreme' }, category: { value: 'Storitve' },
        party: { value: 'Sistemi Koren, d. o. o.', quote: 'Sistemi Koren, d. o. o.', page: 1 },
        number: { value: 'S-2026/014', quote: 'št. S-2026/014', page: 1 },
        startDate: { value: '2026-01-15', quote: 'od 15. januarja 2026', page: 1 },
        endDate: { value: '2027-01-15', quote: 'do 15. 1. 2027', page: 1 },
        // Od 15. 11. 2026 do 15. 1. 2027.
        noticeDays: { value: 61, quote: 'Odpovedni rok je 2 meseca', page: 2 },
        valueCents: { value: 148000, quote: 'Mesečno plačilo znaša 1.480,00 EUR', page: 2 },
        valuePeriod: { value: 'mesecno', quote: 'Mesečno plačilo znaša 1.480,00 EUR', page: 2 },
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe(path);
    expect(seen[0]!.auth).toBe('Bearer sk-kljuc');
    expect(JSON.stringify(seen[0]!.body)).toContain('Sistemi Koren');
    expect(JSON.stringify(seen[0]!.body)).not.toMatch(/ana@primer|%PDF/);
    expect(JSON.stringify(seen[0]!.body)).toContain('"additionalProperties":false');
  });

  it('seznam modelov', async () => {
    const models = async (changes: object) => (await t.json('/api/admin/ai/models', settings(changes), { cookie: admin })).json();
    expect(await models({})).toEqual(['gemma', 'qwen3:14b']);
    expect(await models({ baseUrl: `${url}/v1/` })).toEqual(['gemma', 'qwen3:14b']);
    expect(await models({ provider: 'openai', baseUrl: `${url}/v1` })).toEqual(['m-1', 'm-2']);
    expect(await models({ provider: 'anthropic', apiKey: 'k' })).toEqual(['m-2', 'm-1']);
    expect(await models({ provider: 'anthropic' })).toEqual({ error: 'Vnesite ključ.' });
  });

  it('Ollama dobi dovolj prostora za besedilo', async () => {
    await save();
    await suggest(ana, `${CONTRACT} ${'beseda '.repeat(5000)}`);
    expect(seen[0]!.body.options.num_ctx).toBeGreaterThan(35_000 / 2.5);
    expect(seen[0]!.body.options.num_ctx % 4096).toBe(0);
  });

  it('strežnik brez podpore za sheme', async () => {
    reply = (_, body) => body.response_format?.type === 'json_schema' ? { status: 400, body: {} } : null;
    await save({ provider: 'openai', baseUrl: `${url}/v1` });
    expect((await suggest(ana)).status).toBe(200);
    expect(seen.map((s) => s.body.response_format.type)).toEqual(['json_schema', 'json_object']);
  });

  it('napake ponudnika so razumljive in ne razkrijejo odgovora', async () => {
    for (const provider of ['ollama', 'openai', 'anthropic']) {
      await save({ provider, apiKey: 'k' });
      for (const [status, message] of [[401, 'Ponudnik je zavrnil ključ.'], [404, 'Model ali naslov pri ponudniku ne obstaja.']] as const) {
        reply = () => ({ status, body: { error: { message: 'skrivnost strežnika' } } });
        expect(await error(await suggest(ana)), provider).toEqual([502, message]);
      }
      for (const content of ['ni json', '', '[]{', '{"title":']) {
        reply = (path) => ({ body: answers(path, content) });
        expect((await suggest(ana)).status, `${provider} ${content}`).toBe(502);
      }
    }
    reply = (path) => ({ body: { ...answers(path, '{}'), stop_reason: 'refusal' } });
    expect((await suggest(ana)).status).toBe(502);
  });

  it('ne sledi preusmeritvam', async () => {
    await save({ apiKey: 'k' });
    reply = (path) => (path === '/drugam' ? null : { status: 307, body: '', location: `${url}/drugam` });
    expect((await suggest(ana)).status).toBe(502);
    expect(seen.map((s) => s.path)).not.toContain('/drugam');
  });

  it('nedosegljiv strežnik ne porabi branja', async () => {
    await save({ baseUrl: 'http://127.0.0.1:9', dailyLimit: 1 });
    for (let i = 0; i < 3; i++) expect(await error(await suggest(ana))).toEqual([502, 'Strežnik umetne inteligence ni dosegljiv.']);
  });

  it('odgovor v Markdownu in s presežnimi polji', async () => {
    reply = (path) => ({ body: answers(path, `Tu je:\n\`\`\`json\n${JSON.stringify({ ...ANSWER, notes: 'x', status: 'potekla' })}\n\`\`\``) });
    await save();
    const { suggestions } = (await (await suggest(ana)).json()) as SuggestResult;
    expect(Object.keys(suggestions)).toHaveLength(9);
    expect(suggestions).not.toHaveProperty('notes');
  });
});

describe('ključ', () => {
  it('je šifriran in se nikoli ne vrne', async () => {
    const r = await save({ apiKey: 'sk-zelo-skrivno' });
    const view = (await r.json()) as AiView;
    expect(view.settings!.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-zelo');
    expect(JSON.stringify(t.db.prepare('SELECT * FROM settings').all())).not.toContain('sk-zelo');
  });

  it('ne gre na drug naslov ali k drugemu ponudniku', async () => {
    await save({ apiKey: 'sk-zelo-skrivno', baseUrl: 'http://127.0.0.1:9' });
    await t.json('/api/admin/ai/models', settings(), { cookie: admin });
    await t.json('/api/admin/ai/models', settings({ provider: 'openai' }), { cookie: admin });
    await save();
    await allow('ana');
    await suggest(ana);
    expect(seen).toHaveLength(3);
    expect(seen.every((s) => !s.auth)).toBe(true);
  });

  it('ostane ob spremembi drugih nastavitev, Anthropic pa ga zahteva', async () => {
    await save({ apiKey: 'sk-a' });
    await save({ model: 'gemma' });
    await t.json('/api/admin/ai/models', settings(), { cookie: admin });
    expect(seen[0]!.auth).toBe('Bearer sk-a');
    const r = await save({ provider: 'anthropic' });
    expect([r.status, await r.json()]).toEqual([400, { error: 'Preverite označena polja.', fields: { apiKey: 'Vnesite ključ.' } }]);
  });

  it('po spremembi skrivnosti je treba vnesti novega', async () => {
    await save({ apiKey: 'sk-a' });
    await allow('ana');
    const row = t.settings.get<{ apiKey: string }>('ai')!;
    t.settings.set('ai', { ...row, apiKey: Buffer.alloc(60).toString('base64') });
    expect(((await (await t.request('/api/admin/ai', { cookie: admin })).json()) as AiView).unreadableKey).toBe(true);
    expect((await suggest(ana)).status).toBe(409);
  });

  it('zavrne neveljavne naslove', async () => {
    for (const baseUrl of ['', 'ftp://a.si', 'file:///etc/passwd', 'http://u:p@a.si', 'http://a.si/?x=1', 'javascript:alert(1)']) expect((await save({ baseUrl })).status, baseUrl).toBe(400);
    for (const apiKey of ['a b', 'č', 'a\nX: y']) expect((await save({ apiKey })).status, apiKey).toBe(400);
  });
});

describe('omejitve', () => {
  beforeEach(() => allow('ana'));

  it('dnevno število branj velja za vsakega uporabnika posebej', async () => {
    await allow('skrbnik');
    await save({ dailyLimit: 2 });
    expect([(await suggest(ana)).status, (await suggest(ana)).status, (await suggest(ana)).status]).toEqual([200, 200, 409]);
    expect((await suggest(admin)).status).toBe(200);
    t.db.prepare("UPDATE ai_usage SET day = '2020-01-01'").run();
    expect((await suggest(ana)).status).toBe(200);
    expect(t.db.prepare('SELECT COUNT(*) n FROM ai_usage').get()).toEqual({ n: 1 });
  });

  it('hkrati teče eno branje na uporabnika', async () => {
    reply = (path) => ({ body: answers(path, JSON.stringify(ANSWER)), delay: 300 });
    await save();
    const both = await Promise.all([suggest(ana), suggest(ana)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await suggest(ana)).status).toBe(200);
  });

  it('pokvarjene, prazne in napačne datoteke ne pridejo do ponudnika', async () => {
    await save({ dailyLimit: 1 });
    expect((await suggest(ana, '!')).status).toBe(422);
    expect((await suggest(ana, '')).status).toBe(422);
    expect((await t.request('/api/suggestions', { method: 'POST', body: form(null), cookie: ana })).status).toBe(404);
    expect((await t.request('/api/suggestions', { method: 'POST', body: form(null, new TextEncoder().encode('MZ')), cookie: ana })).status).toBe(400);
    expect(seen).toEqual([]);
    expect((await suggest(ana)).status).toBe(200);
  });

  it('datoteka ostane samo med naloženimi', async () => {
    await save();
    await suggest(ana);
    expect(readdirSync(`${t.dataDir}/files`)).toHaveLength(1);
    expect(t.db.prepare('SELECT COUNT(*) n FROM uploads').get()).toEqual({ n: 1 });
    expect(t.db.prepare('SELECT COUNT(*) n FROM contracts').get()).toEqual({ n: 0 });
  });

  it('izbris uporabnika pobriše tudi porabo', async () => {
    await save();
    await suggest(ana);
    await t.request(`/api/admin/users/${users.ana!.id}`, { method: 'DELETE', cookie: admin });
    expect(t.db.prepare('SELECT COUNT(*) n FROM ai_usage').get()).toEqual({ n: 0 });
  });
});

describe('preverjanje odgovora', () => {
  const source = new Source(CONTRACT.split('\f').map((text, i) => ({ page: i + 1, text })));
  const check = (changes: object, organisation = '') => verify({ ...ANSWER, ...changes }, source, organisation);

  it('zavrže izmišljene navedke in vrednosti, ki jih navedek ne potrjuje', () => {
    expect(check({ endDate: { value: '2028-01-15', quote: 'do 15. 1. 2028' } }).endDate).toBeUndefined();
    expect(check({ endDate: { value: '2028-01-15', quote: 'do 15. 1. 2027' } }).endDate).toBeUndefined();
    expect(check({ endDate: { value: '2027-01-15', quote: null } }).endDate).toBeUndefined();
    expect(check({ value: { amount: '9.480,00', period: 'mesecno', quote: 'Mesečno plačilo znaša 1.480,00 EUR' } }).valueCents).toBeUndefined();
    expect(check({ value: { amount: '9.480,00', period: 'mesecno', quote: ANSWER.value.quote } }).valuePeriod).toBeUndefined();
    expect(check({ notice: { amount: 6, unit: 'months', quote: 'Odpovedni rok je 2 meseca' } }).noticeDays).toBeUndefined();
    expect(check({ party: { value: 'Zlonamerni, d. o. o.', quote: 'Sistemi Koren' } }).party).toBeUndefined();
    expect(check({ number: { value: 'X-99', quote: 'X-99' } }).number).toBeUndefined();
    expect(check({ openEnded: { value: true, quote: 'za nedoločen čas' }, endDate: { value: null, quote: null } }).openEnded).toBeUndefined();
    expect(check({ category: 'Kuhinja', title: 'x'.repeat(300) })).not.toHaveProperty('category');
    expect(check({ startDate: { value: '2027-01-15', quote: '15. 1. 2027' }, endDate: { value: '2026-01-15', quote: '15. januarja 2026' } }).endDate).toBeUndefined();
  });

  it('prenese vsak nesmisel', () => {
    for (const raw of [null, 1, 'x', [], {}, { party: 5, notice: [], value: { amount: {} } }, { title: {}, startDate: { value: 3, quote: 4 } }]) expect(verify(raw, source)).toEqual({});
  });

  it('dopušča razlike v presledkih, šumnikih in prelomih vrstic', () => {
    expect(check({ value: { amount: '1.480,00 EUR', period: 'mesecno', quote: 'mesecno  placilo\nznasa 1.480,00' } }).valueCents?.value).toBe(148000);
    expect(check({ startDate: { value: '2026-01-15', quote: 'Velja od 15. januarja 2026 ... 15. 1. 2027' } }).startDate?.page).toBe(1);
  });

  it('lastnega podjetja ne predlaga kot stranke', () => {
    const party = { value: 'Kranjc Oprema, d. o. o.', quote: 'Kranjc Oprema, d. o. o.' };
    expect(check({ party }).party?.value).toBe('Kranjc Oprema, d. o. o.');
    expect(check({ party }, 'KRANJC OPREMA d.o.o.').party).toBeUndefined();
  });

  it('odpovedni rok v mesecih je enak dejanski dolžini, brez datuma poteka pa daljši', () => {
    const s = new Source([{ page: 1, text: 'Velja do 31. 5. 2027. Odpovedni rok treh mesecev.' }]);
    const base = { notice: { amount: 3, unit: 'months', quote: 'Odpovedni rok treh mesecev' }, endDate: { value: '2027-05-31', quote: 'do 31. 5. 2027' } };
    expect(verify(base, s).noticeDays?.value).toBe(92);
    expect(verify({ ...base, endDate: null }, s).noticeDays?.value).toBe(93);
    expect(verify({ ...base, notice: { ...base.notice, amount: 400 } }, s).noticeDays).toBeUndefined();
  });

  it('najde datume in zneske v besedilu', () => {
    expect(datesIn('1. 2. 2026, 03.04.2026, 5/6/2026, 2026-07-08, 9. septembra leta 2026, 10 October 2026, November 11th, 2026, 12. maja 2026')).toEqual(['2026-07-08', '2026-02-01', '2026-04-03', '2026-06-05', '2026-09-09', '2026-10-10', '2026-05-12', '2026-11-11']);
    expect(datesIn('31. 2. 2026, 15. 1., 1.2.20261')).toEqual([]);
    expect(amountsIn('5. člen 1.480,00 EUR, 35 000 EUR, 12,5 % in 1,250.75')).toEqual(expect.arrayContaining([148000, 3500000, 1250, 125075]));
  });

  it('pri dolgih pogodbah prebere cele strani z začetka in konca', () => {
    const pages = Array.from({ length: 30 }, (_, i) => `${i + 1}`.padEnd(100, 'x'));
    const chosen = selectPages(pages, 1000).map((p) => p.page);
    expect(chosen).toEqual([1, 2, 3, 4, 5, 6, 7, 28, 29, 30]);
    expect(selectPages(['a', '', 'b']).map((p) => p.page)).toEqual([1, 3]);
    expect(selectPages(['x'.repeat(2000)], 1000)).toEqual([]);
  });
});

describe('lega navedkov', () => {
  const grid = (text: string) => text.split(' ').map((w, i) => ({ text: w, x: (i % 4) / 4, y: Math.floor(i / 4) / 10, w: 0.2, h: 0.05 }));

  it('združi besede po vrsticah in poišče navedek ne glede na ločila', () => {
    const pages = [{ page: 3, words: grid('Pogodba velja od 15. 1. 2026 do preklica stranke') }];
    expect(marksFor('VELJA od »15. 1. 2026«', pages)).toEqual([{ page: 3, x: 0.25, y: 0, w: 0.7, h: 0.05 }, { page: 3, x: 0, y: 0.1, w: 0.45, h: 0.05 }]);
    expect(marksFor('velja ... preklica', pages)).toHaveLength(2);
    expect(marksFor('ni v besedilu', pages)).toEqual([]);
    expect(marksFor('', pages)).toEqual([]);
    expect(marksFor('velja', [])).toEqual([]);
  });

  it('navedek čez dve strani in deljena beseda', () => {
    const marks = marksFor('odpovedni rok je šestdeset dni', [{ page: 1, words: grid('Odpovedni rok je šest-') }, { page: 2, words: grid('deset dni od') }]);
    expect(marks.map((m) => m.page)).toEqual([1, 2]);
  });

  it('združi tudi navpično zapisane besede', () => {
    const words = ['Pogodba', 'velja', 'od'].map((text, i) => ({ text, x: 0.5, y: 0.1 + i * 0.1, w: 0.03, h: 0.09, upright: text.length > 2 }));
    expect(marksFor('pogodba velja od', [{ page: 1, words }])).toEqual([{ page: 1, x: 0.5, y: 0.1, w: 0.03, h: 0.29 }]);
  });

  it('omeji število oznak', () => {
    expect(marksFor(Array.from({ length: 100 }, (_, i) => `b${i}`).join(' '), [{ page: 1, words: grid(Array.from({ length: 100 }, (_, i) => `b${i}`).join(' ')) }])).toHaveLength(12);
  });

  it('prebere izpis pdftotext', () => {
    const html = '<page width="200.0" height="100.0">\n<word xMin="20" yMin="10" xMax="60" yMax="20">A&amp;B</word>\n<word xMin="-10" yMin="90" xMax="300" yMax="120">rob</word><word xMin="500" yMin="1" xMax="600" yMax="2">zunaj</word>';
    expect(parseBbox(html)).toEqual([{ text: 'A&B', x: 0.1, y: 0.1, w: 0.19999999999999998, h: 0.1 }, { text: 'rob', x: 0, y: 0.9, w: 1, h: 0.09999999999999998 }]);
    const turned = parseBbox('<page width="100" height="200"><word xMin="180" yMin="10" xMax="190" yMax="60">Pogodba</word>', 90);
    expect(turned.map((w) => [w.upright, ...[w.x, w.y, w.w, w.h].map((n) => Math.round(n * 1000) / 1000)])).toEqual([[true, 0.9, 0.1, 0.05, 0.5]]);
    expect(parseBbox('nesmisel')).toEqual([]);
    expect(parseBbox('<page width="0" height="0"><word xMin="1" yMin="1" xMax="2" yMax="2">x</word>')).toEqual([]);
  });

  it('prebere izpis Tesseracta', () => {
    const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t\n5\t1\t1\t1\t1\t1\t100\t200\t50\t40\t96\tPogodba\n5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t95\t \n4\t1\t1\t1\t1\t0\t1\t1\t1\t1\t-1\t';
    expect(parseTsv(tsv).map((w) => [w.text, ...[w.x, w.y, w.w, w.h].map((n) => Math.round(n * 1000) / 1000)])).toEqual([['Pogodba', 0.1, 0.1, 0.05, 0.02]]);
    expect(parseTsv('')).toEqual([]);
  });
});
