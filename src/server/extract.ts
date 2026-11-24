import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface Extracted { pages: string[]; method: 'text' | 'ocr' | 'empty' }
export type Extract = (path: string) => Promise<Extracted>;

export class ToolsMissing extends Error {}

export interface ExtractOptions { ocr: boolean; languages: string }

const MAX_PAGES = 3000;
const MAX_OCR_PAGES = 200;
const MAX_PAGE_CHARS = 100_000;
// Stran z manj črkami štejemo za sliko (skenirana stran).
const MIN_LETTERS = 20;
// Daljša stranica slike; približno 220 pik na palec pri A4, velikost pa je omejena tudi pri nenavadnih straneh.
const OCR_PIXELS = 2600;

const run = promisify(execFile);

// Datoteke niso zaupanja vredne, zato orodja tečejo ločeno, z omejenim časom in pomnilnikom.
async function tool(name: string, args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await run('/bin/sh', ['-c', 'ulimit -v 1500000 2>/dev/null; exec "$0" "$@"', name, ...args], {
      timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', OMP_THREAD_LIMIT: '1', HOME: tmpdir() },
    });
    return stdout;
  } catch (error) {
    if ((error as { code?: unknown }).code === 127) throw new ToolsMissing(name);
    throw error;
  }
}

export function cleanText(text: string): string {
  return text.normalize('NFC')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f­​﻿]/g, '')
    .replace(/(\p{L})-\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, MAX_PAGE_CHARS);
}

const letters = (text: string) => text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

export function createExtract({ ocr, languages }: ExtractOptions): Extract {
  const readPage = async (path: string, page: number, dir: string): Promise<string> => {
    const image = join(dir, `s${page}`);
    await tool('pdftoppm', ['-q', '-gray', '-png', '-singlefile', '-scale-to', String(OCR_PIXELS), '-f', String(page), '-l', String(page), path, image], 60_000);
    try {
      return cleanText(await tool('tesseract', [`${image}.png`, 'stdout', '-l', languages, '--psm', '3'], 120_000));
    } finally {
      await rm(`${image}.png`, { force: true });
    }
  };

  return async (path) => {
    const raw = await tool('pdftotext', ['-q', '-enc', 'UTF-8', '-eol', 'unix', path, '-'], 120_000);
    const pages = raw.split('\f').slice(0, MAX_PAGES).map(cleanText);
    if (pages.length > 1 && pages.at(-1) === '') pages.pop();

    let scanned = 0;
    let recognised = false;
    if (ocr) {
      const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
      try {
        for (const [i, text] of pages.entries()) {
          if (letters(text) >= MIN_LETTERS || scanned >= MAX_OCR_PAGES) continue;
          scanned++;
          // Ena neberljiva stran ne sme pokvariti celotnega dokumenta.
          const found = await readPage(path, i + 1, dir).catch((error: unknown) => { if (error instanceof ToolsMissing) throw error; return ''; });
          if (letters(found) > letters(text)) { pages[i] = found; recognised = true; }
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    return { pages, method: recognised ? 'ocr' : pages.some((p) => letters(p) > 0) ? 'text' : 'empty' };
  };
}
