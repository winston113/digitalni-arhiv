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
    expect([1, 2, 0].map((n) => pluralDays(n, 'en'))).toEqual(['1 day', '2 days', '0 days']);
  });
});
