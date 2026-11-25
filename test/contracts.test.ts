import { describe, expect, it } from 'vitest';
import { actionDate, contractInput, fieldErrors, sortByDeadline, status, toView, type Contract } from '../src/shared/contracts.js';
import { addDays, daysBetween, isIsoDate, parseDate, pluralDays } from '../src/shared/dates.js';

const base = { startDate: '2026-01-01', endDate: '2027-03-31', noticeDays: 30, warnDays: 30, terminatedAt: null };
const full: Contract = {
  id: '1', title: 'A', party: 'B', category: 'Najem', number: null, valueCents: null,
  valuePeriod: 'enkratno', notes: null, fileName: 'a.pdf', fileSize: 1, createdAt: '', ...base,
};

describe('rok za ukrepanje in status', () => {
  it('ustreza primeru iz opisa procesa', () => {
    expect(actionDate(base)).toBe('2027-03-01');
    expect(status(base, '2027-01-29')).toBe('aktivna');
    expect(status(base, '2027-01-30')).toBe('kmalu');
  });
  it('na dan poteka še ni potekla', () => {
    expect(status(base, '2027-03-31')).toBe('kmalu');
    expect(status(base, '2027-04-01')).toBe('potekla');
  });
  it('nedoločen čas je vedno aktiven', () => expect(status({ ...base, endDate: null }, '2099-01-01')).toBe('aktivna'));
  it('pred začetkom še ni v veljavi, opozorilo in prekinitev pa imata prednost', () => {
    const future = { ...base, startDate: '2142-01-01', endDate: '2144-01-01' };
    expect(status(future, '2026-11-25')).toBe('prihodnja');
    expect(status(future, '2141-12-31')).toBe('prihodnja');
    expect(status(future, '2142-01-01')).toBe('aktivna');
    expect(status({ ...future, endDate: null }, '2026-11-25')).toBe('prihodnja');
    expect(status({ ...future, terminatedAt: 'x' }, '2026-11-25')).toBe('prekinjena');
    expect(status({ ...future, noticeDays: 3650 }, '2140-01-01')).toBe('kmalu');
    expect(toView({ ...full, ...future }, '2026-11-25')).toMatchObject({ actionDate: '2143-12-02', status: 'prihodnja' });
  });
  it('prekinitev ima prednost', () => expect(status({ ...base, terminatedAt: 'x' }, '2099-01-01')).toBe('prekinjena'));
  it('razvrsti po roku, brez roka in prekinjene na koncu', () => {
    const v = (id: string, o: Partial<Contract>) => toView({ ...full, id, ...o }, '2026-11-23');
    const ids = [v('p', { terminatedAt: 'x' }), v('n', { endDate: null }), v('k', { endDate: '2026-12-01' }), v('d', {})].sort(sortByDeadline).map((c) => c.id);
    expect(ids).toEqual(['k', 'd', 'n', 'p']);
  });
});

describe('datumi', () => {
  it('računa čez prestopno leto in premik ure', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-11-23', '2027-10-02')).toBe(313);
  });
  it('zavrne neobstoječe datume', () => {
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2027-13-01')).toBe(false);
    expect(isIsoDate('1. 1. 2027')).toBe(false);
  });
  it('prebere slovenski zapis datuma', () => {
    expect(['15. 1. 2027', '15.1.2027', '15.\u00a01.\u00a02027', '2027-01-15', '31. 2. 2027', '1/15/2027', ''].map(parseDate)).toEqual(['2027-01-15', '2027-01-15', '2027-01-15', '2027-01-15', null, null, null]);
  });
  it('sklanja dneve', () => {
    expect([1, 2, 3, 23, 101, 102, 0].map((n) => pluralDays(n))).toEqual(['1 dan', '2 dneva', '3 dni', '23 dni', '101 dan', '102 dneva', '0 dni']);
  });
});

describe('validacija', () => {
  const ok = { title: 'Najem', party: 'Javor', category: 'Najem', number: '', startDate: '2026-01-01', endDate: '2027-01-01', noticeDays: 0, warnDays: 30, valueCents: null, valuePeriod: 'enkratno', notes: null };
  it('sprejme veljaven vnos', () => expect(contractInput.parse(ok).number).toBeNull());
  it('zavrne potek pred začetkom', () => {
    const r = contractInput.safeParse({ ...ok, endDate: '2025-12-31' });
    expect(fieldErrors(r.error!).endDate).toBe('Datum poteka ne sme biti pred datumom začetka.');
  });
  it('vrne slovenska sporočila za vsa prazna polja', () => {
    const e = fieldErrors(contractInput.safeParse({ ...ok, title: ' ', party: '', startDate: '', endDate: '', category: 'X', noticeDays: NaN }).error!);
    expect(Object.keys(e).sort()).toEqual(['category', 'endDate', 'noticeDays', 'party', 'startDate', 'title']);
    expect(Object.values(e).join(' ')).not.toMatch(/Invalid|expected/i);
  });
});
