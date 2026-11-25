import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { contractInput, fieldErrors, MAX_ATTACHMENTS, toView, type Contract, type ContractDetails } from '../shared/contracts.js';
import { isIsoDate, today } from '../shared/dates.js';
import { fileKind, MIME } from '../shared/files.js';
import { password, type Access, type CurrentUser, type Permission } from '../shared/users.js';
import { createAdminApi, createAiApi, createMailApi, createOidcApi } from './admin.js';
import { CLIENT_IP_HEADER, type AuthHolder } from './auth.js';
import type { Config } from './config.js';
import { ContractStore, UploadGone, type StoredFile } from './contracts.js';
import type { Db } from './db.js';
import { exportStream, MAX_EXPORT, planExport } from './export.js';
import { LANGS, translate } from '../shared/i18n.js';
import type { Mail } from './mail.js';
import type { Oidc } from './oidc.js';
import type { Indexer } from './indexer.js';
import type { Reminders } from './reminders.js';
import { searchInput } from '../shared/search.js';
import { splitInput } from '../shared/uploads.js';
import { GONE, UploadError, UploadStore } from './uploads.js';
import { Search, SearchError } from './search.js';
import { AiError, type Ai } from './ai.js';
import type { PdfTools } from './extract.js';
import { Suggester } from './suggest.js';
import { UserStore } from './users.js';

type Env = { Variables: { userId: string; access: Access } };

const NO_ATTACHMENT = { error: 'Priloga ne obstaja.' };
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

// DOCX se vedno prenese: brskalnik ga sam ne prikaže.
function sendFile(c: Context, file: StoredFile) {
  const type = fileKind(file.name);
  const kind = type === 'pdf' && c.req.query('prenos') === undefined ? 'inline' : 'attachment';
  return c.body(file.stream(), 200, {
    'Content-Type': MIME[type],
    'Content-Length': String(file.size),
    'Content-Disposition': `${kind}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
    'Cache-Control': 'private, no-store',
  });
}

const uploadId = z.uuid();
const contractBody = z.object({ data: z.unknown().optional(), upload: uploadId.nullish(), attachments: z.array(uploadId).max(MAX_ATTACHMENTS).default([]) });

export function createApp(config: Config, db: Db, auth: AuthHolder, mail: Mail, oidc: Oidc, reminders: Reminders, indexer: Indexer, ai: Ai, tools: PdfTools, webDir: string | null = null) {
  const store = new ContractStore(db, config.dataDir);
  const search = new Search(db, config.dataDir, store);
  const users = new UserStore(db);
  const suggester = new Suggester(ai, tools);
  const uploads = new UploadStore(db, config.dataDir, tools, config.maxFileMb * 1024 * 1024, config.storageLimit);
  uploads.start();
  const app = new Hono<Env>();
  const https = config.baseUrl.startsWith('https://');

  app.use(async (c, next) => {
    if (/^\/api\/contracts\/[^/]+\/(attachments\/[^/]+\/)?file$/.test(c.req.path)) return next();
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
    if (error instanceof UploadError || error instanceof AiError) return c.json({ error: error.message }, error.status);
    if (error instanceof UploadGone) return c.json({ error: GONE, fields: { file: GONE } }, 409);
    if (error instanceof HTTPException) return c.json({ error: error.message || 'Neveljavna zahteva.' }, error.status);
    console.error(error);
    return c.json({ error: 'Prišlo je do napake na strežniku. Poskusite znova.' }, 500);
  });

  app.get('/api/health', (c) => { db.prepare('SELECT 1').get(); return c.json({ ok: true }); });

  app.get('/api/config', (c) => c.json({
    registration: { local: config.registration, oidc: oidc.current?.registration ?? false },
    passwordReset: mail.canReset,
    reminders: mail.canRemind,
    maxFileMb: config.maxFileMb,
    oidc: oidc.current ? { name: oidc.current.name } : null,
  }));

  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, clientIp(c, config.trustProxy));
    return auth.current.handler(new Request(c.req.raw, { headers }));
  });

  // Zaščita pred zahtevami z drugih strani (CSRF), prijava in stanje računa.
  const guard = createMiddleware<Env>(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.header('origin') !== config.baseUrl) {
      throw new HTTPException(403, { message: 'Zahteva ni dovoljena.' });
    }
    const session = await auth.current.api.getSession({ headers: c.req.raw.headers });
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
    const session = await auth.current.api.getSession({ headers: c.req.raw.headers });
    const user = session && users.get(session.user.id);
    c.header('Cache-Control', 'no-store');
    if (!user || user.disabled) return c.json(null);
    const { id, name, email, hasPassword, emailVerified, reminders: wants, language, role, disabled, mustChangePassword, permissions } = user;
    return c.json({ id, name, email, hasPassword, emailVerified, reminders: wants, language, role, disabled, mustChangePassword, permissions, ai: permissions.ai ? ai.info : null } satisfies CurrentUser);
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
    const response = await auth.current.handler(new Request(`${config.baseUrl}/api/auth/change-password`, {
      method: 'POST', headers, body: JSON.stringify({ ...parsed.data, revokeOtherSessions: true }),
    }));
    if (response.ok) {
      users.setMustChangePassword(c.get('userId'), false);
      return response;
    }
    if (response.status === 429) return response;
    return c.json({ error: 'Preverite označena polja.', fields: { currentPassword: 'Sedanje geslo ni pravilno.' } }, 400);
  });

  app.put('/api/me/reminders', guard, async (c) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Neveljavna zahteva.' }, 400);
    users.setReminders(c.get('userId'), parsed.data.enabled);
    return c.body(null, 204);
  });

  app.put('/api/me/language', guard, async (c) => {
    const parsed = z.object({ language: z.enum(LANGS) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Neveljavna zahteva.' }, 400);
    users.setLanguage(c.get('userId'), parsed.data.language);
    return c.body(null, 204);
  });

  // Prvo geslo za uporabnika, ki se prijavlja prek ponudnika, da ima rezervno prijavo.
  app.post('/api/password/first', guard, async (c) => {
    const parsed = z.object({ newPassword: password }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: fieldErrors(parsed.error) }, 400);
    if (users.get(c.get('userId'))!.hasPassword) return c.json({ error: 'Geslo je že nastavljeno.' }, 409);
    await auth.current.api.setPassword({ body: parsed.data, headers: c.req.raw.headers });
    return c.body(null, 204);
  });

  const api = new Hono<Env>();
  api.use(guard, passwordChanged);
  const limit = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'Neveljavna zahteva.' }, 413) });
  const readBody = async (c: Context) => {
    const parsed = contractBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: 'Neveljavna zahteva.' });
    return parsed.data;
  };
  // Nalaganje in razdelitev sta del dodajanja ali urejanja pogodb.
  const mayUpload = createMiddleware<Env>(async (c, next) => {
    const { create, edit } = c.get('access').permissions;
    if (!create && !edit) throw new HTTPException(403, { message: 'Za to dejanje nimate dovoljenja. Obrnite se na skrbnika.' });
    await next();
  });

  const details = (userId: string, contract: Contract): ContractDetails => ({ ...toView(contract, today()), attachments: store.attachments(userId, contract.id), textState: store.textState(userId, contract.id) });

  api.get('/', (c) => c.json(store.list(c.get('userId')).map((x) => toView(x, today()))));

  api.post('/', allow('create'), limit, async (c) => {
    const { data, upload, attachments } = await readBody(c);
    const parsed = contractInput.safeParse(data);
    if (!parsed.success || !upload) {
      return c.json({ error: 'Preverite označena polja.', fields: { ...(parsed.success ? {} : fieldErrors(parsed.error)), ...(upload ? {} : { file: 'Izberite datoteko PDF ali DOCX.' }) } }, 400);
    }
    const created = store.create(c.get('userId'), parsed.data, upload, attachments);
    indexer.kick();
    return c.json(details(c.get('userId'), created), 201);
  });

  api.get('/:id', (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    return found ? c.json(details(c.get('userId'), found)) : c.json(NOT_FOUND, 404);
  });

  api.put('/:id', allow('edit'), limit, async (c) => {
    const { data, upload } = await readBody(c);
    const parsed = contractInput.safeParse(data);
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: fieldErrors(parsed.error) }, 400);
    const updated = await store.update(c.get('userId'), c.req.param('id'), parsed.data, upload ?? null);
    indexer.kick();
    return updated ? c.json(details(c.get('userId'), updated)) : c.json(NOT_FOUND, 404);
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
    return c.json(details(c.get('userId'), store.extend(c.get('userId'), found.id, parsed.data.endDate)!));
  });

  api.post('/:id/terminate', allow('edit'), (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    if (!found) return c.json(NOT_FOUND, 404);
    if (found.terminatedAt) return c.json({ error: 'Pogodba je že prekinjena.' }, 409);
    return c.json(details(c.get('userId'), store.terminate(c.get('userId'), found.id)!));
  });

  api.get('/:id/file', (c) => {
    const file = store.file(c.get('userId'), c.req.param('id'));
    return file ? sendFile(c, file) : c.json(NOT_FOUND, 404);
  });

  api.post('/:id/attachments', allow('edit'), limit, async (c) => {
    const id = c.req.param('id');
    if (!store.get(c.get('userId'), id)) return c.json(NOT_FOUND, 404);
    const { upload } = await readBody(c);
    if (!upload) return c.json({ error: 'Izberite datoteko PDF ali DOCX.' }, 400);
    if (!store.addAttachment(c.get('userId'), id, upload)) {
      await uploads.remove(c.get('userId'), upload);
      return c.json({ error: 'Pogodba ima lahko največ 30 prilog.' }, 409);
    }
    indexer.kick();
    return c.json(store.attachments(c.get('userId'), id), 201);
  });

  api.get('/:id/attachments/:attachment/file', (c) => {
    const file = store.attachmentFile(c.get('userId'), c.req.param('id'), c.req.param('attachment'));
    return file ? sendFile(c, file) : c.json(NO_ATTACHMENT, 404);
  });

  api.delete('/:id/attachments/:attachment', allow('edit'), async (c) => {
    const id = c.req.param('id');
    return (await store.removeAttachment(c.get('userId'), id, c.req.param('attachment'))) ? c.json(store.attachments(c.get('userId'), id)) : c.json(NO_ATTACHMENT, 404);
  });

  api.post('/:id/reindex', allow('edit'), (c) => {
    const found = store.get(c.get('userId'), c.req.param('id'));
    if (!found) return c.json(NOT_FOUND, 404);
    indexer.retry(found.id);
    return c.json(details(c.get('userId'), found));
  });

  api.post('/:id/suggest', allow('ai'), allow('edit'), async (c) => {
    const path = store.mainPath(c.get('userId'), c.req.param('id'));
    return path ? c.json(await suggester.suggest(c.get('userId'), path, today(), c.req.raw.signal)) : c.json(NOT_FOUND, 404);
  });

  app.route('/api/contracts', api);

  const files = new Hono<Env>();
  files.use(guard, passwordChanged, mayUpload);
  const own = (c: Context<Env>): string => {
    const id = c.req.param('id')!;
    if (!uploads.get(c.get('userId'), id)) throw new UploadError(GONE, 404);
    return id;
  };

  // Ime je v glavi, da ne pride v dnevnike posrednikov.
  files.post('/', async (c) => {
    let name = '';
    try { name = decodeURIComponent(c.req.header('x-file-name') ?? ''); } catch { /* ime ni obvezno */ }
    return c.json(await uploads.receive(c.get('userId'), name, c.req.raw.body, Number(c.req.header('content-length') ?? 0)), 201);
  });

  files.get('/:id/file', (c) => {
    const { name, size } = uploads.get(c.get('userId'), own(c))!;
    return sendFile(c, { name, size, stream: () => uploads.stream(c.req.param('id')) });
  });

  files.delete('/:id', async (c) => ((await uploads.remove(c.get('userId'), c.req.param('id'))) ? c.body(null, 204) : c.json({ error: GONE }, 404)));

  // Predlogi za obrazec.
  files.post('/:id/suggest', allow('ai'), async (c) => c.json(await suggester.suggest(c.get('userId'), uploads.path(own(c)), today(), c.req.raw.signal)));

  // Predlog, kje se v združeni datoteki začnejo posamezni dokumenti.
  files.post('/:id/outline', allow('ai'), async (c) => c.json(await suggester.outline(c.get('userId'), uploads.path(own(c)), today(), c.req.raw.signal)));

  files.post('/:id/split', allow('create'), limit, async (c) => {
    const parsed = splitInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Neveljavna zahteva.' }, 400);
    return c.json(await uploads.split(c.get('userId'), own(c), parsed.data.parts), 201);
  });

  app.route('/api/uploads', files);

  // POST, da iskani izrazi ne pridejo v dnevnike posrednikov.
  app.post('/api/search', guard, passwordChanged, async (c) => {
    const parsed = searchInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Preverite označena polja.', fields: fieldErrors(parsed.error) }, 400);
    try {
      return c.json(await search.run(c.get('userId'), parsed.data));
    } catch (error) {
      if (error instanceof SearchError) return c.json({ error: error.message, fields: error.status === 409 ? {} : { query: error.message } }, error.status);
      throw error;
    }
  });

  // Hkrati teče največ en izvoz na uporabnika.
  const exporting = new Set<string>();
  app.get('/api/export', guard, passwordChanged, (c) => {
    const userId = c.get('userId');
    if (exporting.has(userId)) return c.json({ error: 'Izvoz že poteka. Počakajte, da se konča.' }, 409);
    const lang = users.language(userId);
    const { sheet, entries, size } = planExport(store, userId, lang);
    if (size > MAX_EXPORT) return c.json({ error: 'Arhiv je prevelik za izvoz v eni datoteki. Obrnite se na skrbnika.' }, 413);
    exporting.add(userId);
    const name = `${translate(lang, 'pogodbe')}-${today()}`;
    return c.body(exportStream(`${name}.xlsx`, sheet, entries, () => exporting.delete(userId)), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}.zip"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
  });

  const admin = new Hono<Env>();
  admin.use(guard, passwordChanged, async (c, next) => {
    if (c.get('access').role !== 'admin') throw new HTTPException(403, { message: 'Ta del je namenjen skrbnikom.' });
    await next();
  });
  admin.route('/users', createAdminApi(auth, mail, users, store, uploads));
  admin.route('/mail', createMailApi(config, mail, reminders, users));
  admin.route('/oidc', createOidcApi(config, auth, oidc));
  admin.route('/ai', createAiApi(ai));
  app.route('/api/admin', admin);
  app.all('/api/*', (c) => c.json({ error: 'Naslov ne obstaja.' }, 404));

  if (webDir) {
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('*', serveStatic({ root: webDir }));
    app.get('*', serveStatic({ root: webDir, path: 'index.html' }));
  }
  return app;
}
