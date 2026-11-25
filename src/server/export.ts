import { Zip, ZipPassThrough } from 'fflate';
import { createReadStream } from 'node:fs';
import { STATUS_LABELS, sortByDeadline, toView, VALUE_PERIOD_LABELS, type Attachment, type ContractView } from '../shared/contracts.js';
import { today } from '../shared/dates.js';
import { translate, type Key, type Lang } from '../shared/i18n.js';
import type { ContractStore } from './contracts.js';
import { xlsx, type Cell } from './xlsx.js';

// Zapis ZIP brez razširitve podpira do 4 GB; meja pušča prostor za imena datotek.
export const MAX_EXPORT = 3.5 * 1024 ** 3;

// Ime, ki je veljavno v vseh operacijskih sistemih in ne more zapustiti svoje mape.
export function safeName(name: string, max = 80): string {
  const clean = name.normalize('NFC').replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  return Array.from(clean).slice(0, max).join('').trim() || 'datoteka';
}

function unique(name: string, taken: Set<string>): string {
  const dot = name.toLowerCase().endsWith('.pdf') ? name.length - 4 : name.length;
  let result = name;
  for (let n = 2; taken.has(result.toLowerCase()); n++) result = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  taken.add(result.toLowerCase());
  return result;
}

const pdfName = (name: string) => `${safeName(name.replace(/\.pdf$/i, ''))}.pdf`;

interface Entry { path: string; file: string }

export function planExport(store: ContractStore, userId: string, lang: Lang): { sheet: Uint8Array; entries: Entry[]; size: number } {
  const t = (key: Key) => translate(lang, key);
  const contracts = store.list(userId).map((c) => toView(c, today())).sort(sortByDeadline);
  const attachments = store.allAttachments(userId);
  const entries: Entry[] = [];
  let size = 0;

  const rows = contracts.map((c: ContractView, i): Cell[] => {
    const folder = `${t('dokumenti')}/${String(i + 1).padStart(3, '0')} ${safeName(c.title, 60)}`;
    const taken = new Set<string>();
    const own: Attachment[] = attachments.get(c.id) ?? [];
    entries.push({ path: `${folder}/${unique(pdfName(c.fileName), taken)}`, file: store.mainPath(userId, c.id)! });
    size += c.fileSize;
    for (const a of own) {
      entries.push({ path: `${folder}/${t('priloge')}/${unique(pdfName(a.name), taken)}`, file: store.attachmentPath(userId, c.id, a.id)! });
      size += a.size;
    }
    const date = (iso: string | null): Cell => (iso ? { date: iso } : null);
    return [
      c.title, c.party, t(c.category), c.number, t(STATUS_LABELS[c.status]), date(c.startDate),
      c.endDate ? { date: c.endDate } : t('Nedoločen čas'), date(c.actionDate), c.noticeDays, c.warnDays,
      c.valueCents === null ? null : { money: c.valueCents / 100 }, c.valueCents === null ? null : t(VALUE_PERIOD_LABELS[c.valuePeriod]),
      c.terminatedAt ? { date: today(new Date(c.terminatedAt)) } : null, own.length, c.notes, folder,
    ];
  });
  const header: Key[] = ['Naziv', 'Pogodbena stranka', 'Kategorija', 'Številka pogodbe', 'Status', 'Datum začetka', 'Datum poteka', 'Rok za ukrepanje', 'Odpovedni rok (dni)', 'Opozorilo (dni)', 'Vrednost v evrih', 'Plačilo', 'Datum prekinitve', 'Število prilog', 'Opombe', 'Mapa'];
  const widths = [38, 32, 22, 18, 16, 14, 14, 17, 18, 16, 17, 12, 17, 14, 40, 50];
  return { sheet: xlsx(t('Pogodbe'), header.map(t), rows, widths), entries, size };
}

// Datoteke se berejo ena za drugo in le tako hitro, kot jih prejemnik prevzema.
export function exportStream(sheetName: string, sheet: Uint8Array, entries: Entry[], onEnd: () => void): ReadableStream<Uint8Array> {
  let out: Uint8Array[] = [];
  let failure: Error | null = null;
  let next = 0;
  let sheetDone = false;
  let ended = false;
  const zip = new Zip((error, chunk) => { if (error) failure = error; else if (chunk.length) out.push(chunk); });
  const open = (name: string) => {
    const file = new ZipPassThrough(name);
    zip.add(file);
    return file;
  };
  // Trenutno odprta datoteka; bere se po kosih, da velika ni v celoti v pomnilniku.
  let current: { file: ZipPassThrough; chunks: AsyncIterator<Buffer>; close: () => void } | null = null;
  const finish = () => { if (!ended) { ended = true; onEnd(); } };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Korak brez izhoda ne sme ustaviti toka, zato nadaljuje do prvega.
        while (!out.length && !ended && !failure) {
        if (!sheetDone) { sheetDone = true; open(sheetName).push(sheet, true); }
        else if (current) {
          const { value, done } = await current.chunks.next();
          current.file.push(done ? new Uint8Array(0) : new Uint8Array(value), done);
          if (done) current = null;
        } else if (next < entries.length) {
          const e = entries[next++]!;
          const stream = createReadStream(e.file, { highWaterMark: 1024 * 1024 });
          current = { file: open(e.path), chunks: stream[Symbol.asyncIterator](), close: () => stream.destroy() };
        }
        else { zip.end(); finish(); }
        }
        if (failure) throw failure;
        const ready = out;
        out = [];
        for (const chunk of ready) controller.enqueue(chunk);
        if (ended) controller.close();
      } catch (error) {
        current?.close();
        finish();
        console.error('Izvoz ni uspel:', error instanceof Error ? error.message : error);
        controller.error(error);
      }
    },
    cancel() { current?.close(); zip.terminate(); finish(); },
  }, { highWaterMark: 1 });
}
