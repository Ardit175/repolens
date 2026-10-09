import type { Node } from 'web-tree-sitter';
import type { Language } from '../language.js';
import { makeChunk } from './chunk.js';
import { fallbackChunks } from './fallback.js';
import { parse, type Grammar } from './parser.js';
import type { Chunk, RawSymbol } from './types.js';
import { extractTypeScriptSymbols } from './typescript.js';

export type { Chunk, SymbolKind } from './types.js';

interface Adapter {
  grammar: Grammar;
  extract: (root: Node) => RawSymbol[];
}

const ADAPTERS: Partial<Record<Language, Adapter>> = {
  typescript: { grammar: 'typescript', extract: extractTypeScriptSymbols },
  tsx: { grammar: 'tsx', extract: extractTypeScriptSymbols },
  javascript: { grammar: 'javascript', extract: extractTypeScriptSymbols },
  jsx: { grammar: 'javascript', extract: extractTypeScriptSymbols },
};

/**
 * Splits a source file into symbol-level chunks. Files in languages without an adapter,
 * and files where no symbol is found, fall back to fixed windows of lines.
 */
export async function chunkFile(
  filePath: string,
  language: Language | undefined,
  source: string,
): Promise<Chunk[]> {
  const adapter = language ? ADAPTERS[language] : undefined;
  if (!adapter) return fallbackChunks(filePath, language, source);

  const tree = await parse(adapter.grammar, source);
  try {
    const lines = source.split(/\r?\n/);
    const chunks = adapter.extract(tree.rootNode).map((symbol) =>
      makeChunk({
        filePath,
        language,
        name: symbol.name,
        kind: symbol.kind,
        parent: symbol.parent,
        startRow: symbol.startRow,
        endRow: symbol.endRow,
        content: lines.slice(symbol.startRow, symbol.endRow + 1).join('\n'),
      }),
    );
    return chunks.length > 0 ? chunks : fallbackChunks(filePath, language, source);
  } finally {
    tree.delete();
  }
}
