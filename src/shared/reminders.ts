import type { ContractView } from './contracts.js';

// Stopnje si sledijo po nujnosti; za vsako pogodbo in datum poteka se vsaka pošlje največ enkrat.
export const STAGES = ['kmalu', 'teden', 'potekla'] as const;
export type Stage = (typeof STAGES)[number];

export function stageOf(c: ContractView): Stage | null {
  if (c.status === 'potekla') return c.createdAt.slice(0, 10) > c.endDate! ? null : 'potekla';
  if (c.status !== 'kmalu') return null;
  return (c.daysLeft ?? 0) <= 7 ? 'teden' : 'kmalu';
}
