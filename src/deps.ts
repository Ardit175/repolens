import path from 'node:path';
import type { GraphEdge, GraphStore } from './graph/types.js';
import { compare, loadFileLinks, type FileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export type DependencyDirection = 'imports' | 'importers' | 'both';

export interface DependencyEntry {
  path: string;
  /** 1 for a direct link, 2 for a link through one other file, and so on. */
  depth: number;
  /** The file one level closer to the start file that links to this one. */
  via: string;
  /** Line of the first import (lowest line) that links the two files. */
  line: number;
  /** The module specifier as written in that import. */
  module: string;
}

export interface FileDependencies {
  path: string;
  /** Files this file imports, directly or through others. Empty when direction is `importers`. */
  imports: DependencyEntry[];
  /** Files that import this file, directly or through others. Empty when direction is `imports`. */
  importers: DependencyEntry[];
  /** This file's own imports that resolve to no indexed file. Empty when direction is `importers`. */
  unresolved: { module: string; line: number }[];
  /** True when any level hit MAX_DEPS_PER_LEVEL and files were left out. */
  truncated: boolean;
}

export const DEFAULT_DEPS_DEPTH = 1;
export const MAX_DEPS_DEPTH = 5;
export const MAX_DEPS_PER_LEVEL = 100;

const RESOLUTION_NOTE =
  'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked.';
const MAX_SUGGESTIONS = 3;

/** Raised when the requested file is not in the index. */
export class UnknownFileError extends Error {}

export interface FileDependenciesInput {
  path: string;
  direction?: DependencyDirection;
  depth?: number;
  /**
   * Most files listed per level. Defaults to MAX_DEPS_PER_LEVEL; `Infinity` lists every file.
   * Must be a positive integer or `Infinity`.
   */
  perLevelLimit?: number;
}

/** Trims, turns backslashes into `/` and drops a leading `./`. */
export function normalisePath(input: string): string {
  let result = input.trim().replaceAll('\\', '/');
  while (result.startsWith('./')) result = result.slice(2);
  return result;
}

function suggestionsFor(requested: string, indexed: ReadonlySet<string>): string[] {
  const name = path.posix.basename(requested);
  if (name === '') return [];
  return [...indexed]
    .filter((candidate) => path.posix.basename(candidate) === name)
    .sort(compare)
    .slice(0, MAX_SUGGESTIONS);
}

function unknownFile(requested: string, indexed: ReadonlySet<string>): UnknownFileError {
  const similar = suggestionsFor(requested, indexed);
  const hint =
    similar.length > 0
      ? `Did you mean ${similar.join(', ')}?`
      : 'Use list_files to see indexed paths.';
  return new UnknownFileError(`${requested} is not indexed. ${hint}`);
}

/** For each (from, to) pair, the import edge with the lowest line. */
export function firstEdges(links: FileLinks): Map<string, Map<string, GraphEdge>> {
  const byFrom = new Map<string, Map<string, GraphEdge>>();
  for (const { from, to, edge } of links.resolved) {
    const targets = byFrom.get(from) ?? new Map<string, GraphEdge>();
    const known = targets.get(to);
    if (known === undefined || edge.line < known.line) targets.set(to, edge);
    byFrom.set(from, targets);
  }
  return byFrom;
}

interface Walk {
  entries: DependencyEntry[];
  truncated: boolean;
}

/**
 * Breadth-first walk from `start`. `next` lists the files one step away and the edge that links
 * each of them to the file it was reached from. A file is listed once, at its smallest depth.
 */
function walk(
  start: string,
  maxDepth: number,
  perLevelLimit: number,
  next: (file: string) => Map<string, GraphEdge>,
  edgeOf: (file: string, via: string) => GraphEdge,
): Walk {
  const seen = new Set([start]);
  const entries: DependencyEntry[] = [];
  let truncated = false;
  let level = [start];
  for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
    const found = new Map<string, string>();
    for (const via of level) {
      for (const file of next(via).keys()) {
        if (!seen.has(file) && !found.has(file)) found.set(file, via);
      }
    }
    let files = [...found.keys()].sort(compare);
    if (files.length > perLevelLimit) {
      files = files.slice(0, perLevelLimit);
      truncated = true;
    }
    for (const file of files) {
      seen.add(file);
      const via = found.get(file)!;
      const edge = edgeOf(file, via);
      entries.push({ path: file, depth, via, line: edge.line, module: edge.module ?? edge.target });
    }
    level = files;
  }
  return { entries, truncated };
}

/**
 * The files `path` imports and the files that import it, up to `depth` levels in each direction.
 * Links come from the same path-based import resolution as the map. Pass `links` to reuse links
 * that were already loaded.
 */
export async function getFileDependencies(
  store: VectorStore,
  graph: GraphStore,
  input: FileDependenciesInput,
  links?: FileLinks,
): Promise<FileDependencies> {
  const direction = input.direction ?? 'both';
  const depth = input.depth ?? DEFAULT_DEPS_DEPTH;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPS_DEPTH) {
    throw new RangeError(`depth must be an integer from 1 to ${MAX_DEPS_DEPTH}`);
  }
  const perLevelLimit = input.perLevelLimit ?? MAX_DEPS_PER_LEVEL;
  if (perLevelLimit !== Infinity && (!Number.isInteger(perLevelLimit) || perLevelLimit < 1)) {
    throw new RangeError('perLevelLimit must be a positive integer or Infinity');
  }
  const start = normalisePath(input.path);
  const fileLinks = links ?? (await loadFileLinks(store, graph));
  if (!fileLinks.indexed.has(start)) throw unknownFile(start, fileLinks.indexed);

  const forward = firstEdges(fileLinks);
  const backward = new Map<string, Map<string, GraphEdge>>();
  for (const [from, targets] of forward) {
    for (const [to, edge] of targets) {
      const sources = backward.get(to) ?? new Map<string, GraphEdge>();
      sources.set(from, edge);
      backward.set(to, sources);
    }
  }
  const none = new Map<string, GraphEdge>();

  const imports =
    direction === 'importers'
      ? { entries: [], truncated: false }
      : walk(
          start,
          depth,
          perLevelLimit,
          (file) => forward.get(file) ?? none,
          (file, via) => forward.get(via)!.get(file)!,
        );
  const importers =
    direction === 'imports'
      ? { entries: [], truncated: false }
      : walk(
          start,
          depth,
          perLevelLimit,
          (file) => backward.get(file) ?? none,
          (file, via) => forward.get(file)!.get(via)!,
        );
  const unresolved =
    direction === 'importers'
      ? []
      : fileLinks.unresolved
          .filter((edge) => edge.path === start)
          .sort((a, b) => a.line - b.line)
          .map((edge) => ({ module: edge.module ?? edge.target, line: edge.line }));

  return {
    path: start,
    imports: imports.entries,
    importers: importers.entries,
    unresolved,
    truncated: imports.truncated || importers.truncated,
  };
}

function describeEntry(entry: DependencyEntry): string {
  const via = entry.depth > 1 ? `  (depth ${entry.depth} via ${entry.via})` : '';
  return `  ${entry.path}  line ${entry.line}  '${entry.module}'${via}`;
}

function section(title: string, entries: DependencyEntry[]): string[] {
  return [
    `${title} (${entries.length}):`,
    ...(entries.length === 0 ? ['  (none)'] : entries.map(describeEntry)),
  ];
}

/** Renders dependencies as text for the terminal and for MCP clients. */
export function formatFileDependencies(deps: FileDependencies): string {
  const lines = [
    deps.path,
    ...section('Imports', deps.imports),
    ...section('Imported by', deps.importers),
  ];
  const unresolved = deps.unresolved.map((u) => `${u.module} (line ${u.line})`).join(', ');
  lines.push(
    deps.unresolved.length === 0
      ? 'Unresolved imports: (none)'
      : `Unresolved imports (${deps.unresolved.length}): ${unresolved}`,
  );
  if (deps.truncated) {
    lines.push(`... truncated: each level shows at most ${MAX_DEPS_PER_LEVEL} files`);
  }
  lines.push(RESOLUTION_NOTE);
  return lines.join('\n');
}
