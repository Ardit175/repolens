import type { EmbeddingProvider } from './embeddings/index.js';
import type { SearchFilter, SearchHit, VectorStore } from './store/index.js';

export interface SearchOptions {
  store: VectorStore;
  embeddings: EmbeddingProvider;
  query: string;
  limit: number;
  filter?: SearchFilter;
}

/** Embeds the query and returns the closest chunks. */
export async function searchIndex(options: SearchOptions): Promise<SearchHit[]> {
  const query = options.query.trim();
  if (query === '') throw new Error('Search query must not be empty');
  const [vector] = await options.embeddings.embed([query]);
  if (vector === undefined) throw new Error('Embedding provider returned no vector for the query');
  return options.store.search(vector, options.limit, options.filter);
}

const PREVIEW_LINES = 6;

/** Renders hits as a readable list: location, symbol, score and a short code preview. */
export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No results.\n';
  const blocks = hits.map(({ chunk, score }, i) => {
    const symbol = chunk.parent ? `${chunk.parent}.${chunk.name}` : chunk.name;
    const header = `${i + 1}. ${chunk.path}:${chunk.startLine}-${chunk.endLine}  ${symbol} (${chunk.kind}, ${chunk.language})  score ${score.toFixed(3)}`;
    const lines = chunk.content.split('\n');
    const preview = lines.slice(0, PREVIEW_LINES).map((line) => `   | ${line}`);
    if (lines.length > PREVIEW_LINES)
      preview.push(`   | ... (${lines.length - PREVIEW_LINES} more lines)`);
    return [header, ...preview].join('\n');
  });
  return blocks.join('\n\n') + '\n';
}
