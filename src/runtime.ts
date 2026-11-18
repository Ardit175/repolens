import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings/index.js';
import { QdrantGraphStore } from './graph/store.js';
import type { GraphStore } from './graph/types.js';
import { graphCollection, qdrantConnection, resolveIndexName } from './indexes.js';
import { QdrantVectorStore, type VectorStore } from './store/index.js';
import type { WatchState } from './status.js';

export interface Runtime {
  /** The resolved index name. */
  index: string;
  store: VectorStore;
  graph: GraphStore;
  embeddings: EmbeddingProvider;
  /** Set while a watcher keeps this index fresh, so status reports can show it. */
  watch?: WatchState;
}

/**
 * Builds the Qdrant store and embedding provider from environment variables. The index name
 * (option, then REPOLENS_INDEX, then `repolens`) picks the chunk and graph collections.
 */
export function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: { index?: string } = {},
): Runtime {
  const index = resolveIndexName(options.index, env);
  const connection = qdrantConnection(env);
  const store = new QdrantVectorStore({ ...connection, collection: index });
  const graph = new QdrantGraphStore({ ...connection, collection: graphCollection(index) });
  return { index, store, graph, embeddings: createEmbeddingProvider(env) };
}
