import { strFromU8, unzipSync } from 'fflate';
import { readFile, stat } from 'node:fs/promises';

// Datoteka se bere v pomnilniku, zato je meja nižja kot pri PDF.
export const MAX_DOCX = 30 * 1024 * 1024;
const MAX_PART = 20 * 1024 * 1024;
const MAX_ENTRIES = 5000;
// Skupna velikost razširjene vsebine; ščiti tudi brskalnik, ki datoteko odpre za predogled.
const MAX_UNPACKED = 300 * 1024 * 1024;
const SECTION = 3000;

export class DocxError extends Error {}

const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const READ = /^(\[Content_Types\]\.xml|word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml)$/;

function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (++entries > MAX_ENTRIES || total > MAX_UNPACKED) throw new DocxError('prevelika vsebina');
        if (!READ.test(f.name)) return false;
        if (f.originalSize > MAX_PART) throw new DocxError('prevelika vsebina');
        return true;
      },
    });
  } catch (error) {
    throw error instanceof DocxError ? error : new DocxError('ni arhiv ZIP');
  }
  const types = files['[Content_Types].xml'];
  // Makri (docm) in druge vrste dokumentov imajo drugačno glavno vsebino.
  if (!files['word/document.xml'] || !types || !strFromU8(types).includes(MAIN)) throw new DocxError('ni dokument Word');
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (all, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()]!;
    const code = dec ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}

// Vidno besedilo: brez izbrisanih in prestavljenih delov, kod polj ter podvojenih nadomestnih različic.
const SKIPPED = new Set(['w:del', 'w:moveFrom', 'mc:Fallback']);
export function xmlText(xml: string): string {
  let out = '';
  let hidden = 0;
  let inText = false;
  for (const [token, close, name, self] of xml.matchAll(/<(\/?)([A-Za-z0-9]+:[A-Za-z0-9]+)(?:\s[^<>]*?)?(\/?)>|[^<]+/g)) {
    if (name === undefined) {
      if (inText && !hidden) out += decode(token);
    } else if (SKIPPED.has(name)) {
      if (!self) hidden = Math.max(0, hidden + (close ? -1 : 1));
    } else if (hidden) {
      continue;
    } else if (name === 'w:t') {
      inText = !close && !self;
    } else if (name === 'w:tab' || name === 'w:br' || name === 'w:cr') {
      // Tabulator je tudi v nastavitvah odstavka, kjer ne pomeni besedila, presledek pa ne moti.
      out += name === 'w:tab' ? ' ' : '\n';
    } else if (name === 'w:noBreakHyphen' && !close) {
      out += '-';
    } else if (name === 'w:p' && (close || self)) {
      out += '\n';
    } else if (name === 'w:tc' && close) {
      out += ' ';
    }
  }
  return out;
}

// Razdeli na dele po odstavkih, ker DOCX nima strani.
function sections(text: string): string[] {
  const out: string[] = [];
  let part = '';
  for (const line of text.split('\n')) {
    if (part && part.length + line.length > SECTION) { out.push(part); part = ''; }
    part += `${line}\n`;
  }
  out.push(part);
  return out;
}

async function load(path: string): Promise<Record<string, Uint8Array>> {
  if ((await stat(path)).size > MAX_DOCX) throw new DocxError('prevelika datoteka');
  return unpack(new Uint8Array(await readFile(path)));
}

export async function checkDocx(path: string): Promise<void> { await load(path); }

export async function readDocx(path: string): Promise<string[]> {
  const files = await load(path);
  const names = Object.keys(files).filter((n) => n.startsWith('word/')).sort((a, b) => Number(b === 'word/document.xml') - Number(a === 'word/document.xml') || a.localeCompare(b));
  return sections(names.map((n) => xmlText(strFromU8(files[n]!))).join('\n'));
}
