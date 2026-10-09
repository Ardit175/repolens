import { createHash } from 'node:crypto';
import type { Language } from '../language.js';
import type { Chunk, SymbolKind } from './types.js';

interface ChunkInput {
  filePath: string;
  language: Language | undefined;
  name: string;
  kind: SymbolKind;
  parent?: string | undefined;
  startRow: number;
  endRow: number;
  content: string;
}

export function makeChunk(input: ChunkInput): Chunk {
  const chunk: Chunk = {
    path: input.filePath,
    language: input.language ?? 'unknown',
    name: input.name,
    kind: input.kind,
    startLine: input.startRow + 1,
    endLine: input.endRow + 1,
    content: input.content,
    hash: createHash('sha256').update(input.content).digest('hex'),
  };
  if (input.parent !== undefined) chunk.parent = input.parent;
  return chunk;
}
