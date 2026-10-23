import path from 'node:path';
import type { GraphEdge, GraphStore } from '../graph/types.js';
import { detectLanguage, type Language } from '../language.js';
import type { VectorStore } from '../store/types.js';
import type { MapData, MapLink, MapNode } from './types.js';

export interface MapOptions {
  /** Keep only files whose POSIX path starts with this prefix. */
  pathPrefix?: string;
}

/** Larger than any realistic edge count; the graph stores cap results at `limit`. */
const EDGE_LIMIT = 1_000_000;

const SCRIPT_LANGUAGES: ReadonlySet<Language | undefined> = new Set([
  'typescript',
  'tsx',
  'javascript',
  'jsx',
]);

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

/** Extensions that a TypeScript import may name as `.js` while the file on disk is `.ts`. */
const JS_TO_SOURCE: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.jsx': ['.tsx', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};

function firstIndexed(candidates: string[], indexed: ReadonlySet<string>): string | undefined {
  return candidates.find((candidate) => indexed.has(candidate));
}

/** Resolves a relative TS/JS specifier against the set of indexed paths. */
function resolveScript(
  from: string,
  specifier: string,
  indexed: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.join(path.posix.dirname(from), specifier);
  if (base === '..' || base.startsWith('../')) return undefined;
  const candidates = [base];
  const ext = path.posix.extname(base);
  if (Object.hasOwn(JS_TO_SOURCE, ext)) {
    const stem = base.slice(0, -ext.length);
    for (const replacement of JS_TO_SOURCE[ext] ?? []) candidates.push(stem + replacement);
  }
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(base + extension);
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return firstIndexed(candidates, indexed);
}

/** Candidate files for a Python module path such as `pkg/util`. */
function pythonFiles(modulePath: string): string[] {
  return [`${modulePath}.py`, `${modulePath}/__init__.py`];
}

/** Resolves `.mod` or `..pkg.mod` against the importing file's directory. */
function resolvePythonRelative(
  from: string,
  module: string,
  target: string,
  indexed: ReadonlySet<string>,
): string | undefined {
  const dots = module.length - module.replace(/^\.+/, '').length;
  const parts = module.slice(dots).split('.').filter(Boolean);
  let dir = path.posix.dirname(from);
  for (let i = 1; i < dots; i++) {
    if (dir === '.') return undefined;
    dir = path.posix.dirname(dir);
  }
  const modulePath = path.posix.join(dir, ...parts);
  // `from . import util` names a sibling module through the imported name.
  const submodule =
    parts.length === 0 && target !== '*' ? pythonFiles(`${modulePath}/${target}`) : [];
  const own = parts.length === 0 ? [`${modulePath}/__init__.py`] : pythonFiles(modulePath);
  return firstIndexed(
    [...submodule, ...own].map((p) => path.posix.normalize(p)),
    indexed,
  );
}

/** Resolves a dotted module; falls back to a path-suffix match that must be unique. */
function resolvePythonAbsolute(module: string, indexed: ReadonlySet<string>): string | undefined {
  const files = pythonFiles(module.split('.').join('/'));
  const exact = firstIndexed(files, indexed);
  if (exact !== undefined) return exact;
  const matches = [...indexed].filter((candidate) =>
    files.some((file) => candidate.endsWith(`/${file}`)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function resolvePython(
  from: string,
  edge: GraphEdge,
  indexed: ReadonlySet<string>,
): string | undefined {
  const module = edge.module ?? '';
  if (module.startsWith('.')) return resolvePythonRelative(from, module, edge.target, indexed);
  return resolvePythonAbsolute(module, indexed);
}

/** The indexed file an import edge points at, or undefined for packages and unknown modules. */
function resolveImport(edge: GraphEdge, indexed: ReadonlySet<string>): string | undefined {
  if (edge.module === undefined) return undefined;
  const language = detectLanguage(edge.path);
  if (language === 'python') return resolvePython(edge.path, edge, indexed);
  if (SCRIPT_LANGUAGES.has(language)) return resolveScript(edge.path, edge.module, indexed);
  return undefined;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Builds the file-level map of an index: one node per indexed file and one weighted link per
 * pair of files joined by import statements. Modules are tied to files by path alone, so
 * packages and C# namespaces count as unresolved. Output is sorted for stable rendering.
 */
export async function buildMapData(
  store: VectorStore,
  graph: GraphStore,
  options: MapOptions = {},
): Promise<MapData> {
  const prefix = options.pathPrefix ?? '';
  const idsByPath = await store.listIdsByPath();
  const indexed = new Set(idsByPath.keys());
  const imports = await graph.findEdges({ kind: 'import', limit: EDGE_LIMIT });
  const calls = await graph.findEdges({ kind: 'call', limit: EDGE_LIMIT });

  const references = new Map<string, number>();
  for (const edge of [...imports, ...calls]) bump(references, edge.path);

  const nodes: MapNode[] = [...indexed]
    .filter((id) => id.startsWith(prefix))
    .sort(compare)
    .map((id) => ({
      id,
      language: detectLanguage(id),
      chunks: idsByPath.get(id)?.length ?? 0,
      references: references.get(id) ?? 0,
    }));

  const weights = new Map<string, number>();
  let unresolvedImports = 0;
  for (const edge of imports) {
    if (!indexed.has(edge.path) || !edge.path.startsWith(prefix)) continue;
    const target = resolveImport(edge, indexed);
    if (target === undefined) {
      unresolvedImports++;
    } else if (target !== edge.path && target.startsWith(prefix)) {
      bump(weights, JSON.stringify([edge.path, target]));
    }
  }

  const links: MapLink[] = [...weights]
    .map(([key, weight]) => {
      const [from, to] = JSON.parse(key) as [string, string];
      return { from, to, weight };
    })
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));

  return { nodes, links, unresolvedImports };
}
