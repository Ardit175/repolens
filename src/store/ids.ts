import { createHash } from 'node:crypto';
import type { Chunk } from '../chunker/types.js';

/** Deterministic UUID-shaped id (Qdrant accepts only UUIDs or unsigned integers). */
export function chunkId(chunk: Chunk): string {
  const hex = createHash('sha256')
    .update(`${chunk.path}:${chunk.startLine}:${chunk.hash}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
