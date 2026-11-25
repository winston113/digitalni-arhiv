import { strToU8, unzipSync, zipSync } from 'fflate';
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkDocx, readDocx, xmlText } from '../src/server/docx.js';
import { createExtract } from '../src/server/extract.js';
import type { ContractDetails } from '../src/shared/contracts.js';
import type { SearchResult } from '../src/shared/search.js';
import type { Upload } from '../src/shared/uploads.js';
import { input, setup } from './helpers.js';

const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docx = (body: string, extra: Record<string, Uint8Array> = {}, main = MAIN) => zipSync({
  '[Content_Types].xml': strToU8(`<Types><Override PartName="/word/document.xml" ContentType="${main}"/></Types>`),
  'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`), ...extra,
});
const save = (bytes: Uint8Array) => { const path = join(tmpdir(), `${crypto.randomUUID()}.docx`); writeFileSync(path, bytes); return path; };
const read = async (bytes: Uint8Array) => (await readDocx(save(bytes))).join('|').trim();

describe('besedilo DOCX', () => {
  it('prebere odstavke, tabele, posebne znake, glave in opombe', async () => {
    const text = await read(docx(`${p('Pogodba št. 1 &amp; aneks')}<w:p><w:r><w:t>Znesek</w:t><w:tab/><w:t>480,00&#160;€</w:t></w:r></w:p><w:tbl><w:tr><w:tc>${p('A')}</w:tc><w:tc>${p('B')}</w:tc></w:tr></w:tbl>`,
      { 'word/header1.xml': strToU8(`<w:hdr>${p('Glava')}</w:hdr>`), 'word/footnotes.xml': strToU8(`<w:footnotes>${p('Opomba')}</w:footnotes>`), 'word/media/x.png': new Uint8Array(10) }));
    expect(text.replace(/\s+/g, ' ')).toBe('Pogodba št. 1 & aneks Znesek 480,00 € A B Opomba Glava');
  });

  it('razdeljene besede združi, skrite dele izpusti', () => {
    expect(xmlText('<w:p><w:r><w:t>odpo</w:t></w:r><w:r><w:t>vedni rok</w:t></w:r></w:p>')).toBe('odpovedni rok\n');
    expect(xmlText('<w:p><w:del><w:r><w:delText>staro</w:delText><w:t>skrito</w:t></w:r></w:del><w:ins><w:r><w:t>novo</w:t></w:r></w:ins></w:p>')).toBe('novo\n');
    expect(xmlText('<w:p><w:r><w:instrText>PAGE</w:instrText><w:t>x</w:t></w:r><mc:AlternateContent><mc:Choice><w:t>a</w:t></mc:Choice><mc:Fallback><w:t>a</w:t></mc:Fallback></mc:AlternateContent></w:p>')).toBe('xa\n');
    expect(xmlText('<w:p/><w:t/>zunaj<w:t>&lt;b&gt; &#x17E; &#0; &neznano;</w:t>')).toBe('\n<b> ž &#0; &neznano;');
    expect(xmlText('<w:moveFrom><w:t>a</w:t></w:moveFrom><w:moveTo><w:t>b</w:t></w:moveTo>')).toBe('b');
  });

  it('dolgo besedilo razdeli na dele in nič ne izgubi', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `Odstavek ${i} z nekaj besedila`);
    const parts = await readDocx(save(docx(lines.map(p).join(''))));
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((x) => x.length < 3100)).toBe(true);
    expect(parts.join('').trim().split('\n')).toEqual(lines);
    const { pages, method } = await createExtract({ ocr: false, languages: 'slv', workers: 1 })(save(docx(lines.map(p).join(''))));
    expect(method).toBe('text');
    expect(pages).toHaveLength(parts.length);
    expect((await createExtract({ ocr: false, languages: 'slv', workers: 1 })(save(docx('<w:p/>')))).method).toBe('empty');
  });

  it('zavrne napačne, pokvarjene in prevelike datoteke', async () => {
    const bomb = zipSync({ '[Content_Types].xml': strToU8(MAIN), 'word/document.xml': new Uint8Array(21 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(100_000);
    for (const bytes of [strToU8('PK\u0003\u0004 ni arhiv'), zipSync({ 'a.txt': strToU8('x') }), docx(p('x'), {}, 'application/vnd.ms-word.document.macroEnabled.main+xml'), docx(p('x')).subarray(0, 200), bomb,
      zipSync({ ...unzipSync(docx(p('x'))), ...Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`x/${i}`, new Uint8Array(0)])) })]) {
      await expect(checkDocx(save(bytes))).rejects.toThrow();
    }
    await expect(checkDocx(save(docx(p('x'))))).resolves.toBeUndefined();
  });

  it('zlonamerno dolg XML ne upočasni branja', () => {
    const start = performance.now();
    xmlText('<w:t '.repeat(200_000));
    xmlText(`<w:del>${'<w:p>'.repeat(200_000)}`);
    xmlText(`<w:t>${'&'.repeat(500_000)}</w:t>`);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe('DOCX v arhivu', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let ana: string;
  const raw = (bytes: Uint8Array, name: string) => t.request('/api/uploads', { method: 'POST', body: bytes as BodyInit, cookie: ana, headers: { 'x-file-name': encodeURIComponent(name) } });
  const files = () => readdirSync(join(t.dataDir, 'files'));
  beforeEach(async () => { t = await setup(); ana = await t.register('ana@primer.si'); });

  it('shrani, prenese, zamenja in izbriše', async () => {
    const bytes = docx(p('Pogodba o žaluzijah'));
    const up = (await (await raw(bytes, 'pogodba.docx')).json()) as Upload;
    expect(up).toMatchObject({ name: 'pogodba.docx', pages: null });
    const c = (await (await t.json('/api/contracts', { data: input, upload: up.id }, { cookie: ana })).json()) as ContractDetails;
    expect(files()).toEqual([`${up.id}.docx`]);
    const r = await t.request(`/api/contracts/${c.id}/file`, { cookie: ana });
    expect(r.headers.get('content-type')).toContain('wordprocessingml');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array(bytes));
    const pdf = (await (await raw(strToU8('%PDF-1.4\nx'), 'nova.pdf')).json()) as Upload;
    await t.json(`/api/contracts/${c.id}`, { data: input, upload: pdf.id }, { method: 'PUT', cookie: ana });
    expect(files()).toEqual([`${pdf.id}.pdf`]);
    const annex = (await (await raw(bytes, 'aneks.docx')).json()) as Upload;
    await t.json(`/api/contracts/${c.id}/attachments`, { upload: annex.id }, { cookie: ana });
    expect(files().sort()).toEqual([`${annex.id}.docx`, `${pdf.id}.pdf`].sort());
    const zip = Object.keys(unzipSync(new Uint8Array(await (await t.request('/api/export', { cookie: ana })).arrayBuffer())));
    expect(zip.filter((n) => /dokumenti/.test(n)).map((n) => n.split('/').at(-1)).sort()).toEqual(['aneks.docx', 'nova.pdf']);
    await t.request(`/api/contracts/${c.id}`, { method: 'DELETE', cookie: ana });
    expect(files()).toEqual([]);
  });

  it('vrsta je določena z vsebino, ime se ji prilagodi', async () => {
    expect(((await (await raw(docx(p('x')), 'prevara.pdf')).json()) as Upload).name).toBe('prevara.docx');
    expect(((await (await raw(docx(p('x')), 'brez')).json()) as Upload).name).toBe('brez.docx');
    expect(((await (await raw(strToU8('%PDF-1.4\nx'), 'a.docx')).json()) as Upload).name).toBe('a.pdf');
  });

  it('razumljivo zavrne drugo in ničesar ne pusti', async () => {
    const old = new Uint8Array(600); old.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1]);
    const error = async (b: Uint8Array) => { const r = await raw(b, 'a.docx'); return [r.status, ((await r.json()) as { error: string }).error]; };
    expect(await error(old)).toEqual([400, expect.stringContaining('Starejše')]);
    expect(await error(zipSync({ 'xl/workbook.xml': strToU8('x') }))).toEqual([400, expect.stringContaining('makre')]);
    expect(await error(strToU8('<html></html>'))).toEqual([400, expect.stringContaining('PDF ali DOCX')]);
    expect((await error(new Uint8Array([0x50, 0x4b, 3, 4, ...new Uint8Array(31 * 1024 * 1024)])))[0]).toBe(413);
    expect(files()).toEqual([]);
  });

  it('razdelitve ni', async () => {
    const up = (await (await raw(docx(p('x')), 'a.docx')).json()) as Upload;
    expect((await t.json(`/api/uploads/${up.id}/split`, { parts: [{ from: 1, to: 1, name: 'x' }] }, { cookie: ana })).status).toBe(422);
  });

  it('vsebino je mogoče iskati', async () => {
    t = await setup({}, createExtract({ ocr: false, languages: 'slv', workers: 1 }));
    ana = await t.register('ana@primer.si');
    const up = (await (await raw(docx(p('Čiščenje žaluzij vsak četrtek')), 'a.docx')).json()) as Upload;
    await t.json('/api/contracts', { data: input, upload: up.id }, { cookie: ana });
    await t.indexer.drain();
    const r = (await (await t.json('/api/search', { query: 'zaluzij', mode: 'keyword', caseSensitive: false }, { cookie: ana })).json()) as SearchResult;
    expect(r.hits[0]!.excerpts[0]).toMatchObject({ name: 'a.docx', page: 1 });
  });
});
