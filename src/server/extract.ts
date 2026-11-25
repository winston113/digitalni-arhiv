import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eachLimited, Limiter } from './limiter.js';
import { parseBbox, parseTsv, type Word } from './locate.js';

// words vsebuje besede z lego za strani, prebrane s slike (ključ je številka strani), če so zahtevane.
export interface Extracted { pages: string[]; method: 'text' | 'ocr' | 'empty'; words?: Map<number, Word[]> }
// maxScans omeji število strani, ki se berejo s slike.
export type Extract = (path: string, options?: { maxScans?: number; words?: boolean }) => Promise<Extracted>;
// Besede z lego na strani z besedilom.
export type PageWords = (path: string, page: number) => Promise<Word[]>;

export interface PdfTools {
  extract: Extract;
  pageWords: PageWords;
  countPages: (path: string) => Promise<number>;
  split: (path: string, from: number, to: number, out: string) => Promise<void>;
}

export const countPages = async (path: string): Promise<number> => {
  const pages = Number(/^Pages:\s+(\d+)/m.exec(await tool('pdfinfo', [path], 20_000))?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('Število strani ni znano.');
  return pages;
};

// Nov dokument vsebuje samo izbrane strani, brez kazala, prilog in skript izvirnika.
export const splitPages = async (path: string, from: number, to: number, out: string): Promise<void> => {
  await tool('qpdf', ['--warning-exit-0', '--empty', '--pages', path, `${from}-${to}`, '--', out], 120_000);
};

// Vidni del strani je enak kot v predogledu.
export const pageWords: PageWords = async (path, page) => {
  const only = ['-f', String(page), '-l', String(page)];
  const [info, words] = await Promise.all([tool('pdfinfo', [...only, path], 20_000), tool('pdftotext', ['-q', '-bbox', '-cropbox', '-enc', 'UTF-8', ...only, path, '-'], 20_000)]);
  return parseBbox(words, Number(/^Page\s+\d+\s+rot:\s+(\d+)/m.exec(info)?.[1] ?? 0));
};

export class ToolsMissing extends Error {}

export interface ExtractOptions { ocr: boolean; languages: string; workers: number }

const MAX_PAGES = 3000;
const MAX_OCR_PAGES = 200;
const MAX_PAGE_CHARS = 100_000;
// Stran z manj črkami štejemo za sliko (skenirana stran).
const MIN_LETTERS = 20;
// Daljša stranica slike; približno 220 pik na palec pri A4, velikost pa je omejena tudi pri nenavadnih straneh.
const OCR_PIXELS = 2600;

// Samo nevronska prepoznava: privzeta mešanica s starejšo na slabih skenih izgubi cele vrstice.
const ENGINE = ['--oem', '1'];
// Povečajte ob spremembi, po kateri je treba skenirane dokumente prebrati znova.
export const OCR_VERSION = 2;

const run = promisify(execFile);

// Datoteke niso zaupanja vredne, zato orodja tečejo ločeno, z omejenim časom in pomnilnikom ter nizko prednostjo.
// Ena stran uporablja eno nit: več vzporednih procesov je hitrejših od več niti na isti strani.
async function tool(name: string, args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await run('/bin/sh', ['-c', 'ulimit -v 1500000 2>/dev/null; exec nice -n 10 "$0" "$@"', name, ...args], {
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

export function createExtract({ ocr, languages, workers }: ExtractOptions): Extract {
  // Omejitev je skupna vsem dokumentom, zato število procesov nikoli ne preseže števila delavcev.
  const limiter = new Limiter(workers);
  const readPage = async (path: string, page: number, dir: string, withWords: boolean): Promise<{ text: string; words: Word[] }> => {
    const image = join(dir, `s${page}`);
    await tool('pdftoppm', ['-q', '-cropbox', '-gray', '-png', '-singlefile', '-scale-to', String(OCR_PIXELS), '-f', String(page), '-l', String(page), path, image], 60_000);
    try {
      const tables = withWords ? ['-c', 'tessedit_create_txt=1', '-c', 'tessedit_create_tsv=1'] : [];
      const out = await tool('tesseract', [`${image}.png`, withWords ? image : 'stdout', '-l', languages, '--psm', '3', ...ENGINE, ...tables], 120_000);
      if (!withWords) return { text: cleanText(out), words: [] };
      return { text: cleanText(await readFile(`${image}.txt`, 'utf8')), words: parseTsv(await readFile(`${image}.tsv`, 'utf8')) };
    } finally {
      for (const type of ['png', 'txt', 'tsv']) await rm(`${image}.${type}`, { force: true });
    }
  };

  return async (path, { maxScans = MAX_OCR_PAGES, words: withWords = false } = {}) => {
    const raw = await tool('pdftotext', ['-q', '-enc', 'UTF-8', '-eol', 'unix', path, '-'], 120_000);
    const pages = raw.split('\f').slice(0, MAX_PAGES).map(cleanText);
    if (pages.length > 1 && pages.at(-1) === '') pages.pop();

    const words = new Map<number, Word[]>();
    let recognised = false;
    const scans = ocr ? pages.flatMap((text, i) => (letters(text) < MIN_LETTERS ? [i] : [])).slice(0, maxScans) : [];
    if (scans.length > 0) {
      const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
      try {
        // Vsak dokument odda največ toliko strani naenkrat, kolikor je delavcev, da velik dokument ne zadrži majhnih.
        await eachLimited(scans, workers, async (i) => {
          // Ena neberljiva stran ne sme pokvariti celotnega dokumenta.
          const found = await limiter.run(() => readPage(path, i + 1, dir, withWords)).catch((error: unknown) => { if (error instanceof ToolsMissing) throw error; return null; });
          if (found && letters(found.text) > letters(pages[i]!)) { pages[i] = found.text; words.set(i + 1, found.words); recognised = true; }
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    return { pages, method: recognised ? 'ocr' : pages.some((p) => letters(p) > 0) ? 'text' : 'empty', ...(withWords && { words }) };
  };
}
