import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAuth, migrateAuth } from './auth.js';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';
import { createMailer } from './mail.js';

const config = loadConfig();
const db = openDb(config.dataDir);
const auth = createAuth(config, db, config.smtp ? createMailer(config.smtp) : null);
await migrateAuth(auth);
migrate(db);

const webDir = fileURLToPath(new URL('../web', import.meta.url));
const app = createApp(config, db, auth, existsSync(webDir) ? webDir : null);
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Digitalni arhiv pogodb: ${config.baseUrl} (vrata ${config.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
