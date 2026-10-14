import type { Chunk } from '../chunker/types.js';

export interface StoredChunk {
  /** Deterministic id, see `chunkId`. */
  id: string;
  vector: number[];
  chunk: Chunk;
}

export interface SearchFilter {
  /** Only chunks whose POSIX path starts with this prefix. */
  pathPrefix?: string;
  language?: string;
}

export interface SearchHit {
  chunk: Chunk;
  /** Cosine similarity, higher is closer. */
  score: number;
}

export interface VectorStore {
  /** Creates the collection if needed. Throws if it exists with other dimensions. */
  ensureCollection(dimensions: number): Promise<void>;
  /** Inserts items, replacing any item with the same id. */
  upsert(items: StoredChunk[]): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  /** Maps each indexed path to the hashes of its chunks, for incremental re-index. */
  listHashesByPath(): Promise<Map<string, string[]>>;
  search(vector: number[], limit: number, filter?: SearchFilter): Promise<SearchHit[]>;
  count(): Promise<number>;
}
