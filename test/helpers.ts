import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { createAuth, migrateAuth } from '../src/server/auth.js';
import { loadConfig } from '../src/server/config.js';
import { migrate, openDb } from '../src/server/db.js';
import { UserStore } from '../src/server/users.js';

export const ORIGIN = 'http://arhiv.test';
export const PDF = new TextEncoder().encode('%PDF-1.4\nvsebina');

// Omejevanje zahtev je skupno procesu, zato ima vsak preizkus svoj naslov.
let ip = 0;
const address = () => `10.1.${ip >> 8}.${ip & 255}`;

export async function setup(env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'arhiv-'));
  const config = loadConfig({ DATA_DIR: dataDir, BASE_URL: ORIGIN, TRUST_PROXY: 'true', ...env });
  const db = openDb(dataDir);
  const mails: { to: string; text: string }[] = [];
  const auth = createAuth(config, db, config.smtp ? async (to, _s, text) => { mails.push({ to, text }); } : null);
  await migrateAuth(auth);
  migrate(db);
  new UserStore(db).ensureTrigger();
  const app = createApp(config, db, auth);
  ip++;
  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', ORIGIN);
    if (init.cookie) headers.set('cookie', init.cookie);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', address());
    return app.request(`${ORIGIN}${path}`, { ...init, headers });
  };
  const json = (path: string, body: unknown, extra: RequestInit & { cookie?: string } = {}) =>
    request(path, { method: 'POST', body: JSON.stringify(body), ...extra, headers: { 'content-type': 'application/json', ...(extra.headers as object) } });
  const register = async (email: string) => {
    ip++;
    const r = await json('/api/auth/sign-up/email', { email, password: 'dolgo-geslo', name: 'Preizkus' });
    if (r.status !== 200) throw new Error(await r.text());
    return cookies(r);
  };
  return { app, db, users: new UserStore(db), dataDir, request, json, register, mails };
}

export const cookies = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

export const input = {
  title: 'Najem poslovnih prostorov', party: 'Nepremičnine Javor, d. o. o.', category: 'Najem', number: 'N-1',
  startDate: '2026-01-01', endDate: '2027-01-01', noticeDays: 30, warnDays: 30, valueCents: 48000, valuePeriod: 'mesecno', notes: null,
};

export function form(data: unknown, file?: Uint8Array, name = 'pogodba č.pdf') {
  const f = new FormData();
  f.set('data', JSON.stringify(data));
  if (file) f.set('file', new File([file as BlobPart], name, { type: 'application/pdf' }));
  return f;
}
