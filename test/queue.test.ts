import { beforeEach, describe, expect, it, vi } from 'vitest';

const suggest = vi.hoisted(() => vi.fn());
vi.mock('../src/web/api.js', () => ({ api: { suggest } }));
import { Reader } from '../src/web/reader.js';

const wait = () => new Promise((r) => setTimeout(r, 5));
let running = 0;
let most = 0;

describe('branje več pogodb v ozadju', () => {
  beforeEach(() => {
    running = 0;
    most = 0;
    suggest.mockReset();
    suggest.mockImplementation(async ({ upload }: { upload: string }, signal: AbortSignal) => {
      most = Math.max(most, ++running);
      await wait();
      running--;
      if (signal.aborted) throw new DOMException('', 'AbortError');
      return upload;
    });
  });

  it('bere eno naenkrat, po vrsti in vsako samo enkrat', async () => {
    const r = new Reader();
    const all = ['a', 'b', 'c'].map((id) => r.read(id));
    expect(r.read('b')).toBe(all[1]);
    expect(await Promise.all(all)).toEqual(['a', 'b', 'c']);
    expect(await r.read('a')).toBe('a');
    expect(most).toBe(1);
    expect(suggest).toHaveBeenCalledTimes(3);
  });

  it('napaka pri eni ne ustavi ostalih, neuspelo je mogoče ponoviti', async () => {
    suggest.mockRejectedValueOnce(new Error('ni dosegljiv'));
    const r = new Reader();
    const first = r.read('a');
    const second = r.read('b');
    await expect(first).rejects.toThrow('ni dosegljiv');
    expect(await second).toBe('b');
    expect(await r.read('a')).toBe('a');
  });

  it('preskočenih ne bere', async () => {
    const r = new Reader();
    const first = r.read('a');
    const second = r.read('b');
    r.skip('b');
    const third = r.read('c');
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(await Promise.all([first, third])).toEqual(['a', 'c']);
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it('po zaprtju ne začne novih branj', async () => {
    const r = new Reader();
    const all = ['a', 'b', 'c'].map((id) => r.read(id).catch((e: Error) => e.name));
    await wait();
    r.stop();
    await Promise.all(all);
    expect(suggest.mock.calls.length).toBeLessThan(3);
    await expect(r.read('d')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
