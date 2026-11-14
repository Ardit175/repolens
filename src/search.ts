import type { Chunk } from './chunker/types.js';
import type { EmbeddingProvider } from './embeddings/index.js';
import { chunkId } from './store/ids.js';
import type { SearchFilter, VectorStore } from './store/index.js';

/** `hybrid` puts exact symbol-name matches first; `semantic` is vector similarity only. */
export type SearchMode = 'hybrid' | 'semantic';

export interface SearchOptions {
  store: VectorStore;
  embeddings: EmbeddingProvider;
  query: string;
  limit: number;
  filter?: SearchFilter;
  /** Defaults to `hybrid`. */
  mode?: SearchMode;
}

export interface RankedHit {
  chunk: Chunk;
  /** Cosine similarity, or null when the chunk was found only by its name. */
  score: number | null;
  /** True when the chunk's symbol name matches an identifier in the query. */
  nameMatch: boolean;
}

/** Most identifiers taken from one query, to bound the number of name lookups. */
export const MAX_NAME_TOKENS = 5;
/** Most chunks fetched per identifier, since one name can occur in many files. */
export const NAME_MATCH_LIMIT = 20;

const IDENTIFIER = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function looksLikeCode(token: string): boolean {
  return /[_$.]/.test(token) || /[a-z][A-Z]/.test(token) || /[A-Za-z]\d/.test(token);
}

/**
 * Picks the words of a query that may be symbol names, such as `parseConfig`,
 * `load_settings` or `AuthService.login`. In a multi-word query only tokens that look
 * like code count, so plain words such as "database" are left to the vector search.
 * A query that is a single token is always treated as a possible name.
 */
export function extractIdentifiers(query: string): string[] {
  const tokens = query
    .split(/[^A-Za-z0-9_$.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token !== '');
  const identifiers = tokens.filter(
    (token) => IDENTIFIER.test(token) && (tokens.length === 1 || looksLikeCode(token)),
  );
  return [...new Set(identifiers)].slice(0, MAX_NAME_TOKENS);
}

function matchesFilter(chunk: Chunk, filter: SearchFilter | undefined): boolean {
  if (filter?.pathPrefix !== undefined && !chunk.path.startsWith(filter.pathPrefix)) return false;
  if (filter?.language !== undefined && chunk.language !== filter.language) return false;
  return true;
}

/** Finds chunks named by `identifier`; `Class.method` must also match the parent. */
async function findByName(
  store: VectorStore,
  identifier: string,
  filter: SearchFilter | undefined,
): Promise<Chunk[]> {
  const dot = identifier.lastIndexOf('.');
  const parent = dot === -1 ? undefined : identifier.slice(0, dot);
  const name = dot === -1 ? identifier : identifier.slice(dot + 1);
  const chunks = await store.findChunks({ name, limit: NAME_MATCH_LIMIT });
  return chunks.filter(
    (chunk) => (parent === undefined || chunk.parent === parent) && matchesFilter(chunk, filter),
  );
}

/**
 * Embeds the query and returns the closest chunks.
 *
 * In hybrid mode (the default), identifiers in the query are also looked up as exact
 * symbol names. The result order is: name matches that the vector search also found
 * (best score first), then name-only matches (path and line order, score null), then
 * the remaining vector hits. There are no duplicates and the list is cut to `limit`.
 */
export async function searchIndex(options: SearchOptions): Promise<RankedHit[]> {
  const query = options.query.trim();
  if (query === '') throw new Error('Search query must not be empty');
  const [vector] = await options.embeddings.embed([query]);
  if (vector === undefined) throw new Error('Embedding provider returned no vector for the query');
  const vectorHits = await options.store.search(vector, options.limit, options.filter);
  const semantic = vectorHits.map(({ chunk, score }): RankedHit => ({
    chunk,
    score,
    nameMatch: false,
  }));
  if ((options.mode ?? 'hybrid') === 'semantic') return semantic;

  const found = await Promise.all(
    extractIdentifiers(query).map((identifier) =>
      findByName(options.store, identifier, options.filter),
    ),
  );
  const named = new Map<string, Chunk>();
  for (const chunk of found.flat()) named.set(chunkId(chunk), chunk);

  const both: RankedHit[] = [];
  const rest: RankedHit[] = [];
  for (const hit of semantic) {
    const id = chunkId(hit.chunk);
    if (named.delete(id)) both.push({ ...hit, nameMatch: true });
    else rest.push(hit);
  }
  const nameOnly = [...named.values()].map((chunk): RankedHit => ({
    chunk,
    score: null,
    nameMatch: true,
  }));
  return [...both, ...nameOnly, ...rest].slice(0, options.limit);
}

/** Describes how a hit was found: `score 0.912`, `score 0.912, name match` or `name match`. */
export function describeMatch({ score, nameMatch }: RankedHit): string {
  const parts: string[] = [];
  if (score !== null) parts.push(`score ${score.toFixed(3)}`);
  if (nameMatch) parts.push('name match');
  return parts.join(', ');
}

const PREVIEW_LINES = 6;

/** Renders hits as a readable list: location, symbol, score and a short code preview. */
export function formatHits(hits: RankedHit[]): string {
  if (hits.length === 0) return 'No results.\n';
  const blocks = hits.map((hit, i) => {
    const { chunk } = hit;
    const symbol = chunk.parent ? `${chunk.parent}.${chunk.name}` : chunk.name;
    const header = `${i + 1}. ${chunk.path}:${chunk.startLine}-${chunk.endLine}  ${symbol} (${chunk.kind}, ${chunk.language})  ${describeMatch(hit)}`;
    const lines = chunk.content.split('\n');
    const preview = lines.slice(0, PREVIEW_LINES).map((line) => `   | ${line}`);
    if (lines.length > PREVIEW_LINES)
      preview.push(`   | ... (${lines.length - PREVIEW_LINES} more lines)`);
    return [header, ...preview].join('\n');
  });
  return blocks.join('\n\n') + '\n';
}
