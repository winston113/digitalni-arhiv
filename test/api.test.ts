import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookies, form, input, PDF, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let ana: string;
let bor: string;
const files = () => readdirSync(join(t.dataDir, 'files'));

beforeEach(async () => {
  t = await setup();
  ana = await t.register('ana@primer.si');
  bor = await t.register('bor@primer.si');
});

async function create(cookie = ana, data: unknown = input) {
  const r = await t.request('/api/contracts', { method: 'POST', body: form(data, PDF), cookie });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; status: string; fileName: string };
}

describe('ločenost uporabnikov', () => {
  it('drug uporabnik ne doseže pogodbe ali datoteke na noben način', async () => {
    const { id } = await create();
    const json = { 'content-type': 'application/json' };
    const attempts: [string, RequestInit][] = [
      [`/api/contracts/${id}`, {}],
      [`/api/contracts/${id}/file`, {}],
      [`/api/contracts/${id}`, { method: 'PUT', body: form({ ...input, title: 'Vdor' }, PDF) }],
      [`/api/contracts/${id}/extend`, { method: 'POST', body: JSON.stringify({ endDate: '2030-01-01' }), headers: json }],
      [`/api/contracts/${id}/terminate`, { method: 'POST' }],
      [`/api/contracts/${id}`, { method: 'DELETE' }],
    ];
    for (const [path, init] of attempts) expect((await t.request(path, { ...init, cookie: bor })).status, `${init.method ?? 'GET'} ${path}`).toBe(404);
    expect(await (await t.request('/api/contracts', { cookie: bor })).json()).toEqual([]);
    const mine = await (await t.request(`/api/contracts/${id}`, { cookie: ana })).json();
    expect(mine).toMatchObject({ title: input.title, endDate: input.endDate, terminatedAt: null });
    // Datoteka, ki jo je drug uporabnik samo naložil, ostane njegova do samodejnega izbrisa.
    expect(files()).toHaveLength(2);
  });

  it('brez prijave ni dostopa', async () => {
    const { id } = await create();
    for (const path of ['', `/${id}`, `/${id}/file`]) expect((await t.request(`/api/contracts${path}`)).status).toBe(401);
  });

  it('zavrne spremembe z druge strani (CSRF)', async () => {
    const { id } = await create();
    const r = await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana, headers: { origin: 'https://zlonamerno.test' } });
    expect(r.status).toBe(403);
    expect((await t.request(`/api/contracts/${id}`, { cookie: ana })).status).toBe(200);
  });

  it('po odjavi seja ne velja več', async () => {
    const r = await t.json('/api/auth/sign-out', {}, { cookie: ana });
    expect(r.status).toBe(200);
    expect((await t.request('/api/contracts', { cookie: ana })).status).toBe(401);
  });
});

describe('pogodbe', () => {
  it('ustvari, uredi, zamenja datoteko in izbriše', async () => {
    const { id, fileName } = await create();
    expect(fileName).toBe('pogodba č.pdf');
    const first = files();
    const r = await t.request(`/api/contracts/${id}`, { method: 'PUT', body: form({ ...input, title: 'Nov naziv' }, PDF, 'nova.pdf'), cookie: ana });
    expect(await r.json()).toMatchObject({ title: 'Nov naziv', fileName: 'nova.pdf' });
    expect(files()).toHaveLength(1);
    expect(files()).not.toEqual(first);
    const keep = await t.request(`/api/contracts/${id}`, { method: 'PUT', body: form(input), cookie: ana });
    expect(await keep.json()).toMatchObject({ title: input.title, fileName: 'nova.pdf' });
    expect((await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana })).status).toBe(204);
    expect(files()).toHaveLength(0);
  });

  it('vrne PDF s pravilnimi glavami', async () => {
    const { id } = await create();
    const r = await t.request(`/api/contracts/${id}/file`, { cookie: ana });
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''pogodba%20%C4%8D.pdf");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
    expect((await t.request(`/api/contracts/${id}/file?prenos`, { cookie: ana })).headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it('zavrne manjkajočo, preveliko ali napačno datoteko in ničesar ne shrani', async () => {
    const send = async (file?: Uint8Array) => {
      const r = await t.request('/api/contracts', { method: 'POST', body: form(input, file), cookie: ana });
      const body = (await r.json()) as { error: string; fields?: { file: string } };
      return [r.status, body.fields?.file ?? body.error];
    };
    t = await setup({ MAX_FILE_MB: '1' });
    ana = await t.register('ana@primer.si');
    expect(await send()).toEqual([400, 'Izberite datoteko PDF ali DOCX.']);
    expect((await send(new TextEncoder().encode('<html>')))[1]).toMatch(/ni v obliki PDF/);
    expect((await send(new TextEncoder().encode('%PD')))[1]).toMatch(/ni v obliki PDF/);
    expect(await send(new Uint8Array(0))).toEqual([400, 'Izberite datoteko PDF ali DOCX.']);
    const big = new Uint8Array(1024 * 1024 + 1); big.set(PDF);
    expect(await send(big)).toEqual([413, expect.stringMatching(/prevelika/)]);
    expect(files()).toHaveLength(0);
  });

  it('podaljša samo na poznejši datum', async () => {
    const { id } = await create();
    const extend = (endDate: string) => t.json(`/api/contracts/${id}/extend`, { endDate }, { cookie: ana });
    expect((await extend('2027-01-01')).status).toBe(400);
    expect(await (await extend('2099-01-01')).json()).toMatchObject({ endDate: '2099-01-01', status: 'aktivna' });
  });

  it('prekinjene pogodbe ni mogoče podaljšati ali znova prekiniti', async () => {
    const { id } = await create();
    const post = (a: string, b: unknown = {}) => t.json(`/api/contracts/${id}/${a}`, b, { cookie: ana });
    expect(await (await post('terminate')).json()).toMatchObject({ status: 'prekinjena' });
    expect((await post('terminate')).status).toBe(409);
    expect((await post('extend', { endDate: '2099-01-01' })).status).toBe(409);
  });

  it('datoteke ne more zapisati izven svoje mape', async () => {
    const r = await t.request('/api/contracts', { method: 'POST', body: form(input, PDF, '../../x/"zlo.pdf'), cookie: ana });
    expect(((await r.json()) as { fileName: string }).fileName).toBe('zlo.pdf');
    expect(files()).toHaveLength(1);
  });
});

describe('prijava', () => {
  it('zavrne prekratko geslo in podvojen račun', async () => {
    const up = (email: string, password: string) => t.json('/api/auth/sign-up/email', { email, password, name: 'X' }, { headers: { 'x-forwarded-for': '10.9.9.9' } });
    expect((await up('nov@primer.si', 'kratko')).status).toBe(400);
    expect((await up('ana@primer.si', 'dolgo-geslo')).status).toBe(422);
  });

  it('omeji ponavljanje napačnih gesel, tudi če odjemalec ponareja naslov', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await t.json('/api/auth/sign-in/email', { email: 'ana@primer.si', password: 'napačno' }, { headers: { 'x-forwarded-for': `1.1.1.${i}, 10.8.8.8`, 'x-arhiv-client-ip': `2.2.2.${i}` } })).status;
    }
    expect(last).toBe(429);
  });

  it('registracijo je mogoče izklopiti', async () => {
    t = await setup({ REGISTRATION: 'false' });
    expect((await t.json('/api/auth/sign-up/email', { email: 'x@primer.si', password: 'dolgo-geslo', name: 'X' })).status).toBe(400);
    expect(await (await t.request('/api/config')).json()).toMatchObject({ registration: { local: false, oidc: false } });
  });

  it('ponastavi geslo in odjavi stare seje', async () => {
    t = await setup({ SMTP_HOST: 'posta.test', SMTP_FROM: 'arhiv@primer.si' });
    const old = await t.register('ana@primer.si');
    expect((await t.json('/api/auth/request-password-reset', { email: 'neznan@primer.si', redirectTo: '/novo-geslo' })).status).toBe(200);
    expect(t.mails).toHaveLength(0);
    await t.json('/api/auth/request-password-reset', { email: 'ana@primer.si', redirectTo: '/novo-geslo' });
    expect(t.mails[0]!.to).toBe('ana@primer.si');
    const link = new URL(t.mails[0]!.text.match(/https?:\S+/)![0]);
    const hop = await t.request(link.pathname + link.search);
    const token = new URL(hop.headers.get('location')!, link).searchParams.get('token');
    expect(hop.headers.get('location')).toContain('/novo-geslo');
    expect((await t.json('/api/auth/reset-password', { token, newPassword: 'novo-dolgo-geslo' })).status).toBe(200);
    expect((await t.request('/api/contracts', { cookie: old })).status).toBe(401);
    const again = await t.json('/api/auth/sign-in/email', { email: 'ana@primer.si', password: 'novo-dolgo-geslo' });
    expect(again.status).toBe(200);
    expect((await t.request('/api/contracts', { cookie: cookies(again) })).status).toBe(200);
  });
});
