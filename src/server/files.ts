import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileKind } from '../shared/files.js';

const named = (dataDir: string, id: string, kind: FileKind) => join(dataDir, 'files', `${id}.${kind}`);

export const newFilePath = named;

// Pot datoteke glede na to, v kateri obliki je shranjena.
export function filePath(dataDir: string, id: string): string {
  const docx = named(dataDir, id, 'docx');
  return existsSync(docx) ? docx : named(dataDir, id, 'pdf');
}

export async function removeFile(dataDir: string, id: string): Promise<void> {
  await Promise.all((['pdf', 'docx'] as const).map((kind) => rm(named(dataDir, id, kind), { force: true })));
}
