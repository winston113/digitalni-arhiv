import type { Mark } from '../shared/ai.js';

// Beseda z lego na strani; vse mere so deleži širine in višine strani.
// upright pove, da je beseda zapisana navpično, na primer na zavrteni strani.
export interface Word { text: string; x: number; y: number; w: number; h: number; upright?: boolean }

export const bare = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const MAX_WORDS = 20_000;
const MAX_MARKS = 12;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function word(text: string, x0: number, y0: number, x1: number, y1: number, width: number, height: number): Word | null {
  const [l, t, r, b] = [clamp(x0 / width), clamp(y0 / height), clamp(x1 / width), clamp(y1 / height)];
  return [l, t, r, b].every(Number.isFinite) && r > l && b > t ? { text, x: l, y: t, w: r - l, h: b - t, ...(text.length > 2 && y1 - y0 > x1 - x0 && { upright: true }) } : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!);

// Izpis pdftotext -bbox za eno stran. Pri zavrteni strani so lege besed zavrtene, velikost strani pa ne.
export function parseBbox(html: string, rotation = 0): Word[] {
  const page = /<page width="([\d.]+)" height="([\d.]+)"/.exec(html);
  if (!page) return [];
  const size = [Number(page[1]), Number(page[2])] as [number, number];
  const [width, height] = rotation % 180 === 0 ? size : [size[1], size[0]];
  const words: Word[] = [];
  for (const m of html.matchAll(/<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">([^<]*)<\/word>/g)) {
    const found = word(decode(m[5]!), Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), width, height);
    if (found && words.length < MAX_WORDS) words.push(found);
  }
  return words;
}

// Izpis tesseract tsv za eno stran.
export function parseTsv(tsv: string): Word[] {
  let width = 0;
  let height = 0;
  const words: Word[] = [];
  for (const line of tsv.split('\n')) {
    const [level, , , , , , left, top, w, h, , ...text] = line.split('\t');
    if (level === '1') { width = Number(w); height = Number(h); }
    if (level !== '5' || !width || !height || words.length >= MAX_WORDS) continue;
    const found = word(text.join(' ').trim(), Number(left), Number(top), Number(left) + Number(w), Number(top) + Number(h), width, height);
    if (found?.text) words.push(found);
  }
  return words;
}

// Združi besede v pravokotnike po vrsticah.
function lines(words: (Word & { page: number })[]): Mark[] {
  const out: Mark[] = [];
  const upright = words.filter((w) => w.upright).length * 2 > words.filter((w) => w.text.length > 2).length;
  const inside = (middle: number, start: number, size: number) => middle > start && middle < start + size;
  for (const w of words) {
    const last = out.at(-1);
    const sameLine = last && last.page === w.page
      && (upright ? inside(w.x + w.w / 2, last.x, last.w) : inside(w.y + w.h / 2, last.y, last.h));
    if (sameLine) {
      const right = Math.max(last.x + last.w, w.x + w.w);
      const bottom = Math.max(last.y + last.h, w.y + w.h);
      last.x = Math.min(last.x, w.x);
      last.y = Math.min(last.y, w.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else out.push({ page: w.page, x: w.x, y: w.y, w: w.w, h: w.h });
  }
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return out.slice(0, MAX_MARKS).map((m) => ({ page: m.page, x: round(m.x), y: round(m.y), w: round(m.w), h: round(m.h) }));
}

// Poišče navedek med besedami; navedek se lahko nadaljuje na naslednji strani. Prazno, če ga ni mogoče najti.
export function marksFor(quote: string, pages: { page: number; words: Word[] }[]): Mark[] {
  let text = '';
  const owner: (Word & { page: number })[] = [];
  for (const { page, words } of pages) for (const w of words) {
    const part = bare(w.text);
    text += part;
    for (let i = 0; i < part.length; i++) owner.push({ ...w, page });
  }
  const found: (Word & { page: number })[] = [];
  for (const part of quote.split(/\.{3}|…/).map(bare).filter(Boolean)) {
    const start = text.indexOf(part);
    if (start < 0) return [];
    found.push(...owner.slice(start, start + part.length));
  }
  // Ena beseda ima več črk, vsaka pa kaže na isto mesto.
  return lines(found.filter((w, i) => i === 0 || w.x !== found[i - 1]!.x || w.y !== found[i - 1]!.y || w.page !== found[i - 1]!.page));
}
