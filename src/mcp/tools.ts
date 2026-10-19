import type { Chunk } from '../chunker/types.js';
import type { Runtime } from '../runtime.js';
import { searchIndex } from '../search.js';

/** Raised for a request that is valid but has no answer, for example an unknown symbol. */
export class ToolError extends Error {}

export const MAX_SEARCH_RESULTS = 20;
export const DEFAULT_SEARCH_RESULTS = 5;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 1000;

function qualifiedName(chunk: Chunk): string {
  return chunk.parent ? `${chunk.parent}.${chunk.name}` : chunk.name;
}

function location(chunk: Chunk): string {
  return `${chunk.path}:${chunk.startLine}-${chunk.endLine}`;
}

function describeChunk(chunk: Chunk): string {
  return `${location(chunk)}  ${qualifiedName(chunk)} (${chunk.kind}, ${chunk.language})`;
}

function withCode(chunk: Chunk, heading: string): string {
  return `${heading}\n\`\`\`${chunk.language === 'unknown' ? '' : chunk.language}\n${chunk.content}\n\`\`\``;
}

export interface SearchCodeInput {
  query: string;
  limit?: number | undefined;
  path?: string | undefined;
  language?: string | undefined;
}

/** Semantic search: the closest chunks with their full code. */
export async function searchCode(runtime: Runtime, input: SearchCodeInput): Promise<string> {
  const filter = {
    ...(input.path === undefined ? {} : { pathPrefix: input.path }),
    ...(input.language === undefined ? {} : { language: input.language }),
  };
  const hits = await searchIndex({
    store: runtime.store,
    embeddings: runtime.embeddings,
    query: input.query,
    limit: input.limit ?? DEFAULT_SEARCH_RESULTS,
    filter,
  });
  if (hits.length === 0) return 'No results.';
  return hits
    .map(({ chunk, score }, i) =>
      withCode(chunk, `${i + 1}. ${describeChunk(chunk)}  score ${score.toFixed(3)}`),
    )
    .join('\n\n');
}

export interface GetSymbolInput {
  name: string;
  path?: string | undefined;
}

/**
 * Looks a symbol up by exact name. `Class.method` is accepted and matches on the parent too.
 * Every match is returned because names are not unique across files.
 */
export async function getSymbol(runtime: Runtime, input: GetSymbolInput): Promise<string> {
  const requested = input.name.trim();
  const dot = requested.lastIndexOf('.');
  const parent = dot > 0 ? requested.slice(0, dot) : undefined;
  const name = dot > 0 ? requested.slice(dot + 1) : requested;
  if (name === '') throw new ToolError('Symbol name must not be empty');
  const found = await runtime.store.findChunks({
    name,
    ...(input.path === undefined ? {} : { path: input.path }),
  });
  const matches = parent === undefined ? found : found.filter((c) => c.parent === parent);
  if (matches.length === 0) {
    throw new ToolError(
      `No symbol named "${requested}"${input.path === undefined ? '' : ` in ${input.path}`} is indexed. Try search_code for a fuzzy match.`,
    );
  }
  return matches.map((chunk) => withCode(chunk, describeChunk(chunk))).join('\n\n');
}

export interface ListFilesInput {
  path?: string | undefined;
  limit?: number | undefined;
}

/** Lists indexed files, optionally under a directory prefix, in alphabetical order. */
export async function listFiles(runtime: Runtime, input: ListFilesInput): Promise<string> {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT;
  const prefix = input.path ?? '';
  const paths = [...(await runtime.store.listIdsByPath()).keys()]
    .filter((p) => p.startsWith(prefix))
    .sort();
  if (paths.length === 0) {
    return prefix === '' ? 'The index is empty. Run `repolens index <path>` first.' : 'No files.';
  }
  const shown = paths.slice(0, limit);
  const lines = [`${paths.length} file${paths.length === 1 ? '' : 's'}`, ...shown];
  if (paths.length > shown.length) lines.push(`... ${paths.length - shown.length} more`);
  return lines.join('\n');
}

export interface FileContextInput {
  path: string;
}

/** An outline of one file followed by its chunks in line order. */
export async function fileContext(runtime: Runtime, input: FileContextInput): Promise<string> {
  const chunks = await runtime.store.findChunks({ path: input.path, limit: MAX_LIST_LIMIT });
  if (chunks.length === 0) {
    throw new ToolError(`${input.path} is not indexed. Use list_files to see indexed paths.`);
  }
  const outline = chunks.map(
    (c) => `- ${qualifiedName(c)} (${c.kind}) lines ${c.startLine}-${c.endLine}`,
  );
  const sections = chunks.map((c) => withCode(c, `${location(c)}  ${qualifiedName(c)}`));
  return [input.path, `Outline:\n${outline.join('\n')}`, ...sections].join('\n\n');
}
