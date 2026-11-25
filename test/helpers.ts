import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { Ai } from '../src/server/ai.js';
import { AuthHolder, createAuth, migrateAuth } from '../src/server/auth.js';
import { loadConfig } from '../src/server/config.js';
import { ContractStore } from '../src/server/contracts.js';
import type { Extract, PageWords } from '../src/server/extract.js';
import { Indexer } from '../src/server/indexer.js';
import { Mail, type Message, type Smtp } from '../src/server/mail.js';
import { Oidc } from '../src/server/oidc.js';
import { Reminders } from '../src/server/reminders.js';
import { Settings } from '../src/server/settings.js';
import { migrate, openDb } from '../src/server/db.js';
import { UserStore } from '../src/server/users.js';

export const ORIGIN = 'http://arhiv.test';
export const PDF = new TextEncoder().encode('%PDF-1.4\nvsebina');

// Omejevanje zahtev je skupno procesu, zato ima vsak preizkus svoj naslov.
let ip = 0;
const address = () => `10.1.${ip >> 8}.${ip & 255}`;

export async function setup(env: Record<string, string> = {}, realExtract?: Extract) {
  const dataDir = mkdtempSync(join(tmpdir(), 'arhiv-'));
  const config = loadConfig({ DATA_DIR: dataDir, BASE_URL: ORIGIN, TRUST_PROXY: 'true', ...env });
  const db = openDb(dataDir);
  const mails: (Message & { smtp: Smtp })[] = [];
  const control = { fail: null as unknown };
  const settings = new Settings(db, config.secret);
  const mail = new Mail(config, settings, async (smtp, message) => {
    if (control.fail) throw control.fail;
    mails.push({ ...message, smtp });
  });
  await migrateAuth(createAuth(config, db, mail, null));
  migrate(db);
  new UserStore(db).ensureTrigger();
  const oidc = new Oidc(config, settings);
  const auth = new AuthHolder(() => createAuth(config, db, mail, oidc.current));
  const reminders = new Reminders(config, db, new ContractStore(db, dataDir), mail, settings);
  // Vsebina preizkusne datoteke po glavi je njeno besedilo; \f loči strani, ! pomeni pokvarjeno datoteko.
  const extract: Extract = realExtract ?? (async (path) => {
    const text = readFileSync(path, 'utf8').replace(/^%PDF-1\.4\n?/, '');
    if (text.startsWith('!')) throw new Error('pokvarjena');
    return { pages: text.split('\f'), method: text ? 'text' : 'empty' };
  });
  // Besede so na preizkusni strani v mreži: deset na vrstico, vrstica je visoka dva odstotka strani.
  const pageWords: PageWords = async (path, page) => (await extract(path)).pages[page - 1]!.split(/\s+/)
    .map((text, i) => ({ text, x: (i % 10) / 10, y: Math.floor(i / 10) / 50, w: 0.09, h: 0.018 }));
  const indexer = new Indexer(db, dataDir, extract, 4);
  const app = createApp(config, db, auth, mail, oidc, reminders, indexer, new Ai(db, settings, env.ANTHROPIC_TEST_URL), {
    extract, pageWords,
    countPages: async (path) => (await extract(path)).pages.length,
    split: async (path, from, to, out) => writeFileSync(out, `%PDF-1.4\n${(await extract(path)).pages.slice(from - 1, to).join('\f')}`),
  });
  ip++;
  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => (init.body instanceof FormData ? submit(path, init as typeof init & { body: FormData }) : send(path, init));
  // Obrazec z datoteko: najprej nalaganje, nato zahteva, ki se nanj sklicuje.
  const submit = async (path: string, init: RequestInit & { cookie?: string; body: FormData }) => {
    const file = init.body.get('file');
    let upload: string | null = null;
    if (file instanceof File) {
      const sent = await send('/api/uploads', { ...init, method: 'POST', body: await file.arrayBuffer(), headers: { ...(init.headers as object), 'content-length': String(file.size), 'x-file-name': encodeURIComponent(file.name) } });
      if (sent.status !== 201) return sent;
      upload = ((await sent.json()) as { id: string }).id;
    }
    const body = path.endsWith('/attachments') ? { upload } : { data: JSON.parse(String(init.body.get('data'))), upload };
    return path === '/api/suggestions' ? send(`/api/uploads/${upload}/suggest`, { ...init, body: undefined })
      : send(path, { ...init, body: JSON.stringify(body), headers: { ...(init.headers as object), 'content-type': 'application/json' } });
  };
  const send = (path: string, init: RequestInit & { cookie?: string } = {}) => {
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
  return { app, db, users: new UserStore(db), dataDir, request, json, register, mails, mail, reminders, indexer, settings, control };
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
