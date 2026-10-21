import type { Chunk } from '../chunker/types.js';
import type { GraphEdge } from '../graph/types.js';
import type { Runtime } from '../runtime.js';
import { searchIndex } from '../search.js';

/** Raised for a request that is valid but has no answer, for example an unknown symbol. */
export class ToolError extends Error {}

export const MAX_SEARCH_RESULTS = 20;
export const DEFAULT_SEARCH_RESULTS = 5;
export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 1000;
export const DEFAULT_REFERENCE_LIMIT = 50;
export const MAX_REFERENCE_LIMIT = 200;
export const DEFAULT_GRAPH_DEPTH = 2;
export const MAX_GRAPH_DEPTH = 5;
/** Most nodes shown on one level of a call graph; the rest are summarised as "... N more". */
export const MAX_GRAPH_LEVEL_NODES = 25;

const NAME_ONLY_NOTE =
  'Matching is by name only (not type-resolved), so unrelated symbols that share a name can appear.';

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

export interface FindReferencesInput {
  name: string;
  limit?: number | undefined;
}

function describeReference(edge: GraphEdge): string {
  if (edge.kind === 'import')
    return `${edge.path}:${edge.line}  import from "${edge.module ?? ''}"`;
  const parent = edge.fromParent === undefined ? '' : `${edge.fromParent}.`;
  const where = edge.from === undefined ? 'top level' : `${parent}${edge.from}`;
  return `${edge.path}:${edge.line}  call in ${where}`;
}

/** Every import of and call to `name` in the symbol graph, ordered by path then line. */
export async function findReferences(
  runtime: Runtime,
  input: FindReferencesInput,
): Promise<string> {
  const name = input.name.trim();
  if (name === '') throw new ToolError('Symbol name must not be empty');
  const limit = input.limit ?? DEFAULT_REFERENCE_LIMIT;
  const edges = await runtime.graph.findEdges({ target: name, limit: limit + 1 });
  if (edges.length === 0) return `No references to "${name}" found. ${NAME_ONLY_NOTE}`;
  const shown = edges.slice(0, limit);
  const lines = [
    `References to "${name}"${edges.length > limit ? ` (first ${limit})` : ` (${edges.length})`}`,
    ...shown.map(describeReference),
  ];
  if (edges.length > limit)
    lines.push(`... more; raise limit (max ${MAX_REFERENCE_LIMIT}) to see them`);
  lines.push(NAME_ONLY_NOTE);
  return lines.join('\n');
}

export interface CallGraphInput {
  name: string;
  direction?: 'callers' | 'callees' | undefined;
  depth?: number | undefined;
}

interface GraphNode {
  name: string;
  label: string;
  seen: boolean;
  children: GraphNode[];
  omitted: number;
}

/** The names one step away from `name`, each with the call site that links them. */
async function neighbours(
  runtime: Runtime,
  name: string,
  direction: 'callers' | 'callees',
  scope: Chunk[] | undefined,
): Promise<Map<string, GraphEdge>> {
  const found = new Map<string, GraphEdge>();
  if (direction === 'callers') {
    const edges = await runtime.graph.findEdges({ kind: 'call', target: name });
    for (const edge of edges) {
      if (edge.from !== undefined && !found.has(edge.from)) found.set(edge.from, edge);
    }
    return found;
  }
  const edges = await runtime.graph.findEdges({ kind: 'call', from: name });
  for (const edge of edges) {
    if (scope !== undefined && !scope.some((c) => sameScope(c, edge))) continue;
    if (!found.has(edge.target)) found.set(edge.target, edge);
  }
  return found;
}

function sameScope(chunk: Chunk, edge: GraphEdge): boolean {
  if (chunk.path !== edge.path) return false;
  return (
    chunk.parent === undefined || edge.fromParent === undefined || chunk.parent === edge.fromParent
  );
}

function renderTree(node: GraphNode, depth: number, out: string[]): void {
  out.push(`${'  '.repeat(depth)}${node.label}${node.seen ? ' (seen)' : ''}`);
  for (const child of node.children) renderTree(child, depth + 1, out);
  if (node.omitted > 0) out.push(`${'  '.repeat(depth + 1)}... ${node.omitted} more`);
}

/**
 * Breadth-first call graph around `name`, rendered as an indented tree. A name that already
 * appeared is marked "(seen)" and not expanded, which also stops cycles.
 */
export async function callGraph(runtime: Runtime, input: CallGraphInput): Promise<string> {
  const name = input.name.trim();
  if (name === '') throw new ToolError('Symbol name must not be empty');
  const direction = input.direction ?? 'callers';
  const maxDepth = input.depth ?? DEFAULT_GRAPH_DEPTH;
  let scope: Chunk[] | undefined;
  if (direction === 'callees') {
    scope = await runtime.store.findChunks({ name });
    if (scope.length === 0) {
      throw new ToolError(`Symbol "${name}" not found. Try search_code to find the right name.`);
    }
  }
  const root: GraphNode = { name, label: name, seen: false, children: [], omitted: 0 };
  const visited = new Set([name]);
  let level: GraphNode[] = [root];
  for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
    const next: GraphNode[] = [];
    let added = 0;
    for (const parent of level) {
      const found = await neighbours(
        runtime,
        parent.name,
        direction,
        depth === 1 ? scope : undefined,
      );
      for (const [label, edge] of found) {
        if (added >= MAX_GRAPH_LEVEL_NODES) {
          parent.omitted++;
          continue;
        }
        added++;
        const seen = visited.has(label);
        const child: GraphNode = {
          name: label,
          label: `${label}  ${edge.path}:${edge.line}`,
          seen,
          children: [],
          omitted: 0,
        };
        parent.children.push(child);
        if (!seen) {
          visited.add(label);
          next.push(child);
        }
      }
    }
    level = next;
  }
  const out: string[] = [];
  renderTree(root, 0, out);
  if (root.children.length === 0 && root.omitted === 0) {
    out.push(`  (no ${direction} found)`);
    out.push(NAME_ONLY_NOTE);
  }
  return out.join('\n');
}
