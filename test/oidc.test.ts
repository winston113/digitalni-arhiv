import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookies, setup } from './helpers.js';

// Nadomestni ponudnik, ki se vede kot Zitadel: PKCE, podpisan id_token, podatki na userinfo.
let server: Server;
let issuer: string;
let person: Record<string, unknown>;
let challenge = '';
let nonce: string | null = null;
let secretSeen = '';

beforeEach(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  person = { sub: 'zitadel-1', email: 'maja@primer.si', email_verified: true, name: 'Maja Kranjc' };
  server = createServer(async (req, res) => {
    const send = (body: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/.well-known/openid-configuration') {
      return send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'] });
    }
    if (req.url === '/jwks') return send({ keys: [jwk] });
    if (req.url === '/userinfo') return send(person);
    if (req.url === '/token') {
      let body = ''; for await (const chunk of req) body += chunk;
      const p = new URLSearchParams(body);
      secretSeen = p.get('client_secret') ?? req.headers.authorization ?? '';
      if (createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') !== challenge) return send({ error: 'invalid_grant' }, 400);
      const idToken = await new SignJWT({ ...(nonce && { nonce }) }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer).setAudience('arhiv').setSubject(String(person.sub)).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return send({ access_token: 'a', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    send({}, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

async function signIn(t: Awaited<ReturnType<typeof setup>>, requestSignUp = true) {
  const start = await t.json('/api/auth/sign-in/social', { provider: 'oidc', callbackURL: '/', errorCallbackURL: '/prijava', requestSignUp });
  expect(start.status).toBe(200);
  const url = new URL(((await start.json()) as { url: string }).url);
  challenge = url.searchParams.get('code_challenge') ?? '';
  nonce = url.searchParams.get('nonce');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe('http://arhiv.test/api/auth/callback/oidc');
  const back = await t.request(`/api/auth/callback/oidc?code=c&state=${encodeURIComponent(url.searchParams.get('state')!)}`, { cookie: cookies(start) });
  return { location: back.headers.get('location'), cookie: cookies(back) };
}

describe('OpenID Connect', () => {
  it('prijavi uporabnika brez skrivnosti (PKCE) in ga ob naslednji prijavi prepozna', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', OIDC_NAME: 'Zitadel' });
    const first = await signIn(t);
    expect(first.location).toBe('/');
    expect((await t.request('/api/contracts', { cookie: first.cookie })).status).toBe(200);
    expect((await signIn(t, false)).location).toBe('/');
    expect(t.db.prepare('SELECT COUNT(*) n FROM user').get()).toEqual({ n: 1 });
    expect(await (await t.request('/api/config')).json()).toMatchObject({ oidc: { name: 'Zitadel' } });
  });

  it('sama prijava ne ustvari računa, registracija ga', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', REGISTRATION: 'false' });
    expect((await signIn(t, false)).location).toContain('error=signup_disabled');
    expect(t.db.prepare('SELECT COUNT(*) n FROM user').get()).toEqual({ n: 0 });
    expect(await (await t.request('/api/config')).json()).toMatchObject({ registration: { local: false, oidc: true } });
    const first = await signIn(t);
    expect(await (await t.request('/api/me', { cookie: first.cookie })).json()).toMatchObject({ role: 'admin', hasPassword: false });
  });

  it('blokiran uporabnik se ne more prijaviti prek ponudnika', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    const { cookie } = await signIn(t);
    t.db.prepare('UPDATE user_access SET disabled = 1').run();
    expect((await t.request('/api/contracts', { cookie })).status).toBe(401);
    expect((await signIn(t, false)).location).toContain('error=ACCOUNT_DISABLED');
  });

  it('deluje tudi s skrivnostjo', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', OIDC_CLIENT_SECRET: 'skrivnost' });
    expect((await signIn(t)).location).toBe('/');
    expect(secretSeen).not.toBe('');
  });

  it('ne prevzame obstoječega lokalnega računa z istim naslovom', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    await t.register('maja@primer.si');
    const r = await signIn(t);
    expect(r.location).toContain('/prijava?error=');
    expect((await t.request('/api/contracts', { cookie: r.cookie })).status).toBe(401);
  });

  it('tudi potrjen lokalni naslov se ne poveže samodejno', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    await t.register('maja@primer.si');
    t.db.prepare('UPDATE user SET emailVerified = 1').run();
    expect((await signIn(t)).location).toContain('/prijava?error=');
  });

  it('nove uporabnike je mogoče zavrniti', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', OIDC_REGISTRATION: 'false' });
    expect((await signIn(t)).location).toContain('error=');
  });

  it('geslo je vedno rezerva, tudi z LOCAL_LOGIN=false', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', LOCAL_LOGIN: 'false' });
    await t.register('geslo@primer.si');
    expect((await t.json('/api/auth/sign-in/email', { email: 'geslo@primer.si', password: 'dolgo-geslo' })).status).toBe(200);
  });

  it('uporabnik ponudnika si nastavi rezervno geslo in se prijavi brez ponudnika', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    const { cookie } = await signIn(t);
    const first = (newPassword: string) => t.json('/api/password/first', { newPassword }, { cookie });
    expect((await first('kratko')).status).toBe(400);
    expect((await first('rezervno-geslo')).status).toBe(204);
    expect((await first('drugo-geslo-1')).status).toBe(409);
    expect((await t.json('/api/password/first', { newPassword: 'x-brez-prijave' })).status).toBe(401);
    expect((await t.json('/api/auth/sign-in/email', { email: 'maja@primer.si', password: 'rezervno-geslo' })).status).toBe(200);
    expect((await signIn(t, false)).location).toBe('/');
  });

  it('skrbnik lahko nastavi geslo uporabniku ponudnika, ne da bi ga zaklenil', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    const admin = await t.register('skrbnik@primer.si');
    await signIn(t);
    const id = (t.db.prepare("SELECT id FROM user WHERE email = 'maja@primer.si'").get() as { id: string }).id;
    const r = await t.json(`/api/admin/users/${id}/password`, { password: 'nastavljeno-1', mustChangePassword: true }, { cookie: admin });
    expect(await r.json()).toMatchObject({ hasPassword: true, hasOidc: true, mustChangePassword: false });
    expect((await t.json('/api/auth/sign-in/email', { email: 'maja@primer.si', password: 'nastavljeno-1' })).status).toBe(200);
  });
});

describe('nastavitve ponudnika v skrbniškem delu', () => {
  const body = (over: object = {}) => ({ name: 'Moj ponudnik', issuer: `${issuer}/.well-known/openid-configuration`, clientId: 'arhiv', method: 'none', clientSecret: null, scopes: 'profile email', registration: true, ...over });
  const call = (t: Awaited<ReturnType<typeof setup>>, cookie: string, method: string, path = '', data: unknown = body()) => t.json(`/api/admin/oidc${path}`, data, { method, cookie });
  const config = async (t: Awaited<ReturnType<typeof setup>>) => (await (await t.request('/api/config')).json()) as { oidc: { name: string } | null; registration: { oidc: boolean } };

  it('začnejo veljati brez ponovnega zagona in jih je mogoče odstraniti', async () => {
    const t = await setup();
    const admin = await t.register('skrbnik@primer.si');
    expect((await config(t)).oidc).toBeNull();
    const saved = await call(t, admin, 'PUT');
    expect(await saved.json()).toMatchObject({ source: 'panel', settings: { issuer, scopes: 'openid profile email', hasSecret: false } });
    expect((await config(t)).oidc).toEqual({ name: 'Moj ponudnik' });
    expect((await signIn(t)).location).toBe('/');
    expect((await t.request('/api/contracts', { cookie: admin })).status).toBe(200);
    await call(t, admin, 'PUT', '', body({ registration: false }));
    person.sub = 'nekdo-drug'; person.email = 'drug@primer.si';
    expect((await signIn(t)).location).toContain('error=');
    expect((await call(t, admin, 'DELETE')).status).toBe(200);
    expect((await config(t)).oidc).toBeNull();
  });

  it('skrivnost je šifrirana, se ne vrne in se ne pošlje drugemu ponudniku', async () => {
    const t = await setup();
    const admin = await t.register('skrbnik@primer.si');
    expect((await call(t, admin, 'PUT', '', body({ method: 'client_secret_basic' }))).status).toBe(400);
    const saved = await call(t, admin, 'PUT', '', body({ method: 'client_secret_basic', clientSecret: 'zelo-skrivno' }));
    expect(await saved.text()).not.toContain('zelo-skrivno');
    expect(JSON.stringify(t.db.prepare('SELECT * FROM settings').all())).not.toContain('zelo-skrivno');
    expect((await signIn(t)).location).toBe('/');
    expect(Buffer.from(secretSeen.replace('Basic ', ''), 'base64').toString()).toBe('arhiv:zelo-skrivno');
    expect((await call(t, admin, 'PUT', '', body({ method: 'client_secret_post' }))).status).toBe(200);
    await signIn(t);
    expect(secretSeen).toBe('zelo-skrivno');
    expect((await call(t, admin, 'PUT', '', body({ method: 'client_secret_post', clientId: 'drug' }))).status).toBe(400);
  });

  it('preveri naslov, preden ga shrani', async () => {
    const t = await setup();
    const admin = await t.register('skrbnik@primer.si');
    const error = async (value: string, path = '', method = 'PUT') => ((await (await call(t, admin, method, path, body({ issuer: value }))).json()) as { fields: { issuer: string } }).fields.issuer;
    expect(await error('ftp://x')).toMatch(/https/);
    expect(await error('http://primer.si')).toMatch(/https/);
    expect(await error(`${issuer}/ni`)).toMatch(/ni konfiguracije/);
    expect(await error('http://127.0.0.1:9', '/check', 'POST')).toMatch(/ni uspela/);
    expect(await (await call(t, admin, 'POST', '/check')).json()).toMatchObject({ issuer });
    expect((await config(t)).oidc).toBeNull();
  });

  it('samo za skrbnike; okolje ima prednost', async () => {
    let t = await setup();
    await t.register('skrbnik@primer.si');
    const ana = await t.register('ana@primer.si');
    for (const [m, p] of [['PUT', ''], ['DELETE', ''], ['POST', '/check']] as const) expect((await call(t, ana, m, p)).status).toBe(403);
    expect((await t.request('/api/admin/oidc', { cookie: ana })).status).toBe(403);
    t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv' });
    const admin = await t.register('skrbnik@primer.si');
    expect((await call(t, admin, 'PUT')).status).toBe(409);
    expect((await call(t, admin, 'DELETE')).status).toBe(409);
  });
});
