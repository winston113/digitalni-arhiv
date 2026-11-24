import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { fieldErrors } from '../shared/contracts.js';
import { passwordReset, userCreate, userUpdate, type Access } from '../shared/users.js';
import type { AuthHolder } from './auth.js';
import type { Config } from './config.js';
import { translate } from '../shared/i18n.js';
import { aiConnection, aiInput } from '../shared/ai.js';
import { issuer, oidcInput } from '../shared/oidc.js';
import { mailInput, mailUses } from '../shared/mail.js';
import type { ContractStore } from './contracts.js';
import { AiError, type Ai } from './ai.js';
import { mailError, type Mail } from './mail.js';
import { checkIssuer, type Oidc } from './oidc.js';
import type { Reminders } from './reminders.js';
import type { UserStore } from './users.js';

type Env = { Variables: { userId: string; access: Access } };

const NOT_FOUND = { error: 'Uporabnik ne obstaja.' };
const LAST_ADMIN = { error: 'Vsaj en dejaven skrbnik mora ostati.' };

const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T) =>
  schema.safeParse(await c.req.json().catch(() => null));
const invalid = (error: z.ZodError) => ({ error: 'Preverite označena polja.', fields: fieldErrors(error) });

// Kliče se samo za skrbnike. Pogodb drugih uporabnikov ne razkriva, razen njihovega števila.
export function createAdminApi(auth: AuthHolder, mail: Mail, users: UserStore, contracts: ContractStore) {
  const app = new Hono<Env>();


  app.get('/', (c) => c.json(users.list()));

  app.get('/:id', (c) => {
    const user = users.get(c.req.param('id'));
    return user ? c.json(user) : c.json(NOT_FOUND, 404);
  });

  app.post('/', async (c) => {
    const parsed = await body(c, userCreate);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { name, email, password, role, permissions, mustChangePassword } = parsed.data;
    const ctx = await auth.current.$context;
    if (await ctx.internalAdapter.findUserByEmail(email)) {
      return c.json({ error: 'Preverite označena polja.', fields: { email: 'Račun s to e-pošto že obstaja.' } }, 409);
    }
    const hash = await ctx.password.hash(password);
    const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: false }, { method: 'admin' });
    try {
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
      users.update(user.id, { role, permissions, disabled: false });
      users.setMustChangePassword(user.id, mustChangePassword);
    } catch (error) {
      users.remove(user.id);
      throw error;
    }
    return c.json(users.get(user.id), 201);
  });

  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!users.get(id)) return c.json(NOT_FOUND, 404);
    const parsed = await body(c, userUpdate);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const keepsAdmin = parsed.data.role === 'admin' && !parsed.data.disabled;
    if (!keepsAdmin) {
      if (id === c.get('userId')) return c.json({ error: 'Sebi ne morete odvzeti vloge skrbnika ali blokirati računa.' }, 409);
      if (users.isLastAdmin(id)) return c.json(LAST_ADMIN, 409);
    }
    users.update(id, parsed.data);
    return c.json(users.get(id));
  });

  app.post('/:id/password', async (c) => {
    const id = c.req.param('id');
    const user = users.get(id);
    if (!user) return c.json(NOT_FOUND, 404);
    if (id === c.get('userId')) return c.json({ error: 'Svoje geslo spremenite na strani Moj račun.' }, 409);
    const parsed = await body(c, passwordReset);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const ctx = await auth.current.$context;
    const hash = await ctx.password.hash(parsed.data.password);
    if (user.hasPassword) await ctx.internalAdapter.updatePassword(id, hash);
    else await ctx.internalAdapter.linkAccount({ userId: id, providerId: 'credential', accountId: id, password: hash });
    // Kdor se prijavlja prek ponudnika, začasnega gesla morda ne pozna, zato ga sprememba ne sme zakleniti.
    users.setMustChangePassword(id, parsed.data.mustChangePassword && !user.hasOidc);
    users.endSessions(id);
    return c.json(users.get(id));
  });

  // Povezava za novo geslo po e-pošti, namesto začasnega gesla.
  app.post('/:id/reset-link', async (c) => {
    const user = users.get(c.req.param('id'));
    if (!user) return c.json(NOT_FOUND, 404);
    if (!mail.canReset) return c.json({ error: 'Pošiljanje povezav po e-pošti ni vklopljeno.' }, 409);
    await auth.current.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/novo-geslo' } });
    return c.body(null, 204);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!users.get(id)) return c.json(NOT_FOUND, 404);
    if (id === c.get('userId')) return c.json({ error: 'Svojega računa ne morete izbrisati.' }, 409);
    if (users.isLastAdmin(id)) return c.json(LAST_ADMIN, 409);
    users.endSessions(id);
    await contracts.removeAll(id);
    users.remove(id);
    return c.body(null, 204);
  });

  return app;
}

export function createMailApi(config: Config, mail: Mail, reminders: Reminders, users: UserStore) {
  const app = new Hono<Env>();
  const requirePanel = () => {
    if (config.smtp) throw new HTTPException(409, { message: 'Strežnik pošte je nastavljen v okolju vsebnika in ga tu ni mogoče spremeniti.' });
  };

  app.get('/', (c) => c.json(mail.view()));

  app.put('/', async (c) => {
    requirePanel();
    const parsed = await body(c, mailInput);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    mail.save(parsed.data);
    return c.json(mail.view());
  });

  app.delete('/', (c) => {
    requirePanel();
    mail.clear();
    return c.json(mail.view());
  });

  app.put('/uses', async (c) => {
    const parsed = await body(c, mailUses);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    mail.setUses(parsed.data);
    return c.json(mail.view());
  });

  // Preizkusno sporočilo gre vedno na naslov prijavljenega skrbnika.
  app.post('/test', async (c) => {
    if (!mail.ready) return c.json({ error: 'Najprej shranite nastavitve pošte.' }, 409);
    const { email, language } = users.get(c.get('userId'))!;
    try {
      await mail.send({ to: email, subject: translate(language, 'Preizkusno sporočilo'), text: translate(language, 'Pošiljanje pošte iz Digitalnega arhiva pogodb deluje.') });
      return c.json({ to: email });
    } catch (error) {
      return c.json(mailError(error), 502);
    }
  });

  app.post('/reminders', async (c) => {
    if (!mail.canRemind) return c.json({ error: 'Opozorila po e-pošti niso vklopljena ali pošta ni nastavljena.' }, 409);
    return c.json(await reminders.run());
  });

  return app;
}

export function createOidcApi(config: Config, auth: AuthHolder, oidc: Oidc) {
  const app = new Hono<Env>();
  const requirePanel = () => {
    if (config.oidc) throw new HTTPException(409, { message: 'Ponudnik je nastavljen v okolju vsebnika in ga tu ni mogoče spremeniti.' });
  };

  app.get('/', (c) => c.json(oidc.view()));

  app.put('/', async (c) => {
    requirePanel();
    const parsed = await body(c, oidcInput);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const checked = await checkIssuer(parsed.data.issuer);
    if (typeof checked === 'string') return c.json({ error: 'Preverite označena polja.', fields: { issuer: checked } }, 400);
    if (!oidc.save(parsed.data)) return c.json({ error: 'Preverite označena polja.', fields: { clientSecret: 'Vnesite skrivnost odjemalca.' } }, 400);
    auth.rebuild();
    return c.json(oidc.view());
  });

  app.delete('/', (c) => {
    requirePanel();
    oidc.clear();
    auth.rebuild();
    return c.json(oidc.view());
  });

  app.post('/check', async (c) => {
    const parsed = await body(c, z.object({ issuer }));
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const checked = await checkIssuer(parsed.data.issuer);
    if (typeof checked === 'string') return c.json({ error: 'Preverite označena polja.', fields: { issuer: checked } }, 400);
    return c.json(checked);
  });

  return app;
}

export function createAiApi(ai: Ai) {
  const app = new Hono<Env>();

  app.get('/', (c) => c.json(ai.view()));

  app.put('/', async (c) => {
    const parsed = await body(c, aiInput);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    if (!ai.save(parsed.data)) return c.json({ error: 'Preverite označena polja.', fields: { apiKey: 'Vnesite ključ.' } }, 400);
    return c.json(ai.view());
  });

  app.delete('/', (c) => {
    ai.clear();
    return c.json(ai.view());
  });

  // Preveri povezavo in vrne modele, ki so na voljo.
  app.post('/models', async (c) => {
    const parsed = await body(c, aiConnection);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    try {
      return c.json(await ai.models(parsed.data));
    } catch (error) {
      if (error instanceof AiError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  return app;
}
