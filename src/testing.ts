import type { EmbeddingProvider } from './embeddings/index.js';

const DIMENSIONS = 64;

/**
 * Deterministic bag-of-words embedder for tests: each word hashes to one of 64 buckets,
 * so texts that share words have a higher cosine similarity. No network, no model download.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake';
  readonly dimensions = DIMENSIONS;
  calls = 0;
  textsEmbedded = 0;

  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    this.textsEmbedded += texts.length;
    return texts.map((text) => {
      const vector = new Array<number>(DIMENSIONS).fill(0);
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 0;
        for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
        vector[hash % DIMENSIONS]! += 1;
      }
      return vector;
    });
  }
}
