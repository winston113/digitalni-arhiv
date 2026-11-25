import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Ai } from './ai.js';
import { AuthHolder, createAuth, migrateAuth } from './auth.js';
import { loadConfigOrExit } from './config.js';
import { migrate, openDb } from './db.js';
import { ContractStore } from './contracts.js';
import { Mail } from './mail.js';
import { Oidc } from './oidc.js';
import { countPages, createExtract, OCR_VERSION, pageWords, splitPages } from './extract.js';
import { Indexer } from './indexer.js';
import { tooManyWorkers } from './limiter.js';
import { Reminders } from './reminders.js';
import { Settings } from './settings.js';
import { UserStore } from './users.js';

const config = loadConfigOrExit();
const db = openDb(config.dataDir);
const settings = new Settings(db, config.secret);
const mail = new Mail(config, settings);
// Tabele morajo obstajati, preden se preberejo nastavitve ponudnika.
await migrateAuth(createAuth(config, db, mail, null));
migrate(db);
new UserStore(db).ensureTrigger();
const oidc = new Oidc(config, settings);
const auth = new AuthHolder(() => createAuth(config, db, mail, oidc.current));

const reminders = new Reminders(config, db, new ContractStore(db, config.dataDir), mail, settings);
reminders.start();
const extract = createExtract({ ocr: config.ocr, languages: config.ocrLanguages, workers: config.ocrWorkers });
const indexer = new Indexer(db, config.dataDir, extract, config.ocrWorkers);
const reread = config.ocr ? Indexer.rereadScans(db, settings, OCR_VERSION) : 0;
if (reread) console.log(`Skenirani dokumenti, ki bodo znova prebrani: ${reread}`);
indexer.start();

const webDir = fileURLToPath(new URL('../web', import.meta.url));
const app = createApp(config, db, auth, mail, oidc, reminders, indexer, new Ai(db, settings), { extract, pageWords, countPages, split: splitPages }, existsSync(webDir) ? webDir : null);
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Digitalni arhiv pogodb: ${config.baseUrl} (vrata ${config.port})`);
  console.log(`OCR: ${config.ocr ? `vklopljen, sočasnih obdelav: ${config.ocrWorkers}` : 'izklopljen'}`);
  if (config.ocr && tooManyWorkers(config.ocrWorkers)) console.warn('OCR_WORKERS je visok za razpoložljivi pomnilnik; aplikacija je lahko počasna.');
});

// Velika datoteka lahko po počasni povezavi potuje dolgo; privzeta meja je pet minut.
(server as Server).requestTimeout = 30 * 60 * 1000;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    indexer.stop();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
