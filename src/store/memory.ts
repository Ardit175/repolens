import type { Chunk } from '../chunker/types.js';
import { DEFAULT_FIND_LIMIT, sortChunks } from './order.js';
import type { ChunkQuery, SearchFilter, SearchHit, StoredChunk, VectorStore } from './types.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryVectorStore implements VectorStore {
  private readonly items = new Map<string, StoredChunk>();
  private dimensions: number | undefined;

  async ensureCollection(dimensions: number): Promise<void> {
    if (this.dimensions !== undefined && this.dimensions !== dimensions) {
      throw new Error(
        `Collection has ${this.dimensions} dimensions, but ${dimensions} were requested`,
      );
    }
    this.dimensions = dimensions;
  }

  async upsert(items: StoredChunk[]): Promise<void> {
    for (const item of items) {
      this.checkDimensions(item.vector.length);
    }
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }

  async deleteByPath(path: string): Promise<void> {
    for (const [id, item] of this.items) {
      if (item.chunk.path === path) this.items.delete(id);
    }
  }

  async listIdsByPath(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const { id, chunk } of this.items.values()) {
      const ids = result.get(chunk.path);
      if (ids) ids.push(id);
      else result.set(chunk.path, [id]);
    }
    return result;
  }

  async search(vector: number[], limit: number, filter?: SearchFilter): Promise<SearchHit[]> {
    this.checkDimensions(vector.length);
    const hits: SearchHit[] = [];
    for (const item of this.items.values()) {
      const { chunk } = item;
      if (filter?.pathPrefix !== undefined && !chunk.path.startsWith(filter.pathPrefix)) continue;
      if (filter?.language !== undefined && chunk.language !== filter.language) continue;
      hits.push({ chunk, score: cosine(vector, item.vector) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit));
  }

  async findChunks(query: ChunkQuery): Promise<Chunk[]> {
    const matches: Chunk[] = [];
    for (const { chunk } of this.items.values()) {
      if (query.path !== undefined && chunk.path !== query.path) continue;
      if (query.name !== undefined && chunk.name !== query.name) continue;
      matches.push(chunk);
    }
    return sortChunks(matches).slice(0, query.limit ?? DEFAULT_FIND_LIMIT);
  }

  async count(): Promise<number> {
    return this.items.size;
  }

  private checkDimensions(actual: number): void {
    if (this.dimensions !== undefined && actual !== this.dimensions) {
      throw new Error(
        `Vector has ${actual} dimensions, but the collection expects ${this.dimensions}`,
      );
    }
  }
}
