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
  `CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX attachments_contract ON attachments(contract_id);`,
  // Besedilo dokumentov za iskanje. Sprožilci skrbijo, da ima vsaka datoteka natanko en zapis.
  `CREATE TABLE documents (
    file_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX documents_contract ON documents(contract_id);
  CREATE INDEX documents_attachment ON documents(attachment_id);
  CREATE INDEX documents_status ON documents(status);
  CREATE TABLE document_pages (
    id INTEGER PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES documents(file_id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX document_pages_file ON document_pages(file_id, page);
  CREATE VIRTUAL TABLE document_fts USING fts5(text, content='document_pages', content_rowid='id', tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');
  CREATE TRIGGER document_pages_insert AFTER INSERT ON document_pages BEGIN
    INSERT INTO document_fts (rowid, text) VALUES (NEW.id, NEW.text);
  END;
  CREATE TRIGGER document_pages_delete AFTER DELETE ON document_pages BEGIN
    INSERT INTO document_fts (document_fts, rowid, text) VALUES ('delete', OLD.id, OLD.text);
  END;
  CREATE TRIGGER contracts_document_insert AFTER INSERT ON contracts BEGIN
    INSERT INTO documents (file_id, contract_id) VALUES (NEW.file_id, NEW.id);
  END;
  CREATE TRIGGER contracts_document_update AFTER UPDATE OF file_id ON contracts WHEN NEW.file_id <> OLD.file_id BEGIN
    DELETE FROM documents WHERE file_id = OLD.file_id;
    INSERT INTO documents (file_id, contract_id) VALUES (NEW.file_id, NEW.id);
  END;
  CREATE TRIGGER attachments_document_insert AFTER INSERT ON attachments BEGIN
    INSERT INTO documents (file_id, contract_id, attachment_id) VALUES (NEW.file_id, NEW.contract_id, NEW.id);
  END;
  INSERT INTO documents (file_id, contract_id) SELECT file_id, id FROM contracts;
  INSERT INTO documents (file_id, contract_id, attachment_id) SELECT file_id, contract_id, id FROM attachments;`,
  // Uporaba umetne inteligence ni dovoljena nikomur, dokler je skrbnik ne dovoli.
  `ALTER TABLE user_access ADD COLUMN can_use_ai INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE ai_usage (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );`,
  `CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX uploads_user ON uploads(user_id);`,
];

export function openDb(dataDir: string): Db {
  const db = new Database(join(dataDir, 'arhiv.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: Db, target = MIGRATIONS.length): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < target; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
