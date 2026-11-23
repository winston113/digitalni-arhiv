import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Db } from './db.js';

// Nastavitve iz skrbniškega dela. Skrivnosti so šifrirane s ključem, izpeljanim iz SECRET.
export class Settings {
  private key: Buffer;

  constructor(private db: Db, secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, '', 'arhiv-nastavitve', 32));
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  remove(key: string): void { this.db.prepare('DELETE FROM settings WHERE key = ?').run(key); }

  encrypt(text: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  // Vrne null, če se je SECRET spremenil in vrednosti ni več mogoče prebrati.
  decrypt(text: string): string | null {
    try {
      const raw = Buffer.from(text, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
