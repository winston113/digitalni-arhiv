import Database from 'better-sqlite3';
import { join } from 'node:path';

export type Db = Database.Database;

// Vsaka sprememba sheme je nov vnos na koncu; obstoječih ne spreminjamo.
const MIGRATIONS = [
  `CREATE TABLE contracts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    party TEXT NOT NULL,
    category TEXT NOT NULL,
    number TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    notice_days INTEGER NOT NULL,
    warn_days INTEGER NOT NULL,
    value_cents INTEGER,
    value_period TEXT NOT NULL,
    notes TEXT,
    file_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    terminated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX contracts_user ON contracts(user_id);`,
  `CREATE TABLE user_access (
    user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    disabled INTEGER NOT NULL DEFAULT 0,
    can_create INTEGER NOT NULL DEFAULT 1,
    can_edit INTEGER NOT NULL DEFAULT 1,
    can_remove INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO user_access (user_id, role)
    SELECT id, CASE WHEN id = (SELECT id FROM user ORDER BY createdAt, rowid LIMIT 1) THEN 'admin' ELSE 'user' END FROM user;`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  ALTER TABLE user_access ADD COLUMN reminders INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE reminders (
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    end_date TEXT NOT NULL,
    stage TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (contract_id, end_date, stage)
  );`,
  `ALTER TABLE user_access ADD COLUMN language TEXT NOT NULL DEFAULT 'sl';`,
];

export function openDb(dataDir: string): Db {
  const db = new Database(join(dataDir, 'arhiv.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
