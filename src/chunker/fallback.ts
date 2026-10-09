import path from 'node:path';
import type { Language } from '../language.js';
import { makeChunk } from './chunk.js';
import type { Chunk } from './types.js';

export const FALLBACK_WINDOW_LINES = 60;

/** Splits a file into fixed windows of lines. Used when no adapter can chunk it by symbol. */
export function fallbackChunks(
  filePath: string,
  language: Language | undefined,
  source: string,
  windowLines = FALLBACK_WINDOW_LINES,
): Chunk[] {
  if (source.trim() === '') return [];
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const name = path.posix.basename(filePath);
  const chunks: Chunk[] = [];
  for (let start = 0; start < lines.length; start += windowLines) {
    const end = Math.min(start + windowLines, lines.length) - 1;
    const content = lines.slice(start, end + 1).join('\n');
    if (content.trim() === '') continue;
    chunks.push(
      makeChunk({ filePath, language, name, kind: 'file', startRow: start, endRow: end, content }),
    );
  }
  return chunks;
}
