import type { SuggestResult } from '../shared/ai.js';
import { api } from './api.js';

// Bere pogodbe eno za drugo, vsako največ enkrat; naslednje se berejo, medtem ko uporabnik preverja prejšnje.
export class Reader {
  private results = new Map<string, Promise<SuggestResult>>();
  private skipped = new Set<string>();
  private last: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();

  read(id: string): Promise<SuggestResult> {
    const known = this.results.get(id);
    if (known) return known;
    const result = this.last.then(() => {
      if (this.abort.signal.aborted || this.skipped.has(id)) throw new DOMException('', 'AbortError');
      return api.suggest({ upload: id }, this.abort.signal);
    });
    this.results.set(id, result);
    // Neuspelo branje je mogoče ponoviti.
    this.last = result.catch(() => { this.results.delete(id); });
    return result;
  }

  skip(id: string): void { this.skipped.add(id); }
  stop(): void { this.abort.abort(); }
}
