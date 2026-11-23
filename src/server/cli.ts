// Ukazi za skrbnika:
//   node dist/server/cli.js geslo <e-pošta>   novo geslo (prebere se s standardnega vhoda)
//   node dist/server/cli.js skrbnik <e-pošta> podeli vlogo skrbnika in odblokira račun
//   node dist/server/cli.js demo <e-pošta>    doda vzorčne pogodbe uporabniku brez pogodb
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { contractInput } from '../shared/contracts.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { ContractStore } from './contracts.js';
import { migrate, openDb } from './db.js';
import { Mail } from './mail.js';
import { Settings } from './settings.js';
import { UserStore } from './users.js';

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const [command, email] = process.argv.slice(2);
if (!['geslo', 'skrbnik', 'demo'].includes(command ?? '') || !email) fail('Uporaba: node dist/server/cli.js geslo|skrbnik|demo <e-pošta>', 2);

const config = loadConfig();
const db = openDb(config.dataDir);
migrate(db);
const users = new UserStore(db);
const ctx = await createAuth(config, db, new Mail(config, new Settings(db, config.secret))).$context;
const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase(), { includeAccounts: true });
if (!found) fail('Uporabnik s to e-pošto ne obstaja.');
const userId = found.user.id;

if (command === 'geslo') {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const password = await rl.question('Novo geslo: ');
  rl.close();
  if (password.length < 8) fail('Geslo je prekratko. Vnesite najmanj 8 znakov.');
  const hash = await ctx.password.hash(password);
  if (found.accounts.some((a) => a.providerId === 'credential')) await ctx.internalAdapter.updatePassword(userId, hash);
  else await ctx.internalAdapter.linkAccount({ userId, providerId: 'credential', accountId: userId, password: hash });
  users.setMustChangePassword(userId, false);
  users.endSessions(userId);
  console.log('Geslo je spremenjeno, vse seje so odjavljene.');
} else if (command === 'skrbnik') {
  users.update(userId, { role: 'admin', disabled: false, permissions: users.access(userId)!.permissions });
  console.log('Uporabnik je skrbnik.');
} else {
  const store = new ContractStore(db, config.dataDir);
  if (store.list(userId).length > 0) fail('Uporabnik že ima pogodbe. Vzorčne pogodbe se dodajo samo v prazen arhiv.');
  const dir = join(process.cwd(), 'demo');
  const samples = JSON.parse(readFileSync(join(dir, 'pogodbe.json'), 'utf8')) as { file: string; terminated?: boolean }[];
  for (const sample of samples) {
    const bytes = new Uint8Array(readFileSync(join(dir, sample.file)));
    const contract = await store.create(userId, contractInput.parse(sample), { name: sample.file, bytes });
    if (sample.terminated) store.terminate(userId, contract.id);
  }
  console.log(`Dodanih pogodb: ${samples.length}`);
}
db.close();
