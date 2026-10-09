import type { Language } from '../language.js';

export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'file';

export interface Chunk {
  /** POSIX-style path relative to the indexed root. */
  path: string;
  language: Language | 'unknown';
  /** Symbol name, or the file name for fallback chunks. */
  name: string;
  kind: SymbolKind;
  /** Name of the enclosing symbol, for example the class of a method. */
  parent?: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  content: string;
  /** SHA-256 of `content`, used to skip unchanged chunks on re-index. */
  hash: string;
}

/** A symbol found by a language adapter, before it becomes a Chunk. */
export interface RawSymbol {
  name: string;
  kind: SymbolKind;
  parent?: string;
  /** 0-based row of the first line, including any leading comment. */
  startRow: number;
  /** 0-based row of the last line. */
  endRow: number;
}
