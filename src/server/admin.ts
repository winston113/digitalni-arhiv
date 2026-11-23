import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { fieldErrors } from '../shared/contracts.js';
import { passwordReset, userCreate, userUpdate, type Access } from '../shared/users.js';
import type { Auth } from './auth.js';
import type { Config } from './config.js';
import { mailInput, mailUses } from '../shared/mail.js';
import type { ContractStore } from './contracts.js';
import { mailError, type Mail } from './mail.js';
import type { Reminders } from './reminders.js';
import type { UserStore } from './users.js';

type Env = { Variables: { userId: string; access: Access } };

const NOT_FOUND = { error: 'Uporabnik ne obstaja.' };
const LAST_ADMIN = { error: 'Vsaj en dejaven skrbnik mora ostati.' };

const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T) =>
  schema.safeParse(await c.req.json().catch(() => null));
const invalid = (error: z.ZodError) => ({ error: 'Preverite označena polja.', fields: fieldErrors(error) });

// Kliče se samo za skrbnike. Pogodb drugih uporabnikov ne razkriva, razen njihovega števila.
export function createAdminApi(config: Config, auth: Auth, mail: Mail, users: UserStore, contracts: ContractStore) {
  const app = new Hono<Env>();

  const requireLocal = () => {
    if (!config.localLogin) throw new HTTPException(409, { message: 'Prijava z geslom je izklopljena.' });
  };

  app.get('/', (c) => c.json(users.list()));

  app.get('/:id', (c) => {
    const user = users.get(c.req.param('id'));
    return user ? c.json(user) : c.json(NOT_FOUND, 404);
  });

  app.post('/', async (c) => {
    requireLocal();
    const parsed = await body(c, userCreate);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const { name, email, password, role, permissions, mustChangePassword } = parsed.data;
    const ctx = await auth.$context;
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
    requireLocal();
    const id = c.req.param('id');
    const user = users.get(id);
    if (!user) return c.json(NOT_FOUND, 404);
    if (!user.hasPassword) return c.json({ error: 'Uporabnik se prijavlja prek zunanjega ponudnika in nima gesla.' }, 409);
    if (id === c.get('userId')) return c.json({ error: 'Svoje geslo spremenite na strani Sprememba gesla.' }, 409);
    const parsed = await body(c, passwordReset);
    if (!parsed.success) return c.json(invalid(parsed.error), 400);
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(parsed.data.password));
    users.setMustChangePassword(id, parsed.data.mustChangePassword);
    users.endSessions(id);
    return c.json(users.get(id));
  });

  // Povezava za novo geslo po e-pošti, namesto začasnega gesla.
  app.post('/:id/reset-link', async (c) => {
    const user = users.get(c.req.param('id'));
    if (!user) return c.json(NOT_FOUND, 404);
    if (!mail.canReset) return c.json({ error: 'Pošiljanje povezav po e-pošti ni vklopljeno.' }, 409);
    if (!user.hasPassword) return c.json({ error: 'Uporabnik se prijavlja prek zunanjega ponudnika in nima gesla.' }, 409);
    await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/novo-geslo' } });
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
    const { email } = users.get(c.get('userId'))!;
    try {
      await mail.send({ to: email, subject: 'Preizkusno sporočilo', text: 'Pošiljanje pošte iz Digitalnega arhiva pogodb deluje.\n' });
      return c.json({ to: email });
    } catch (error) {
      return c.json({ error: mailError(error) }, 502);
    }
  });

  app.post('/reminders', async (c) => {
    if (!mail.canRemind) return c.json({ error: 'Opozorila po e-pošti niso vklopljena ali pošta ni nastavljena.' }, 409);
    return c.json(await reminders.run());
  });

  return app;
}
