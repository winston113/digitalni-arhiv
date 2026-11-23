import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Contract, ContractInput } from '../shared/contracts.js';
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

export interface Upload { name: string; bytes: Uint8Array }

// Vsaka poizvedba vsebuje user_id, zato uporabnik doseže samo svoje pogodbe.
export class ContractStore {
  constructor(private db: Db, private dataDir: string) {}

  private path(fileId: string) { return join(this.dataDir, 'files', `${fileId}.pdf`); }

  private row(userId: string, id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM contracts WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  }

  private async saveFile(file: Upload): Promise<string> {
    const fileId = randomUUID();
    await writeFile(this.path(fileId), file.bytes, { mode: 0o600, flag: 'wx' });
    return fileId;
  }

  private async removeFile(fileId: string) { await rm(this.path(fileId), { force: true }); }

  list(userId: string): Contract[] {
    return (this.db.prepare('SELECT * FROM contracts WHERE user_id = ?').all(userId) as Row[]).map(toContract);
  }

  get(userId: string, id: string): Contract | null {
    const row = this.row(userId, id);
    return row ? toContract(row) : null;
  }

  async create(userId: string, input: ContractInput, file: Upload): Promise<Contract> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const fileId = await this.saveFile(file);
    try {
      this.db.prepare(`INSERT INTO contracts (id, user_id, title, party, category, number, start_date, end_date, notice_days, warn_days, value_cents, value_period, notes, file_id, file_name, file_size, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, input.title, input.party, input.category, input.number, input.startDate, input.endDate, input.noticeDays, input.warnDays, input.valueCents, input.valuePeriod, input.notes, fileId, file.name, file.bytes.length, now, now);
    } catch (error) {
      await this.removeFile(fileId);
      throw error;
    }
    return this.get(userId, id)!;
  }

  async update(userId: string, id: string, input: ContractInput, file: Upload | null): Promise<Contract | null> {
    const row = this.row(userId, id);
    if (!row) return null;
    const fileId = file ? await this.saveFile(file) : row.file_id;
    try {
      this.db.prepare(`UPDATE contracts SET title = ?, party = ?, category = ?, number = ?, start_date = ?, end_date = ?, notice_days = ?, warn_days = ?, value_cents = ?, value_period = ?, notes = ?, file_id = ?, file_name = ?, file_size = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(input.title, input.party, input.category, input.number, input.startDate, input.endDate, input.noticeDays, input.warnDays, input.valueCents, input.valuePeriod, input.notes, fileId, file?.name ?? row.file_name, file?.bytes.length ?? row.file_size, new Date().toISOString(), id, userId);
    } catch (error) {
      if (file) await this.removeFile(fileId);
      throw error;
    }
    if (file) await this.removeFile(row.file_id);
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
    this.db.prepare('DELETE FROM contracts WHERE id = ? AND user_id = ?').run(id, userId);
    await this.removeFile(row.file_id);
    return true;
  }

  file(userId: string, id: string): { stream: ReadableStream; name: string; size: number } | null {
    const row = this.row(userId, id);
    if (!row) return null;
    return { stream: Readable.toWeb(createReadStream(this.path(row.file_id))) as ReadableStream, name: row.file_name, size: row.file_size };
  }
}
