import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { contractInput, fieldErrors, MAX_FILE_SIZE, toView } from '../shared/contracts.js';
import { isIsoDate, today } from '../shared/dates.js';
import { password, type Access, type Me, type Permission } from '../shared/users.js';
import { createAdminApi } from './admin.js';
import { CLIENT_IP_HEADER, type Auth } from './auth.js';
import type { Config } from './config.js';
import { ContractStore, type Upload } from './contracts.js';
import type { Db } from './db.js';
import { UserStore } from './users.js';

type Env = { Variables: { userId: string; access: Access } };

const TOO_LARGE = 'Datoteka je prevelika. Izberite datoteko PDF, manjšo od 10 MB.';
const NOT_PDF = 'Datoteka ni v obliki PDF. Izberite datoteko PDF.';
const NO_SPACE = 'V arhivu ni več prostora. Obrnite se na skrbnika.';
const NOT_FOUND = { error: 'Pogodba ne obstaja.' };

// Zadnji naslov v X-Forwarded-For je dodal naš posrednik, prejšnje lahko ponaredi odjemalec.
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).at(-1) ?? '').replace(/[\p{Cc}"]/gu, '').trim().slice(-150);
  return base || 'pogodba.pdf';
}

async function readForm(c: Context): Promise<{ data: unknown; upload: Upload | null; fileError: string | null }> {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw new HTTPException(400, { message: 'Neveljavna zahteva.' });
  let data: unknown = null;
  try { data = JSON.parse(String(form.get('data') ?? 'null')); } catch { /* preveri shema */ }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { data, upload: null, fileError: null };
  if (file.size > MAX_FILE_SIZE) return { data, upload: null, fileError: TOO_LARGE };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return { data, upload: null, fileError: NOT_PDF };
  return { data, upload: { name: cleanFileName(file.name), bytes }, fileError: null };
}

export function createApp(config: Config, db: Db, auth: Auth, webDir: string | null = null) {
  const store = new ContractStore(db, config.dataDir);
  const users = new UserStore(db);
  const app = new Hono<Env>();
  const https = config.baseUrl.startsWith('https://');

  app.use(async (c, next) => {
    if (/^\/api\/contracts\/[^/]+\/file$/.test(c.req.path)) return next();
    return secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
        frameSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      },
      xFrameOptions: 'DENY',
      strictTransportSecurity: https ? 'max-age=31536000' : false,
    })(c, next);
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message || 'Neveljavna zahteva.' }, error.status);
    console.error(error);
    return c.json({ error: 'Prišlo je do napake na strežniku. Poskusite znova.' }, 500);
  });

  app.get('/api/health', (c) => { db.prepare('SELECT 1').get(); return c.json({ ok: true }); });

  app.get('/api/config', (c) => c.json({
    localLogin: config.localLogin,
    registration: { local: config.localLogin && config.registration, oidc: config.oidc?.registration ?? false },
    passwordReset: config.localLogin && config.smtp !== null,
    oidc: config.oidc ? { name: config.oidc.name } : null,
  }));

  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, clientIp(c, config.trustProxy));
    return auth.handler(new Request(c.req.raw, { headers }));
  });

  // Zaščita pred zahtevami z drugih strani (CSRF), prijava in stanje računa.
  const guard = createMiddleware<Env>(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.header('origin') !== config.baseUrl) {
      throw new HTTPException(403, { message: 'Zahteva ni dovoljena.' });
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const access = session && users.access(session.user.id);
    if (!session || !access || access.disabled) throw new HTTPException(401, { message: 'Seja je potekla. Prijavite se znova.' });
    c.set('userId', session.user.id);
    c.set('access', access);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  const passwordChanged = createMiddleware<Env>(async (c, next) => {
    if (c.get('access').mustChangePassword) throw new HTTPException(403, { message: 'Najprej spremenite geslo.' });
    await next();
  });
  const allow = (permission: Permission) => createMiddleware<Env>(async (c, next) => {
    if (!c.get('access').permissions[permission]) throw new HTTPException(403, { message: 'Za to dejanje nimate dovoljenja. Obrnite se na skrbnika.' });
    await next();
  });

  app.get('/api/me', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const user = session && users.get(session.user.id);
    c.header('Cache-Control', 'no-store');
    if (!user || user.disabled) return c.json(null);
    const { id, name, email, hasPassword, role, disabled, mustChangePassword, permissions } = user;
    return c.json({ id, name, email, hasPassword, role, disabled, mustChangePassword, permissions } satisfies Me);
  });

  app.post('/api/password', guard, async (c) => {
    const parsed = z.object({ currentPassword: z.string().min(1, { error: 'Vnesite sedanje geslo.' }), newPassword: password }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: fieldErrors(parsed.error) }, 400);
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return c.json({ error: 'Preverite označena polja.', fields: { newPassword: 'Novo geslo mora biti drugačno od sedanjega.' } }, 400);
    }
    // Skozi običajno pot knjižnice, da velja tudi njena omejitev poskusov.
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, clientIp(c, config.trustProxy));
    headers.delete('content-length');
    const response = await auth.handler(new Request(`${config.baseUrl}/api/auth/change-password`, {
      method: 'POST', headers, body: JSON.stringify({ ...parsed.data, revokeOtherSessions: true }),
    }));
    if (response.ok) {
      users.setMustChangePassword(c.get('userId'), false);
      return response;
    }
    if (response.status === 429) return response;
    return c.json({ error: 'Preverite označena polja.', fields: { currentPassword: 'Sedanje geslo ni pravilno.' } }, 400);
  });

  const api = new Hono<Env>();
  api.use(guard, passwordChanged);
  const limit = bodyLimit({ maxSize: MAX_FILE_SIZE + 256 * 1024, onError: (c) => c.json({ error: TOO_LARGE, fields: { file: TOO_LARGE } }, 413) });

  const isFull = (upload: Upload) => config.storageLimit !== null && store.usedSpace() + upload.bytes.length > config.storageLimit;

  api.get('/', (c) => c.json(store.list(c.get('userId')).map((x) => toView(x, today()))));

  api.post('/', allow('create'), limit, async (c) => {
    const { data, upload, fileError } = await readForm(c);
    const parsed = contractInput.safeParse(data);
    const file = fileError ?? (upload ? null : 'Izberite datoteko PDF.');
    if (!parsed.success || !upload) {
      return c.json({ error: 'Preverite označena polja.', fields: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(file ? { file } : {}) } }, 400);
    }
    if (isFull(upload)) return c.json({ error: NO_SPACE, fields: { file: NO_SPACE } }, 507);
    return c.json(toView(await store.create(c.get('userId'), parsed.data, upload), today()), 201);
  });

  api.get('/:id', (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    return found ? c.json(toView(found, today())) : c.json(NOT_FOUND, 404);
  });

  api.put('/:id', allow('edit'), limit, async (c) => {
    const { data, upload, fileError } = await readForm(c);
    const parsed = contractInput.safeParse(data);
    if (!parsed.success || fileError) {
      return c.json({ error: 'Preverite označena polja.', fields: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(fileError ? { file: fileError } : {}) } }, 400);
    }
    if (upload && isFull(upload)) return c.json({ error: NO_SPACE, fields: { file: NO_SPACE } }, 507);
    const updated = await store.update(c.get('userId'), c.req.param('id'), parsed.data, upload);
    return updated ? c.json(toView(updated, today())) : c.json(NOT_FOUND, 404);
  });

  api.delete('/:id', allow('remove'), async (c) =>
    (await store.remove(c.get('userId'), c.req.param('id'))) ? c.body(null, 204) : c.json(NOT_FOUND, 404));

  api.post('/:id/extend', allow('edit'), async (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    if (!found) return c.json(NOT_FOUND, 404);
    if (found.terminatedAt || found.endDate === null) return c.json({ error: 'Te pogodbe ni mogoče podaljšati.' }, 409);
    const parsed = z.object({ endDate: z.string().refine(isIsoDate) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: { endDate: 'Vnesite nov datum poteka.' } }, 400);
    if (parsed.data.endDate <= found.endDate) return c.json({ error: 'Preverite označena polja.', fields: { endDate: 'Nov datum mora biti po sedanjem datumu poteka.' } }, 400);
    return c.json(toView(store.extend(c.get('userId'), found.id, parsed.data.endDate)!, today()));
  });

  api.post('/:id/terminate', allow('edit'), (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    if (!found) return c.json(NOT_FOUND, 404);
    if (found.terminatedAt) return c.json({ error: 'Pogodba je že prekinjena.' }, 409);
    return c.json(toView(store.terminate(c.get('userId'), found.id)!, today()));
  });

  api.get('/:id/file', (c) => {
    const file = store.file(c.get('userId'), c.req.param('id'));
    if (!file) return c.json(NOT_FOUND, 404);
    const kind = c.req.query('prenos') === undefined ? 'inline' : 'attachment';
    return c.body(file.stream, 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.size),
      'Content-Disposition': `${kind}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'Cache-Control': 'private, no-store',
    });
  });

  app.route('/api/contracts', api);

  const admin = new Hono<Env>();
  admin.use(guard, passwordChanged, async (c, next) => {
    if (c.get('access').role !== 'admin') throw new HTTPException(403, { message: 'Ta del je namenjen skrbnikom.' });
    await next();
  });
  admin.route('/users', createAdminApi(config, auth, users, store));
  app.route('/api/admin', admin);
  app.all('/api/*', (c) => c.json({ error: 'Naslov ne obstaja.' }, 404));

  if (webDir) {
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('*', serveStatic({ root: webDir }));
    app.get('*', serveStatic({ root: webDir, path: 'index.html' }));
  }
  return app;
}
