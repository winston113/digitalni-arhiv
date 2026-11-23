import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { contractInput, fieldErrors, MAX_FILE_SIZE, toView } from '../shared/contracts.js';
import { isIsoDate, today } from '../shared/dates.js';
import { CLIENT_IP_HEADER, type Auth } from './auth.js';
import type { Config } from './config.js';
import { ContractStore, type Upload } from './contracts.js';
import type { Db } from './db.js';

type Env = { Variables: { userId: string } };

const TOO_LARGE = 'Datoteka je prevelika. Izberite datoteko PDF, manjšo od 10 MB.';
const NOT_PDF = 'Datoteka ni v obliki PDF. Izberite datoteko PDF.';
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
    registration: config.localLogin && config.registration,
    passwordReset: config.localLogin && config.smtp !== null,
    oidc: config.oidc ? { name: config.oidc.name } : null,
  }));

  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, clientIp(c, config.trustProxy));
    return auth.handler(new Request(c.req.raw, { headers }));
  });

  const api = new Hono<Env>();
  api.use(async (c, next) => {
    // Zaščita pred zahtevami z drugih strani (CSRF).
    if (c.req.method !== 'GET' && c.req.header('origin') !== config.baseUrl) {
      throw new HTTPException(403, { message: 'Zahteva ni dovoljena.' });
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HTTPException(401, { message: 'Seja je potekla. Prijavite se znova.' });
    c.set('userId', session.user.id);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  const limit = bodyLimit({ maxSize: MAX_FILE_SIZE + 256 * 1024, onError: (c) => c.json({ error: TOO_LARGE, fields: { file: TOO_LARGE } }, 413) });

  api.get('/', (c) => c.json(store.list(c.get('userId')).map((x) => toView(x, today()))));

  api.post('/', limit, async (c) => {
    const { data, upload, fileError } = await readForm(c);
    const parsed = contractInput.safeParse(data);
    const file = fileError ?? (upload ? null : 'Izberite datoteko PDF.');
    if (!parsed.success || !upload) {
      return c.json({ error: 'Preverite označena polja.', fields: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(file ? { file } : {}) } }, 400);
    }
    return c.json(toView(await store.create(c.get('userId'), parsed.data, upload), today()), 201);
  });

  api.get('/:id', (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    return found ? c.json(toView(found, today())) : c.json(NOT_FOUND, 404);
  });

  api.put('/:id', limit, async (c) => {
    const { data, upload, fileError } = await readForm(c);
    const parsed = contractInput.safeParse(data);
    if (!parsed.success || fileError) {
      return c.json({ error: 'Preverite označena polja.', fields: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(fileError ? { file: fileError } : {}) } }, 400);
    }
    const updated = await store.update(c.get('userId'), c.req.param('id'), parsed.data, upload);
    return updated ? c.json(toView(updated, today())) : c.json(NOT_FOUND, 404);
  });

  api.delete('/:id', async (c) =>
    (await store.remove(c.get('userId'), c.req.param('id'))) ? c.body(null, 204) : c.json(NOT_FOUND, 404));

  api.post('/:id/extend', async (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    if (!found) return c.json(NOT_FOUND, 404);
    if (found.terminatedAt || found.endDate === null) return c.json({ error: 'Te pogodbe ni mogoče podaljšati.' }, 409);
    const parsed = z.object({ endDate: z.string().refine(isIsoDate) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: { endDate: 'Vnesite nov datum poteka.' } }, 400);
    if (parsed.data.endDate <= found.endDate) return c.json({ error: 'Preverite označena polja.', fields: { endDate: 'Nov datum mora biti po sedanjem datumu poteka.' } }, 400);
    return c.json(toView(store.extend(c.get('userId'), found.id, parsed.data.endDate)!, today()));
  });

  api.post('/:id/terminate', (c) => {
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
  app.all('/api/*', (c) => c.json({ error: 'Naslov ne obstaja.' }, 404));

  if (webDir) {
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('*', serveStatic({ root: webDir }));
    app.get('*', serveStatic({ root: webDir, path: 'index.html' }));
  }
  return app;
}
