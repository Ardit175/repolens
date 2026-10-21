import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings/index.js';
import { QdrantGraphStore } from './graph/store.js';
import type { GraphStore } from './graph/types.js';
import { QdrantVectorStore, type VectorStore } from './store/index.js';

export interface Runtime {
  store: VectorStore;
  graph: GraphStore;
  embeddings: EmbeddingProvider;
}

/** Builds the Qdrant store and embedding provider from environment variables. */
export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const url = env.QDRANT_URL;
  if (!url) {
    throw new Error(
      'QDRANT_URL is not set. Start Qdrant with `docker compose up -d qdrant` and set QDRANT_URL=http://localhost:6333 (see .env.example).',
    );
  }
  const auth = env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {};
  const store = new QdrantVectorStore({ url, ...auth });
  const graph = new QdrantGraphStore({ url, ...auth });
  return { store, graph, embeddings: createEmbeddingProvider(env) };
}
