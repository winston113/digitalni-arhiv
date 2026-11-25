import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, parseDate, pluralDays } from '../src/shared/dates.js';
import { EN, tr, translate } from '../src/shared/i18n.js';

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && e.name !== 'i18n.ts' ? [join(dir, e.name)] : []);
const source = (dirs: string[]) => dirs.flatMap(files).map((f) => readFileSync(f, 'utf8')).join('\n');
const holes = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();

describe('prevodi', () => {
  it('ohranijo vsa vstavljena mesta', () => {
    for (const [sl, en] of Object.entries(EN)) expect(holes(en), sl).toEqual(holes(sl));
  });

  it('vsa sporočila strežnika so prevedena', () => {
    const text = source(['src/shared', 'src/server']);
    const messages = [...text.matchAll(/(?:error|message|fields: \{ \w+|return)\s*:?\s*'([A-ZČŠŽ][^'\n]*[.])'/g)].map((m) => m[1]!)
      .concat([...text.matchAll(/(?:TOO_LARGE|NOT_PDF|NO_SPACE) = '([^']+)'/g)].map((m) => m[1]!))
      .concat([...text.matchAll(/(?:min|max|int|regex|refine|optionalText|wholeDays|isoDate)\([^\n]*?'([A-ZČŠŽ][^'\n]+\.)'/g)].map((m) => m[1]!));
    expect(messages.length).toBeGreaterThan(50);
    // Napake ob zagonu so namenjene skrbniku strežnika in niso del vmesnika.
    const startup = readFileSync('src/server/config.ts', 'utf8');
    for (const m of new Set(messages)) if (!startup.includes(m)) expect(Object.hasOwn(EN, m), m).toBe(true);
  });

  it('nima odvečnih vnosov', () => {
    const text = source(['src']).replace(/\\'/g, "'");
    const unused = Object.keys(EN).filter((k) => !text.includes(`'${k.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}'`));
    expect(unused).toEqual([]);
  });

  it('vstavi vrednosti dobesedno in ne dvakrat', () => {
    expect(translate('sl', '{title} poteče {end}.', { title: '{end} $& <b>', end: 'x' })).toBe('{end} $& <b> poteče x.');
    expect(tr('en', 'neznano besedilo')).toBe('neznano besedilo');
    expect(tr('en', 'constructor')).toBe('constructor');
  });

  it('oblikuje in prebere datume v obeh jezikih', () => {
    expect(formatDate('2027-01-05', 'en')).toBe('5 Jan 2027');
    expect(['5 Jan 2027', '05 january 2027', '5Jan2027', '31 Feb 2027', '5 Foo 2027'].map(parseDate)).toEqual(['2027-01-05', '2027-01-05', '2027-01-05', null, null]);
    for (let m = 1; m <= 12; m++) { const d = `2027-${String(m).padStart(2, '0')}-05`; expect(parseDate(formatDate(d, 'en'))).toBe(d); expect(parseDate(formatDate(d, 'sl'))).toBe(d); }
    for (const text of ['1. 6. 2027', '1.6.2027', '01.06.2027.', '1/6/2027', '01/06/2027', '1-6-2027', '1. 6. 27', '1/6/27', '1. junij 2027', '1. junija 2027', '1 june 2027', 'June 1, 2027', 'Jun 1st, 2027', '1st Jun 2027', '2027-06-01', '  1 . 6 . 2027 ']) expect(parseDate(text), text).toBe('2027-06-01');
    expect(['1. maj 2027', '1. avgusta 2027', '31. oktober 2099', '1. 1. 98'].map(parseDate)).toEqual(['2027-05-01', '2027-08-01', '2099-10-31', '1998-01-01']);
    for (const text of ['', '1', '1. 6.', '1. 6. 202', '1. 6. 20277', '31. 2. 2027', '1. 13. 2027', '6/13/2027', '2027-13-01', '1. foo 2027', 'constructor 1, 2027', '1 con 2027', '1. 6. 3027', 'x 1. 6. 2027']) expect(parseDate(text), text).toBeNull();
    expect([1, 2, 0].map((n) => pluralDays(n, 'en'))).toEqual(['1 day', '2 days', '0 days']);
  });
});
