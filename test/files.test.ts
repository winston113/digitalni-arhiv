import { unzipSync, strFromU8 } from 'fflate';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { safeName } from '../src/server/export.js';
import { xlsx } from '../src/server/xlsx.js';
import type { Attachment, ContractDetails } from '../src/shared/contracts.js';
import { form, input, PDF, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let ana: string;
let bor: string;
const files = () => readdirSync(join(t.dataDir, 'files'));
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n${text}`);
const create = async (cookie = ana, over: object = {}) => {
  const r = await t.request('/api/contracts', { method: 'POST', body: form({ ...input, ...over }, PDF), cookie });
  expect(r.status).toBe(201);
  return ((await r.json()) as ContractDetails).id;
};
const attach = (id: string, cookie = ana, body = pdf('aneks'), name = 'aneks 1.pdf') =>
  t.request(`/api/contracts/${id}/attachments`, { method: 'POST', body: form(null, body, name), cookie });
const get = async (id: string) => (await (await t.request(`/api/contracts/${id}`, { cookie: ana })).json()) as ContractDetails;

beforeEach(async () => {
  t = await setup();
  ana = await t.register('ana@primer.si');
  bor = await t.register('bor@primer.si');
});

describe('priloge', () => {
  it('doda, prenese in izbriše', async () => {
    const id = await create();
    expect((await get(id)).attachments).toEqual([]);
    const list = (await (await attach(id)).json()) as Attachment[];
    expect(list).toMatchObject([{ name: 'aneks 1.pdf', size: pdf('aneks').length }]);
    const path = `/api/contracts/${id}/attachments/${list[0]!.id}`;
    const r = await t.request(`${path}/file`, { cookie: ana });
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(pdf('aneks'));
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect((await t.request(`${path}/file?prenos`, { cookie: ana })).headers.get('content-disposition')).toMatch(/^attachment/);
    expect(await (await t.request(path, { method: 'DELETE', cookie: ana })).json()).toEqual([]);
    expect(files()).toHaveLength(1);
    expect((await t.request(`${path}/file`, { cookie: ana })).status).toBe(404);
  });

  it('drug uporabnik, gost in napačna pogodba nimajo dostopa', async () => {
    const id = await create();
    const other = await create(ana, { title: 'Druga' });
    const foreign = await create(bor);
    const [a] = (await (await attach(id)).json()) as Attachment[];
    for (const cid of [id, foreign]) {
      expect((await t.request(`/api/contracts/${cid}/attachments/${a!.id}/file`, { cookie: bor })).status).toBe(404);
      expect((await t.request(`/api/contracts/${cid}/attachments/${a!.id}`, { method: 'DELETE', cookie: bor })).status).toBe(404);
    }
    expect((await attach(id, bor)).status).toBe(404);
    expect((await t.request(`/api/contracts/${other}/attachments/${a!.id}/file`, { cookie: ana })).status).toBe(404);
    expect((await t.request(`/api/contracts/${id}/attachments/${a!.id}/file`)).status).toBe(401);
    expect((await t.request(`/api/contracts/${id}/attachments/${a!.id}`, { method: 'DELETE', cookie: ana, headers: { origin: 'https://zlo.test' } })).status).toBe(403);
    expect((await get(id)).attachments).toHaveLength(1);
    expect(files()).toHaveLength(4);
  });

  it('zavrne napačne datoteke in preveč prilog, ničesar ne pusti na disku', async () => {
    const id = await create();
    expect((await attach(id, ana, new TextEncoder().encode('<html>'))).status).toBe(400);
    expect((await t.request(`/api/contracts/${id}/attachments`, { method: 'POST', body: form(null), cookie: ana })).status).toBe(400);
    const results = await Promise.all(Array.from({ length: 33 }, () => attach(id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(30);
    expect(files()).toHaveLength(31);
  });

  it('brisanje pogodbe ali uporabnika izbriše tudi priloge', async () => {
    const id = await create();
    await attach(id);
    await attach(id);
    expect((await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana })).status).toBe(204);
    expect(files()).toHaveLength(0);
    await attach(await create(bor), bor);
    const user = t.db.prepare("SELECT id FROM user WHERE email = 'bor@primer.si'").get() as { id: string };
    expect((await t.json(`/api/admin/users/${user.id}`, {}, { method: 'DELETE', cookie: ana })).status).toBe(204);
    expect(files()).toHaveLength(0);
    expect(t.db.prepare('SELECT COUNT(*) n FROM attachments').get()).toEqual({ n: 0 });
  });

  it('ostanejo po urejanju in podaljšanju ter štejejo v omejitev prostora', async () => {
    const id = await create();
    await attach(id);
    const put = await t.request(`/api/contracts/${id}`, { method: 'PUT', body: form(input, PDF), cookie: ana });
    expect(((await put.json()) as ContractDetails).attachments).toHaveLength(1);
    const ext = await t.json(`/api/contracts/${id}/extend`, { endDate: '2099-01-01' }, { cookie: ana });
    expect(((await ext.json()) as ContractDetails).attachments).toHaveLength(1);
    t = await setup({ STORAGE_LIMIT_MB: '0.000025' });
    ana = await t.register('x@primer.si');
    const small = await create();
    expect((await attach(small)).status).toBe(507);
  });

  it('brez dovoljenja za urejanje jih ni mogoče spreminjati', async () => {
    const id = await create(bor);
    const [a] = (await (await attach(id, bor)).json()) as Attachment[];
    const user = t.db.prepare("SELECT id FROM user WHERE email = 'bor@primer.si'").get() as { id: string };
    await t.json(`/api/admin/users/${user.id}`, { name: 'B', role: 'user', disabled: false, permissions: { create: true, edit: false, remove: true } }, { method: 'PUT', cookie: ana });
    expect((await attach(id, bor)).status).toBe(403);
    expect((await t.request(`/api/contracts/${id}/attachments/${a!.id}`, { method: 'DELETE', cookie: bor })).status).toBe(403);
    expect((await t.request(`/api/contracts/${id}/attachments/${a!.id}/file`, { cookie: bor })).status).toBe(200);
  });
});

describe('izvoz', () => {
  const run = async (cookie = ana) => {
    const r = await t.request('/api/export', { cookie });
    expect(r.status).toBe(200);
    return unzipSync(new Uint8Array(await r.arrayBuffer()));
  };
  const sheet = (zip: Record<string, Uint8Array>) => strFromU8(unzipSync(zip[Object.keys(zip).find((n) => n.endsWith('.xlsx'))!]!)['xl/worksheets/sheet1.xml']!);

  it('vsebuje vse lastne datoteke in preglednico, tujih ne', async () => {
    const id = await create(ana, { title: 'Najem: pisarna / 1. nadstropje' });
    await attach(id);
    await attach(id, ana, pdf('drugi'), 'ANEKS 1.pdf');
    await create(bor, { title: 'Tuja skrivnost' });
    const zip = await run();
    const names = Object.keys(zip).sort();
    expect(names.filter((n) => n.startsWith('dokumenti/'))).toEqual([
      'dokumenti/001 Najem pisarna 1. nadstropje/pogodba č.pdf',
      'dokumenti/001 Najem pisarna 1. nadstropje/priloge/ANEKS 1 (2).pdf',
      'dokumenti/001 Najem pisarna 1. nadstropje/priloge/aneks 1.pdf',
    ]);
    expect(zip['dokumenti/001 Najem pisarna 1. nadstropje/priloge/ANEKS 1 (2).pdf']).toEqual(pdf('drugi'));
    expect(names).toHaveLength(4);
    expect(sheet(zip)).toContain('Najem: pisarna / 1. nadstropje');
    expect(sheet(zip)).not.toContain('Tuja skrivnost');
  });

  it('prazen arhiv, jezik in prijava', async () => {
    expect(Object.keys(await run())).toHaveLength(1);
    await t.json('/api/me/language', { language: 'en' }, { method: 'PUT', cookie: ana });
    await create();
    const zip = await run();
    expect(Object.keys(zip).some((n) => n.startsWith('documents/001 '))).toBe(true);
    expect(sheet(zip)).toContain('Other party');
    expect((await t.request('/api/export')).status).toBe(401);
  });

  it('hkrati teče en izvoz; po prekinitvi ga je mogoče začeti znova', async () => {
    await create();
    const first = await t.request('/api/export', { cookie: ana });
    expect((await t.request('/api/export', { cookie: ana })).status).toBe(409);
    expect((await t.request('/api/export', { cookie: bor })).status).toBe(200);
    await first.body!.cancel();
    await run();
    await run();
  });

  it('imena ne morejo zapustiti mape ali pokvariti zapisa', () => {
    expect(safeName('../../etc/passwd')).not.toMatch(/\/|^\./);
    expect(safeName('a‮txt.exe<>:"|?*')).toBe('a txt.exe');
    expect(safeName('...')).toBe('datoteka');
    expect([...safeName('š'.repeat(300))].length).toBe(80);
  });

  it('besedilo, ki je videti kot formula, ostane besedilo', () => {
    const xml = strFromU8(unzipSync(xlsx('A', ['H'], [['=HYPERLINK("http://zlo")'], ['<b>&\u0007']], [10]))['xl/worksheets/sheet1.xml']!);
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain('&lt;b&gt;&amp;</t>');
  });
});
