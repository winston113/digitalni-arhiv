import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAuth, migrateAuth } from './auth.js';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';
import { ContractStore } from './contracts.js';
import { Mail } from './mail.js';
import { Reminders } from './reminders.js';
import { Settings } from './settings.js';
import { UserStore } from './users.js';

const config = loadConfig();
const db = openDb(config.dataDir);
const settings = new Settings(db, config.secret);
const mail = new Mail(config, settings);
const auth = createAuth(config, db, mail);
await migrateAuth(auth);
migrate(db);
new UserStore(db).ensureTrigger();

const reminders = new Reminders(config, db, new ContractStore(db, config.dataDir), mail, settings);
reminders.start();

const webDir = fileURLToPath(new URL('../web', import.meta.url));
const app = createApp(config, db, auth, mail, reminders, existsSync(webDir) ? webDir : null);
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Digitalni arhiv pogodb: ${config.baseUrl} (vrata ${config.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
