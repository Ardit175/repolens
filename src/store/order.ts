import type { Chunk } from '../chunker/types.js';

export const DEFAULT_FIND_LIMIT = 100;

/** Orders chunks by path, then start line, so results are stable across stores. */
export function sortChunks(chunks: Chunk[]): Chunk[] {
  return chunks.sort((a, b) =>
    a.path === b.path ? a.startLine - b.startLine : a.path < b.path ? -1 : 1,
  );
}
