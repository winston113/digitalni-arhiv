import { availableParallelism, totalmem } from 'node:os';

// Izmerjena poraba ene obdelave strani je približno 110 MB; z rezervo.
const WORKER_MEMORY = 180 * 1024 ** 2;
const APP_MEMORY = 200 * 1024 ** 2;
const MAX_AUTO = 8;

const availableMemory = () => Math.min(process.constrainedMemory() || Infinity, totalmem());

// Ali bi toliko sočasnih obdelav lahko porabilo ves pomnilnik vsebnika.
export const tooManyWorkers = (workers: number, memory = availableMemory()) => workers > 1 && APP_MEMORY + workers * WORKER_MEMORY > memory;

// Privzeto število sočasnih obdelav: eno jedro ostane aplikaciji, upoštevana je omejitev pomnilnika vsebnika.
export function autoWorkers(cpus = availableParallelism(), memory = availableMemory()): number {
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
