import { strToU8, zipSync } from 'fflate';

// Najmanjša veljavna preglednica: en list, glava, besedilo, števila in datumi.
export type Cell = string | number | { date: string } | { money: number } | null;

// V XML krmilni znaki niso dovoljeni.
const escape = (s: string) => s.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Število dni od 30. 12. 1899, kot datume shranjuje Excel.
const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

function cell(value: Cell, ref: string, header: boolean): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  // Besedilo je vedno zapisano kot besedilo, zato se vsebina, ki se začne z =, ne izvede kot formula.
  if (typeof value === 'string') return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
  if ('date' in value) return `<c r="${ref}" s="2"><v>${serial(value.date)}</v></c>`;
  return `<c r="${ref}" s="3"><v>${value.money}</v></c>`;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006';
const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

export function xlsx(sheet: string, header: string[], rows: Cell[][], widths: number[]): Uint8Array {
  const line = (cells: Cell[], r: number) => `<row r="${r}">${cells.map((v, i) => cell(v, `${column(i)}${r}`, r === 1)).join('')}</row>`;
  const last = `${column(header.length - 1)}${rows.length + 1}`;
  const files: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${TYPE}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${escape(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="d\\.\\ m\\.\\ yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${[header, ...rows].map((cells, i) => line(cells, i + 1)).join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(XML + xml)])));
}
