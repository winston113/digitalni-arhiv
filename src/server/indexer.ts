import type { TextState } from '../shared/search.js';
import type { Db } from './db.js';
import type { Settings } from './settings.js';
import { filePath } from './files.js';
import { ToolsMissing, type Extract } from './extract.js';

const MAX_ATTEMPTS = 2;

// Besedilo dokumentov se pripravlja v ozadju, več dokumentov hkrati.
export class Indexer {
  private active = 0;
  private stopped = false;
  private idle: (() => void)[] = [];

  constructor(private db: Db, private dataDir: string, private extract: Extract, private workers = 1) {
    db.prepare("UPDATE documents SET status = 'pending' WHERE status = 'processing'").run();
  }

  start(): void {
    this.kick();
    setInterval(() => this.kick(), 10_000).unref();
  }

  stop(): void { this.stopped = true; }

  // Začne toliko čakajočih dokumentov, kolikor je prostih mest.
  kick(): void {
    while (!this.stopped && this.active < this.workers) {
      const doc = this.claim();
      if (!doc) break;
      this.active++;
      void this.process(doc).catch((error) => console.error('Obdelava besedila:', error)).finally(() => {
        this.active--;
        this.kick();
        if (this.active === 0) this.idle.splice(0).forEach((done) => done());
      });
    }
  }

  // Počaka, da ni več čakajočih dokumentov.
  async drain(): Promise<void> {
    this.kick();
    if (this.active > 0) await new Promise<void>((resolve) => this.idle.push(resolve));
  }

  private claim(): { file_id: string; attempts: number } | undefined {
    return this.db.prepare(`UPDATE documents SET status = 'processing'
      WHERE file_id = (SELECT file_id FROM documents WHERE status = 'pending' ORDER BY attempts, created_at LIMIT 1)
      RETURNING file_id, attempts`).get() as { file_id: string; attempts: number } | undefined;
  }

  private async process(doc: { file_id: string; attempts: number }): Promise<void> {
    try {
      const { pages, method } = await this.extract(filePath(this.dataDir, doc.file_id));
      this.save(doc.file_id, pages, method);
    } catch (error) {
      if (error instanceof ToolsMissing) {
        this.db.prepare("UPDATE documents SET status = 'pending' WHERE file_id = ?").run(doc.file_id);
        if (!this.stopped) console.warn(`Besedila dokumentov ni mogoče pripraviti: manjka program ${error.message}.`);
        this.stopped = true;
        return;
      }
      const attempts = doc.attempts + 1;
      this.db.prepare('UPDATE documents SET status = ?, attempts = ? WHERE file_id = ?').run(attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, doc.file_id);
      console.error('Dokumenta ni bilo mogoče prebrati:', doc.file_id);
    }
  }

  private save(fileId: string, pages: string[], method: TextState): void {
    this.db.transaction(() => {
      // Dokument je bil med obdelavo lahko izbrisan ali zamenjan.
      if (!this.db.prepare('SELECT 1 FROM documents WHERE file_id = ?').get(fileId)) return;
      this.db.prepare('DELETE FROM document_pages WHERE file_id = ?').run(fileId);
      const insert = this.db.prepare('INSERT INTO document_pages (file_id, page, text) VALUES (?, ?, ?)');
      pages.forEach((text, i) => { if (text) insert.run(fileId, i + 1, text); });
      this.db.prepare('UPDATE documents SET status = ? WHERE file_id = ?').run(method, fileId);
    })();
  }

  // Znova poskusi neuspele dokumente ene pogodbe; lastništvo preveri klicatelj.
  retry(contractId: string): void {
    this.db.prepare("UPDATE documents SET status = 'pending', attempts = 0 WHERE contract_id = ? AND status = 'failed'").run(contractId);
    this.kick();
  }

  // Po izboljšavi prepoznave enkrat znova prebere skenirane dokumente; dosedanje besedilo ostane v iskanju do zamenjave.
  static rereadScans(db: Db, settings: Settings, version: number): number {
    if (settings.get<number>('ocr-version') === version) return 0;
    return db.transaction(() => {
      settings.set('ocr-version', version);
      return db.prepare("UPDATE documents SET status = 'pending', attempts = 0 WHERE status IN ('ocr', 'empty')").run().changes;
    })();
  }

  static reset(db: Db): number {
    return db.prepare("UPDATE documents SET status = 'pending', attempts = 0").run().changes;
  }
}
