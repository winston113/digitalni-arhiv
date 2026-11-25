import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { SplitPart, Upload } from '../shared/uploads.js';
import type { Db } from './db.js';
import type { PdfTools } from './extract.js';

const MAX_WAITING = 100;
const MAX_AGE = 24 * 60 * 60 * 1000;

interface Row { id: string; user_id: string; name: string; size: number; pages: number | null }

export class UploadError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 422 | 507) { super(message); }
}

export const TOO_LARGE = 'Datoteka je prevelika. Izberite manjšo datoteko PDF.';
export const NOT_PDF = 'Datoteka ni v obliki PDF. Izberite datoteko PDF.';
export const NO_SPACE = 'V arhivu ni več prostora. Obrnite se na skrbnika.';
export const GONE = 'Naložena datoteka ni več na voljo. Izberite jo znova.';

export function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).at(-1) ?? '').replace(/[\p{Cc}"]/gu, '').trim().slice(-150);
  return base || 'pogodba.pdf';
}

const toUpload = (r: Row): Upload => ({ id: r.id, name: r.name, size: r.size, pages: r.pages });

// Datoteke, ki čakajo na shranjevanje. Ob shranjevanju pogodbe se prevzamejo brez kopiranja, sicer po enem dnevu izginejo.
export class UploadStore {
  constructor(private db: Db, private dataDir: string, private tools: Pick<PdfTools, 'countPages' | 'split'>, private maxSize: number, private storageLimit: number | null) {}

  path(id: string): string { return join(this.dataDir, 'files', `${id}.pdf`); }

  private row(userId: string, id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  }

  get(userId: string, id: string): Upload | null {
    const row = this.row(userId, id);
    return row ? toUpload(row) : null;
  }

  stream(id: string): ReadableStream { return Readable.toWeb(createReadStream(this.path(id))) as ReadableStream; }

  // Skupna velikost vseh datotek, za omejitev prostora.
  usedSpace(): number {
    return (this.db.prepare(`SELECT (SELECT COALESCE(SUM(file_size), 0) FROM contracts) + (SELECT COALESCE(SUM(size), 0) FROM attachments)
      + (SELECT COALESCE(SUM(size), 0) FROM uploads) AS n`).get() as { n: number }).n;
  }

  private checkRoom(userId: string, size: number): void {
    if (this.storageLimit !== null && this.usedSpace() + size > this.storageLimit) throw new UploadError(NO_SPACE, 507);
    const waiting = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM uploads WHERE user_id = ?').get(userId) as { n: number; size: number };
    if (waiting.n >= MAX_WAITING || waiting.size + size > 4 * this.maxSize) throw new UploadError('Preveč naloženih datotek čaka na shranjevanje. Shranite jih ali poskusite jutri.', 409);
  }

  private insert(userId: string, id: string, name: string, size: number, pages: number | null): Upload {
    this.db.prepare('INSERT INTO uploads (id, user_id, name, size, pages, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, name, size, pages, new Date().toISOString());
    return { id, name, size, pages };
  }

  // Zapisuje sproti, da velika datoteka ni nikoli v celoti v pomnilniku.
  async receive(userId: string, name: string, body: AsyncIterable<Uint8Array> | null, declared: number): Promise<Upload> {
    if (declared > this.maxSize) throw new UploadError(TOO_LARGE, 413);
    this.checkRoom(userId, declared);
    const id = randomUUID();
    const path = this.path(id);
    try {
      const file = await open(path, 'wx', 0o600);
      let size = 0;
      let head = Buffer.alloc(0);
      try {
        for await (const chunk of body ?? []) {
          size += chunk.length;
          if (size > this.maxSize) throw new UploadError(TOO_LARGE, 413);
          if (head.length < 5) {
            head = Buffer.concat([head, chunk]).subarray(0, 5);
            if (head.length === 5 && head.toString('latin1') !== '%PDF-') throw new UploadError(NOT_PDF, 400);
          }
          await file.write(chunk);
        }
      } finally {
        await file.close();
      }
      if (size === 0) throw new UploadError('Izberite datoteko PDF.', 400);
      if (head.length < 5) throw new UploadError(NOT_PDF, 400);
      const pages = await this.tools.countPages(path).catch(() => null);
      this.checkRoom(userId, size);
      return this.insert(userId, id, cleanFileName(name), size, pages);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  // Vsak del postane nova naložena datoteka; izvirnik ostane.
  async split(userId: string, id: string, parts: SplitPart[]): Promise<Upload[]> {
    const source = this.row(userId, id);
    if (!source) throw new UploadError(GONE, 404);
    if (!source.pages || parts.some((p) => p.to > source.pages!)) throw new UploadError('Te datoteke ni mogoče razdeliti.', 422);
    const done: Upload[] = [];
    try {
      for (const part of parts) {
        const newId = randomUUID();
        // V imenu je lahko številka pogodbe s poševnico.
        const name = part.name.replace(/[\\/]/g, '-');
        try {
          await this.tools.split(this.path(id), part.from, part.to, this.path(newId));
          const { size } = await stat(this.path(newId));
          this.checkRoom(userId, size);
          done.push(this.insert(userId, newId, cleanFileName(/\.pdf$/i.test(name) ? name : `${name}.pdf`), size, part.to - part.from + 1));
        } catch (error) {
          await rm(this.path(newId), { force: true });
          throw error instanceof UploadError ? error : new UploadError('Te datoteke ni mogoče razdeliti.', 422);
        }
      }
    } catch (error) {
      for (const part of done) await this.remove(userId, part.id);
      throw error;
    }
    return done;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    if (this.db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ?').run(id, userId).changes === 0) return false;
    await rm(this.path(id), { force: true });
    return true;
  }

  async removeAll(userId: string): Promise<void> {
    const rows = this.db.prepare('SELECT id FROM uploads WHERE user_id = ?').all(userId) as { id: string }[];
    for (const { id } of rows) await this.remove(userId, id);
  }

  async cleanup(now = Date.now()): Promise<number> {
    const rows = this.db.prepare('SELECT id, user_id FROM uploads WHERE created_at < ?').all(new Date(now - MAX_AGE).toISOString()) as { id: string; user_id: string }[];
    for (const row of rows) await this.remove(row.user_id, row.id);
    return rows.length;
  }

  start(): void {
    const run = () => { this.cleanup().catch((error) => console.error('Čiščenje naloženih datotek:', error)); };
    run();
    setInterval(run, 60 * 60 * 1000).unref();
  }
}
