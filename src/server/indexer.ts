import { join } from 'node:path';
import type { TextState } from '../shared/search.js';
import type { Db } from './db.js';
import { ToolsMissing, type Extract } from './extract.js';

const MAX_ATTEMPTS = 2;

// Besedilo dokumentov se pripravlja v ozadju, en dokument naenkrat.
export class Indexer {
  private working: Promise<void> | null = null;
  private stopped = false;

  constructor(private db: Db, private dataDir: string, private extract: Extract) {
    db.prepare("UPDATE documents SET status = 'pending' WHERE status = 'processing'").run();
  }

  start(): void {
    this.kick();
    setInterval(() => this.kick(), 10_000).unref();
  }

  stop(): void { this.stopped = true; }

  kick(): void { void this.drain().catch((error) => console.error('Obdelava besedila:', error)); }

  // Obdela vse čakajoče dokumente; hkratni klici si delijo isto izvajanje.
  drain(): Promise<void> {
    this.working ??= this.work().finally(() => { this.working = null; });
    return this.working;
  }

  private async work(): Promise<void> {
    const next = this.db.prepare("SELECT file_id, attempts FROM documents WHERE status = 'pending' ORDER BY attempts, created_at LIMIT 1");
    for (;;) {
      const doc = this.stopped ? undefined : (next.get() as { file_id: string; attempts: number } | undefined);
      if (!doc) return;
      this.db.prepare("UPDATE documents SET status = 'processing' WHERE file_id = ?").run(doc.file_id);
      try {
        const { pages, method } = await this.extract(join(this.dataDir, 'files', `${doc.file_id}.pdf`));
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

  static reset(db: Db): number {
    return db.prepare("UPDATE documents SET status = 'pending', attempts = 0").run().changes;
  }
}
