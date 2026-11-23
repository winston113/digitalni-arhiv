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
    expect(await (await t.request('/api/config')).json()).toMatchObject({ oidc: { name: 'Zitadel' }, localLogin: true });
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

  it('nove uporabnike je mogoče zavrniti', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', OIDC_REGISTRATION: 'false' });
    expect((await signIn(t)).location).toContain('error=');
  });

  it('lokalno prijavo je mogoče izklopiti', async () => {
    const t = await setup({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'arhiv', LOCAL_LOGIN: 'false' });
    expect((await t.json('/api/auth/sign-in/email', { email: 'a@b.si', password: 'dolgo-geslo' })).status).toBe(400);
    expect((await signIn(t)).location).toBe('/');
  });
});
