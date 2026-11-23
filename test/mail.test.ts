import { beforeEach, describe, expect, it } from 'vitest';
import { composeReminder } from '../src/server/reminders.js';
import type { MailView } from '../src/shared/mail.js';
import { addDays, today } from '../src/shared/dates.js';
import { form, input, PDF, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: string;
let ana: string;
const smtp = { host: 'in-v3.mailjet.com', port: 587, security: 'starttls', user: 'kljuc', password: 'zelo-skrivno', from: 'arhiv@primer.si', fromName: 'Arhiv' };
const call = (method: string, path: string, body: unknown = {}, cookie = admin) => t.json(`/api/admin/mail${path}`, body, { method, cookie });
const view = async () => (await (await t.request('/api/admin/mail', { cookie: admin })).json()) as MailView;
const verify = (email: string) => t.db.prepare('UPDATE user SET emailVerified = 1 WHERE email = ?').run(email);
const add = async (cookie: string, over: object = {}) => {
  const r = await t.request('/api/contracts', { method: 'POST', body: form({ ...input, startDate: '2020-01-01', noticeDays: 0, warnDays: 30, ...over }, PDF), cookie });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
};
const inDays = (n: number) => addDays(today(), n);

beforeEach(async () => {
  t = await setup();
  admin = await t.register('skrbnik@primer.si');
  ana = await t.register('ana@primer.si');
});

describe('nastavitve pošte', () => {
  it('geslo je šifrirano in se nikoli ne vrne', async () => {
    const r = await call('PUT', '', smtp);
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain('zelo-skrivno');
    expect(JSON.stringify(t.db.prepare('SELECT * FROM settings').all())).not.toContain('zelo-skrivno');
    expect(await view()).toMatchObject({ source: 'panel', settings: { host: smtp.host, hasPassword: true } });
    await call('POST', '/test');
    expect(t.mails[0]).toMatchObject({ to: 'skrbnik@primer.si', smtp: { password: 'zelo-skrivno', security: 'starttls' } });
  });

  it('shranjeno geslo ostane, a se ne pošlje drugemu strežniku', async () => {
    await call('PUT', '', smtp);
    await call('PUT', '', { ...smtp, password: null, fromName: 'Novo ime' });
    await call('POST', '/test');
    expect(t.mails[0]!.smtp.password).toBe('zelo-skrivno');
    await call('PUT', '', { ...smtp, password: null, host: 'zlo.test' });
    await call('POST', '/test');
    expect(t.mails[1]!.smtp).toMatchObject({ host: 'zlo.test', password: '' });
  });

  it('samo za skrbnike', async () => {
    for (const [m, p] of [['GET', ''], ['PUT', ''], ['DELETE', ''], ['PUT', '/uses'], ['POST', '/test'], ['POST', '/reminders']] as const) {
      const init = m === 'GET' ? { cookie: ana } : { method: m, body: '{}', cookie: ana, headers: { 'content-type': 'application/json' } };
      expect((await t.request(`/api/admin/mail${p}`, init)).status, m + p).toBe(403);
    }
    expect((await t.request('/api/admin/oidc', { cookie: ana })).status).toBe(403);
  });

  it('zavrne neveljaven vnos in vstavljanje glav', async () => {
    const r = await call('PUT', '', { ...smtp, host: 'a b', port: 0, security: 'x', from: 'x\r\nBcc: y@z.si', fromName: 'a\r\nBcc: y' });
    expect(Object.keys(((await r.json()) as { fields: object }).fields).sort()).toEqual(['from', 'fromName', 'host', 'port', 'security']);
  });

  it('nastavitve iz okolja imajo prednost in so samo za branje', async () => {
    t = await setup({ SMTP_HOST: 'posta.test', SMTP_FROM: 'a@primer.si', SMTP_PORT: '465' });
    admin = await t.register('skrbnik@primer.si');
    expect(await view()).toMatchObject({ source: 'env', settings: { host: 'posta.test', security: 'tls' } });
    expect((await call('PUT', '', smtp)).status).toBe(409);
    expect((await call('DELETE', '')).status).toBe(409);
  });

  it('napako pošiljanja razloži', async () => {
    await call('PUT', '', smtp);
    t.control.fail = Object.assign(new Error('x'), { code: 'EAUTH', response: '535 no' });
    const r = await call('POST', '/test');
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/zavrnil prijavo.*535 no/);
  });

  it('ponastavitev gesla je mogoče izklopiti in poslati povezavo iz skrbniškega dela', async () => {
    const config = async () => (await (await t.request('/api/config')).json()) as { passwordReset: boolean };
    expect((await config()).passwordReset).toBe(false);
    await call('PUT', '', smtp);
    expect((await config()).passwordReset).toBe(true);
    const id = (t.db.prepare("SELECT id FROM user WHERE email = 'ana@primer.si'").get() as { id: string }).id;
    const link = () => t.json(`/api/admin/users/${id}/reset-link`, {}, { cookie: admin });
    expect((await link()).status).toBe(204);
    expect(t.mails[0]).toMatchObject({ to: 'ana@primer.si', subject: 'Ponastavitev gesla' });
    await call('PUT', '/uses', { passwordReset: false, reminders: true, reminderHour: 8 });
    expect((await config()).passwordReset).toBe(false);
    expect((await link()).status).toBe(409);
    await t.json('/api/auth/request-password-reset', { email: 'ana@primer.si', redirectTo: '/novo-geslo' });
    expect(t.mails).toHaveLength(1);
  });
});

describe('potrditev naslova', () => {
  it('povezava potrdi naslov, brez nje opozoril ni', async () => {
    await call('PUT', '', smtp);
    await add(ana, { endDate: inDays(20) });
    expect(await t.reminders.run()).toEqual({ sent: 0, failed: 0 });
    expect((await t.json('/api/auth/send-verification-email', { email: 'ana@primer.si', callbackURL: '/racun?potrjeno=1' }, { cookie: ana })).status).toBe(200);
    const url = new URL(t.mails[0]!.text.match(/https?:\S+/)![0]);
    const r = await t.request(url.pathname + url.search, { cookie: ana });
    expect(r.headers.get('location')).toContain('/racun?potrjeno=1');
    expect(await (await t.request('/api/me', { cookie: ana })).json()).toMatchObject({ emailVerified: true, reminders: true });
    expect(await t.reminders.run()).toEqual({ sent: 1, failed: 0 });
  });
});

describe('opozorila', () => {
  beforeEach(async () => { await call('PUT', '', smtp); verify('ana@primer.si'); });

  it('pošlje en povzetek z vsemi novimi opozorili in jih ne ponavlja', async () => {
    await add(ana, { title: 'Ena', endDate: inDays(20) });
    await add(ana, { title: 'Dve', endDate: inDays(5) });
    await add(ana, { title: 'Daleč', endDate: inDays(200) });
    await add(ana, { title: 'Nedoločen', endDate: null });
    await add(admin, { title: 'Tuja', endDate: inDays(5) });
    expect(await t.reminders.run()).toEqual({ sent: 1, failed: 0 });
    const m = t.mails[0]!;
    expect(m).toMatchObject({ to: 'ana@primer.si', subject: '2 pogodbi zahtevata ukrepanje' });
    expect(m.text.indexOf('Dve')).toBeLessThan(m.text.indexOf('Ena'));
    expect(m.text).not.toMatch(/Daleč|Nedoločen|Tuja/);
    expect(await t.reminders.run()).toEqual({ sent: 0, failed: 0 });
  });

  it('znova opozori en teden prej in ob poteku, nikoli za nazaj', async () => {
    await add(ana, { endDate: inDays(20) });
    const on = (n: number) => t.reminders.run(inDays(n));
    expect((await on(0)).sent).toBe(1);
    expect((await on(12)).sent).toBe(0);
    expect((await on(13)).sent).toBe(1);
    expect((await on(20)).sent).toBe(0);
    expect((await on(21)).sent).toBe(1);
    expect(t.mails.at(-1)!.text).toContain('pogodba je potekla');
    expect((await on(0)).sent).toBe(0);
    expect((await on(40)).sent).toBe(0);
  });

  it('podaljšana pogodba začne nov krog, prekinjena in izbrisana utihneta', async () => {
    const id = await add(ana, { endDate: inDays(20) });
    const other = await add(ana, { endDate: inDays(25) });
    await t.reminders.run();
    await t.json(`/api/contracts/${id}/extend`, { endDate: inDays(400) }, { cookie: ana });
    await t.json(`/api/contracts/${other}/terminate`, {}, { cookie: ana });
    expect((await t.reminders.run(inDays(20))).sent).toBe(0);
    expect((await t.reminders.run(inDays(375))).sent).toBe(1);
    expect(t.mails.at(-1)!.subject).toBe('1 pogodba zahteva ukrepanje');
    expect((await t.request(`/api/contracts/${id}`, { method: 'DELETE', cookie: ana })).status).toBe(204);
    expect(t.db.prepare('SELECT COUNT(*) n FROM reminders WHERE contract_id = ?').get(id)).toEqual({ n: 0 });
  });

  it('že potekle pogodbe ob vnosu v arhiv ne sprožijo opozorila', async () => {
    await add(ana, { endDate: inDays(-100) });
    expect((await t.reminders.run()).sent).toBe(0);
  });

  it('upošteva izklop, blokiran račun in glavno stikalo', async () => {
    await add(ana, { endDate: inDays(5) });
    expect((await t.json('/api/me/reminders', { enabled: false }, { method: 'PUT', cookie: ana })).status).toBe(204);
    expect((await t.reminders.run()).sent).toBe(0);
    await t.json('/api/me/reminders', { enabled: true }, { method: 'PUT', cookie: ana });
    t.db.prepare('UPDATE user_access SET disabled = 1 WHERE user_id = (SELECT id FROM user WHERE email = ?)').run('ana@primer.si');
    expect((await t.reminders.run()).sent).toBe(0);
    await call('PUT', '/uses', { passwordReset: true, reminders: false, reminderHour: 8 });
    expect((await call('POST', '/reminders')).status).toBe(409);
  });

  it('urnik: po nastavljeni uri, enkrat na dan, ob napaki znova čez eno uro', async () => {
    await add(ana, { endDate: inDays(5) });
    const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return t.reminders.tick(d); };
    await at(7, 59);
    expect(t.mails).toHaveLength(0);
    t.control.fail = new Error('ni povezave');
    await at(8);
    expect((await view()).lastRun).toMatchObject({ sent: 0, failed: 1 });
    t.control.fail = null;
    await at(8, 30);
    expect(t.mails).toHaveLength(0);
    await at(9, 1);
    expect(t.mails).toHaveLength(1);
    await add(ana, { title: 'Nova', endDate: inDays(6) });
    await at(10);
    expect(t.mails).toHaveLength(1);
  });

  it('sočasna zagona ne pošljeta dvakrat', async () => {
    await add(ana, { endDate: inDays(5) });
    await Promise.all([t.reminders.run(), t.reminders.run()]);
    expect(t.mails).toHaveLength(1);
  });

  it('sklanja zadevo', () => {
    const c = { contract: { title: 'A', party: 'B', endDate: '2027-01-01', actionDate: '2027-01-01', daysLeft: 1, id: 'x' }, stage: 'teden' } as never;
    expect([1, 2, 3, 5].map((n) => composeReminder('X', Array(n).fill(c), '').subject)).toEqual(['1 pogodba zahteva ukrepanje', '2 pogodbi zahtevata ukrepanje', '3 pogodbe zahtevajo ukrepanje', '5 pogodb zahteva ukrepanje']);
  });
});
