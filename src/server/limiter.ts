import { availableParallelism, totalmem } from 'node:os';

// Poraba ene obdelave strani (Tesseract s slovenščino in angleščino) z rezervo.
const WORKER_MEMORY = 300 * 1024 ** 2;
const APP_MEMORY = 200 * 1024 ** 2;
const MAX_AUTO = 8;

// Privzeto število sočasnih obdelav: eno jedro ostane aplikaciji, upoštevana je omejitev pomnilnika vsebnika.
export function autoWorkers(cpus = availableParallelism(), memory = Math.min(process.constrainedMemory() || Infinity, totalmem())): number {
  return Math.max(1, Math.min(MAX_AUTO, cpus - 1, Math.floor((memory - APP_MEMORY) / WORKER_MEMORY)));
}

// Hkrati spusti naprej največ max opravil, ostala čakajo po vrsti.
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    }
  }
}

// Obdela elemente z največ max sočasnimi klici; ob napaki novih ne začne več in počaka na začete.
export async function eachLimited<T>(items: T[], max: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      try { await task(items[next++]!); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, lane));
  if (failure) throw (failure as { error: unknown }).error;
}
