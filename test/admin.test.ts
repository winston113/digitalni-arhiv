import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/server/db.js';
import type { ManagedUser, Me } from '../src/shared/users.js';
import { cookies, form, input, PDF, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: string;
let ana: string;
let ids: Record<string, string>;
const all = { create: true, edit: true, remove: true };
const me = async (cookie: string) => (await (await t.request('/api/me', { cookie })).json()) as Me | null;
const send = (method: string, path: string, body: unknown, cookie = admin) =>
  t.json(`/api/admin/users${path}`, body, { method, cookie });
const signIn = (email: string, password: string) => t.json('/api/auth/sign-in/email', { email, password });
const edit = (changes: object = {}) => ({ name: 'Preizkus', role: 'user', disabled: false, permissions: all, ...changes });
const upload = (cookie: string) => t.request('/api/contracts', { method: 'POST', body: form(input, PDF), cookie });

beforeEach(async () => {
  t = await setup();
  admin = await t.register('skrbnik@primer.si');
  ana = await t.register('ana@primer.si');
  const list = (await (await t.request('/api/admin/users', { cookie: admin })).json()) as ManagedUser[];
  ids = Object.fromEntries(list.map((u) => [u.email.split('@')[0], u.id]));
});

describe('vloge', () => {
  it('prvi registrirani je skrbnik, naslednji ne', async () => {
    expect((await me(admin))!.role).toBe('admin');
    expect((await me(ana))!.role).toBe('user');
  });

  it('sočasni registraciji ne dasta dveh skrbnikov', async () => {
    t = await setup();
    await Promise.all(['a', 'b', 'c'].map((n) => t.register(`${n}@primer.si`)));
    expect(t.db.prepare("SELECT COUNT(*) n FROM user_access WHERE role = 'admin'").get()).toEqual({ n: 1 });
  });

  it('vloge ni mogoče nastaviti ob registraciji ali posodobitvi profila', async () => {
    const r = await t.json('/api/auth/sign-up/email', { email: 'z@primer.si', password: 'dolgo-geslo', name: 'Z', role: 'admin', disabled: false }, { headers: { 'x-forwarded-for': '10.7.7.7' } });
    if (r.ok) expect((await me(cookies(r)))!.role).toBe('user');
    await t.json('/api/auth/update-user', { name: 'Ana', role: 'admin' }, { cookie: ana });
    expect((await me(ana))!.role).toBe('user');
  });

  it('običajen uporabnik in gost ne dosežeta skrbniškega dela', async () => {
    const calls: [string, string, unknown][] = [
      ['GET', '', undefined], ['GET', `/${ids.ana}`, undefined], ['POST', '', {}], ['PUT', `/${ids.ana}`, edit({ role: 'admin' })],
      ['POST', `/${ids.skrbnik}/password`, { password: 'novo-geslo-1', mustChangePassword: false }], ['DELETE', `/${ids.skrbnik}`, undefined],
    ];
    for (const [method, path, body] of calls) {
      const init = { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } };
      expect((await t.request(`/api/admin/users${path}`, { ...init, cookie: ana })).status, `${method} ${path}`).toBe(403);
      expect((await t.request(`/api/admin/users${path}`, init)).status).toBe(401);
      if (method !== 'GET') expect((await t.request(`/api/admin/users${path}`, { ...init, cookie: admin, headers: { ...init.headers, origin: 'https://zlo.test' } })).status).toBe(403);
    }
    expect((await me(ana))!.role).toBe('user');
  });

  it('skrbnik ne vidi tujih pogodb, samo njihovo število', async () => {
    const { id } = (await (await upload(ana)).json()) as { id: string };
    expect((await t.request(`/api/contracts/${id}`, { cookie: admin })).status).toBe(404);
    expect((await t.request(`/api/contracts/${id}/file`, { cookie: admin })).status).toBe(404);
    const user = (await (await t.request(`/api/admin/users/${ids.ana}`, { cookie: admin })).json()) as ManagedUser;
    expect(user.contracts).toBe(1);
    expect(JSON.stringify(user)).not.toMatch(/Najem|hash|password":"/);
  });

  it('skrbnik ostane: sebe ne more odstraniti', async () => {
    for (const change of [{ role: 'user' }, { role: 'admin', disabled: true }]) expect((await send('PUT', `/${ids.skrbnik}`, edit(change))).status).toBe(409);
    expect((await send('DELETE', `/${ids.skrbnik}`, {})).status).toBe(409);
    expect((await send('PUT', `/${ids.ana}`, edit({ role: 'admin' }))).status).toBe(200);
    expect((await send('PUT', `/${ids.skrbnik}`, edit({ role: 'user' }), ana)).status).toBe(200);
    expect((await t.request('/api/admin/users', { cookie: admin })).status).toBe(403);
  });
});

describe('ustvarjanje in gesla', () => {
  const fresh = { name: 'Nina Novak', email: ' Nina@Primer.si ', password: 'zacasno-geslo', mustChangePassword: true, role: 'user', permissions: all };

  it('ustvari uporabnika, ki mora najprej spremeniti geslo', async () => {
    const r = await send('POST', '', fresh);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ email: 'nina@primer.si', role: 'user', mustChangePassword: true, hasPassword: true });
    const nina = cookies(await signIn('nina@primer.si', 'zacasno-geslo'));
    expect((await t.request('/api/contracts', { cookie: nina })).status).toBe(403);
    const change = (currentPassword: string, newPassword: string) => t.json('/api/password', { currentPassword, newPassword }, { cookie: nina });
    expect((await change('napačno', 'moje-novo-geslo')).status).toBe(400);
    expect((await change('zacasno-geslo', 'zacasno-geslo')).status).toBe(400);
    const done = await change('zacasno-geslo', 'moje-novo-geslo');
    expect(done.status).toBe(200);
    const after = cookies(done) || nina;
    expect((await t.request('/api/contracts', { cookie: after })).status).toBe(200);
    expect((await signIn('nina@primer.si', 'zacasno-geslo')).status).toBe(401);
  });

  it('zavrne podvojen naslov in neveljaven vnos s slovenskimi sporočili', async () => {
    expect((await send('POST', '', { ...fresh, email: 'ANA@primer.si' })).status).toBe(409);
    const r = (await (await send('POST', '', { ...fresh, email: 'x', name: '', password: 'a', role: 'kralj' })).json()) as { fields: Record<string, string> };
    expect(Object.keys(r.fields).sort()).toEqual(['email', 'name', 'password', 'role']);
    expect(Object.values(r.fields).join()).not.toMatch(/Invalid|expected/i);
  });

  it('ponastavi geslo, konča seje in zahteva spremembo', async () => {
    expect((await send('POST', `/${ids.ana}/password`, { password: 'kratko', mustChangePassword: true })).status).toBe(400);
    expect((await send('POST', `/${ids.ana}/password`, { password: 'ponastavljeno-1', mustChangePassword: true })).status).toBe(200);
    expect((await t.request('/api/contracts', { cookie: ana })).status).toBe(401);
    expect((await signIn('ana@primer.si', 'dolgo-geslo')).status).toBe(401);
    expect((await me(cookies(await signIn('ana@primer.si', 'ponastavljeno-1'))))!.mustChangePassword).toBe(true);
  });

  it('skrbnik z začasnim geslom ne more upravljati uporabnikov', async () => {
    await send('POST', '', { ...fresh, role: 'admin' });
    const nina = cookies(await signIn('nina@primer.si', 'zacasno-geslo'));
    expect((await t.request('/api/admin/users', { cookie: nina })).status).toBe(403);
  });
});

describe('dovoljenja in blokiranje', () => {
  it('vsako dovoljenje zapre natanko svoja dejanja', async () => {
    const { id } = (await (await upload(ana)).json()) as { id: string };
    const attempts = {
      create: () => upload(ana),
      edit: () => t.request(`/api/contracts/${id}`, { method: 'PUT', body: form(input), cookie: ana }),
      extend: () => t.json(`/api/contracts/${id}/extend`, { endDate: '2099-01-01' }, { cookie: ana }),
      terminate: () => t.json(`/api/contracts/${id}/terminate`, {}, { cookie: ana }),
      remove: () => t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana }),
    };
    await send('PUT', `/${ids.ana}`, edit({ permissions: { create: false, edit: false, remove: false } }));
    for (const [name, run] of Object.entries(attempts)) expect((await run()).status, name).toBe(403);
    expect((await t.request(`/api/contracts/${id}/file`, { cookie: ana })).status).toBe(200);
    await send('PUT', `/${ids.ana}`, edit({ permissions: { create: false, edit: true, remove: false } }));
    expect((await attempts.extend()).status).toBe(200);
    expect((await attempts.create()).status).toBe(403);
    expect((await attempts.remove()).status).toBe(403);
    await send('PUT', `/${ids.ana}`, edit({ permissions: { create: false, edit: false, remove: true } }));
    expect((await attempts.remove()).status).toBe(204);
  });

  it('blokiranje takoj konča seje in prepreči prijavo', async () => {
    await send('PUT', `/${ids.ana}`, edit({ disabled: true }));
    expect((await t.request('/api/contracts', { cookie: ana })).status).toBe(401);
    expect(await me(ana)).toBeNull();
    const r = await signIn('ana@primer.si', 'dolgo-geslo');
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    await send('PUT', `/${ids.ana}`, edit());
    expect((await signIn('ana@primer.si', 'dolgo-geslo')).status).toBe(200);
  });

  it('brisanje uporabnika izbriše njegove pogodbe, datoteke in seje, drugih ne', async () => {
    await upload(ana);
    await upload(admin);
    expect((await send('DELETE', `/${ids.ana}`, {})).status).toBe(204);
    expect(readdirSync(join(t.dataDir, 'files'))).toHaveLength(1);
    for (const table of ['session', 'account']) expect(t.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE userId = ?`).get(ids.ana!)).toEqual({ n: 0 });
    expect((await signIn('ana@primer.si', 'dolgo-geslo')).status).toBe(401);
  });

  it('omeji skupni prostor', async () => {
    t = await setup({ STORAGE_LIMIT_MB: '0.00002' });
    const c = await t.register('x@primer.si');
    expect((await upload(c)).status).toBe(201);
    expect((await upload(c)).status).toBe(507);
    expect(readdirSync(join(t.dataDir, 'files'))).toHaveLength(1);
  });
});

it('nadgradnja obstoječe baze: najstarejši uporabnik postane skrbnik', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, createdAt TEXT); INSERT INTO user VALUES ('mlajši', '2026-02-01'), ('starejši', '2026-01-01')");
  migrate(db);
  expect(db.prepare('SELECT user_id, role FROM user_access ORDER BY role').all()).toEqual([{ user_id: 'starejši', role: 'admin' }, { user_id: 'mlajši', role: 'user' }]);
});
