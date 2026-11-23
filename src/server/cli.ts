// Ponastavitev gesla: node dist/server/cli.js geslo <e-pošta>
// Novo geslo se prebere s standardnega vhoda, da ne ostane v zgodovini ukazov.
import { createInterface } from 'node:readline/promises';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const [command, email] = process.argv.slice(2);
if (command !== 'geslo' || !email) {
  console.error('Uporaba: node dist/server/cli.js geslo <e-pošta>');
  process.exit(2);
}

const config = loadConfig();
const db = openDb(config.dataDir);
const ctx = await createAuth(config, db, null).$context;
const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase(), { includeAccounts: true });
if (!found) {
  console.error('Uporabnik s to e-pošto ne obstaja.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question('Novo geslo: ');
rl.close();
if (password.length < 8) {
  console.error('Geslo je prekratko. Vnesite najmanj 8 znakov.');
  process.exit(1);
}

const hash = await ctx.password.hash(password);
if (found.accounts.some((a) => a.providerId === 'credential')) {
  await ctx.internalAdapter.updatePassword(found.user.id, hash);
} else {
  await ctx.internalAdapter.linkAccount({ userId: found.user.id, providerId: 'credential', accountId: found.user.id, password: hash });
}
db.prepare('DELETE FROM session WHERE userId = ?').run(found.user.id);
console.log('Geslo je spremenjeno, vse seje so odjavljene.');
db.close();
