import { z } from 'zod';

// Naložena datoteka, ki še ni del nobene pogodbe. pages je null, če datoteke ni mogoče odpreti.
export interface Upload { id: string; name: string; size: number; pages: number | null }

export const MAX_PARTS = 60;

export const splitInput = z.object({
  parts: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(1), name: z.string().trim().min(1).max(150) })
    .refine((p) => p.to >= p.from)).min(1).max(MAX_PARTS),
});
export type SplitPart = z.infer<typeof splitInput>['parts'][number];

// Predlog razdelitve: kje se začne dokument in ali je pogodba ali priloga k prejšnji pogodbi.
export interface OutlinePart { page: number; kind: 'contract' | 'annex'; title: string | null }
export interface Outline { parts: OutlinePart[]; pagesRead: number; pagesTotal: number }
