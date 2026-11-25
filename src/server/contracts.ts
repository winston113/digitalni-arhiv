import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MAX_ATTACHMENTS, type Attachment, type Contract, type ContractInput } from '../shared/contracts.js';
import type { TextState } from '../shared/search.js';
import type { Db } from './db.js';

interface Row {
  id: string; user_id: string; title: string; party: string; category: string; number: string | null;
  start_date: string; end_date: string | null; notice_days: number; warn_days: number;
  value_cents: number | null; value_period: string; notes: string | null;
  file_id: string; file_name: string; file_size: number;
  terminated_at: string | null; created_at: string;
}

const toContract = (r: Row): Contract => ({
  id: r.id, title: r.title, party: r.party, category: r.category as Contract['category'], number: r.number,
  startDate: r.start_date, endDate: r.end_date, noticeDays: r.notice_days, warnDays: r.warn_days,
  valueCents: r.value_cents, valuePeriod: r.value_period as Contract['valuePeriod'], notes: r.notes,
  fileName: r.file_name, fileSize: r.file_size, terminatedAt: r.terminated_at, createdAt: r.created_at,
});

interface AttachmentRow { id: string; contract_id: string; file_id: string; name: string; size: number; created_at: string; status: string | null }

const toState = (status: string | null | undefined): TextState => (status === 'text' || status === 'ocr' || status === 'empty' || status === 'failed' ? status : 'pending');

const toAttachment = (r: AttachmentRow): Attachment => ({ id: r.id, name: r.name, size: r.size, createdAt: r.created_at, textState: toState(r.status) });

export interface StoredFile { stream: () => ReadableStream; name: string; size: number }

// Naložena datoteka, ki jo shranjevanje prevzame, ne obstaja več.
export class UploadGone extends Error {}

// Vsaka poizvedba vsebuje user_id, zato uporabnik doseže samo svoje pogodbe.
export class ContractStore {
  constructor(private db: Db, private dataDir: string) {}

  private path(fileId: string) { return join(this.dataDir, 'files', `${fileId}.pdf`); }

  private row(userId: string, id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM contracts WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  }

  // Datoteka pogodbe je ista kot naložena, zato se prevzame brez kopiranja. Kliče se znotraj transakcije.
  private claim(userId: string, uploadId: string): { name: string; size: number } {
    const row = this.db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ? RETURNING name, size').get(uploadId, userId) as { name: string; size: number } | undefined;
    if (!row) throw new UploadGone();
    return row;
  }

  private async removeFile(fileId: string) { await rm(this.path(fileId), { force: true }); }

  list(userId: string): Contract[] {
    return (this.db.prepare('SELECT * FROM contracts WHERE user_id = ?').all(userId) as Row[]).map(toContract);
  }

  get(userId: string, id: string): Contract | null {
    const row = this.row(userId, id);
    return row ? toContract(row) : null;
  }

  create(userId: string, input: ContractInput, uploadId: string, attachmentIds: string[] = []): Contract {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const file = this.claim(userId, uploadId);
      this.db.prepare(`INSERT INTO contracts (id, user_id, title, party, category, number, start_date, end_date, notice_days, warn_days, value_cents, value_period, notes, file_id, file_name, file_size, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.title, input.party, input.category, input.number, input.startDate, input.endDate, input.noticeDays, input.warnDays, input.valueCents, input.valuePeriod, input.notes, uploadId, file.name, file.size, now, now);
      for (const attachment of attachmentIds) this.insertAttachment(userId, id, attachment);
    })();
    return this.get(userId, id)!;
  }

  async update(userId: string, id: string, input: ContractInput, uploadId: string | null): Promise<Contract | null> {
    const row = this.row(userId, id);
    if (!row) return null;
    this.db.transaction(() => {
      const file = uploadId ? this.claim(userId, uploadId) : { name: row.file_name, size: row.file_size };
      this.db.prepare(`UPDATE contracts SET title = ?, party = ?, category = ?, number = ?, start_date = ?, end_date = ?, notice_days = ?, warn_days = ?, value_cents = ?, value_period = ?, notes = ?, file_id = ?, file_name = ?, file_size = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(input.title, input.party, input.category, input.number, input.startDate, input.endDate, input.noticeDays, input.warnDays, input.valueCents, input.valuePeriod, input.notes, uploadId ?? row.file_id, file.name, file.size, new Date().toISOString(), id, userId);
    })();
    if (uploadId) await this.removeFile(row.file_id);
    return this.get(userId, id);
  }

  extend(userId: string, id: string, endDate: string): Contract | null {
    this.db.prepare('UPDATE contracts SET end_date = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(endDate, new Date().toISOString(), id, userId);
    return this.get(userId, id);
  }

  terminate(userId: string, id: string): Contract | null {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE contracts SET terminated_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(now, now, id, userId);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const row = this.row(userId, id);
    if (!row) return false;
    const files = this.attachmentRows(userId, id).map((a) => a.file_id);
    this.db.prepare('DELETE FROM contracts WHERE id = ? AND user_id = ?').run(id, userId);
    await Promise.all([row.file_id, ...files].map((f) => this.removeFile(f)));
    return true;
  }

  async removeAll(userId: string): Promise<void> {
    const rows = this.db.prepare('SELECT file_id FROM contracts WHERE user_id = ? UNION ALL SELECT a.file_id FROM attachments a JOIN contracts c ON c.id = a.contract_id WHERE c.user_id = ?').all(userId, userId) as { file_id: string }[];
    this.db.prepare('DELETE FROM contracts WHERE user_id = ?').run(userId);
    await Promise.all(rows.map((r) => this.removeFile(r.file_id)));
  }

  private stream(fileId: string): ReadableStream { return Readable.toWeb(createReadStream(this.path(fileId))) as ReadableStream; }

  file(userId: string, id: string): StoredFile | null {
    const row = this.row(userId, id);
    return row ? { stream: () => this.stream(row.file_id), name: row.file_name, size: row.file_size } : null;
  }

  textState(userId: string, id: string): TextState {
    const row = this.row(userId, id);
    return toState(row && (this.db.prepare('SELECT status FROM documents WHERE file_id = ?').get(row.file_id) as { status: string } | undefined)?.status);
  }

  mainPath(userId: string, id: string): string | null {
    const row = this.row(userId, id);
    return row ? this.path(row.file_id) : null;
  }

  // Priloge: lastništvo se vedno preveri prek pogodbe.
  private attachmentRows(userId: string, contractId: string): AttachmentRow[] {
    return this.db.prepare('SELECT a.*, d.status FROM attachments a LEFT JOIN documents d ON d.file_id = a.file_id JOIN contracts c ON c.id = a.contract_id WHERE c.id = ? AND c.user_id = ? ORDER BY a.created_at, a.rowid').all(contractId, userId) as AttachmentRow[];
  }

  private attachmentRow(userId: string, contractId: string, id: string): AttachmentRow | undefined {
    return this.attachmentRows(userId, contractId).find((a) => a.id === id);
  }

  attachments(userId: string, contractId: string): Attachment[] { return this.attachmentRows(userId, contractId).map(toAttachment); }

  allAttachments(userId: string): Map<string, Attachment[]> {
    const rows = this.db.prepare('SELECT a.*, d.status FROM attachments a LEFT JOIN documents d ON d.file_id = a.file_id JOIN contracts c ON c.id = a.contract_id WHERE c.user_id = ? ORDER BY a.created_at, a.rowid').all(userId) as AttachmentRow[];
    const result = new Map<string, Attachment[]>();
    for (const row of rows) result.set(row.contract_id, [...(result.get(row.contract_id) ?? []), toAttachment(row)]);
    return result;
  }

  private insertAttachment(userId: string, contractId: string, uploadId: string): void {
    const file = this.claim(userId, uploadId);
    this.db.prepare('INSERT INTO attachments (id, contract_id, file_id, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), contractId, uploadId, file.name, file.size, new Date().toISOString());
  }

  // Vrne false, če je priloga odveč ali pogodba ne obstaja.
  addAttachment(userId: string, contractId: string, uploadId: string): boolean {
    return this.db.transaction(() => {
      const found = this.db.prepare('SELECT (SELECT COUNT(*) FROM attachments x WHERE x.contract_id = c.id) AS n FROM contracts c WHERE c.id = ? AND c.user_id = ?').get(contractId, userId) as { n: number } | undefined;
      if (!found || found.n >= MAX_ATTACHMENTS) return false;
      this.insertAttachment(userId, contractId, uploadId);
      return true;
    })();
  }

  async removeAttachment(userId: string, contractId: string, id: string): Promise<boolean> {
    const row = this.attachmentRow(userId, contractId, id);
    if (!row) return false;
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    await this.removeFile(row.file_id);
    return true;
  }

  attachmentFile(userId: string, contractId: string, id: string): StoredFile | null {
    const row = this.attachmentRow(userId, contractId, id);
    return row ? { stream: () => this.stream(row.file_id), name: row.name, size: row.size } : null;
  }

  attachmentPath(userId: string, contractId: string, id: string): string | null {
    const row = this.attachmentRow(userId, contractId, id);
    return row ? this.path(row.file_id) : null;
  }
}
