import path from 'node:path';
import type { GraphEdge, GraphStore } from '../graph/types.js';
import { detectLanguage, type Language } from '../language.js';
import type { VectorStore } from '../store/types.js';
import { type ImportResolver, type ResolveContext } from './paths.js';
import { resolveGo, resolveJvm, resolveRust } from './resolve-modules.js';
import {
  resolveInclude,
  resolvePhp,
  resolvePython,
  resolveRuby,
  resolveScript,
} from './resolve.js';
import type { MapData, MapLink, MapNode } from './types.js';

export interface MapOptions {
  /** Keep only files whose POSIX path starts with this prefix. */
  pathPrefix?: string;
}

/** Larger than any realistic edge count; the graph stores cap results at `limit`. */
const EDGE_LIMIT = 1_000_000;

/** One resolver per language whose imports can be tied to files by path alone. */
const RESOLVERS: Partial<Record<Language, ImportResolver>> = {
  typescript: resolveScript,
  tsx: resolveScript,
  javascript: resolveScript,
  jsx: resolveScript,
  python: resolvePython,
  c: resolveInclude,
  cpp: resolveInclude,
  ruby: resolveRuby,
  php: resolvePhp,
  java: resolveJvm,
  kotlin: resolveJvm,
  scala: resolveJvm,
  go: resolveGo,
  rust: resolveRust,
};

/** The indexed files an import edge points at; empty for packages and unknown modules. */
function resolveImport(edge: GraphEdge, context: ResolveContext): string[] {
  const language = detectLanguage(edge.path);
  const resolver = language === undefined ? undefined : RESOLVERS[language];
  return resolver === undefined ? [] : resolver(edge, context);
}

/** The module path declared by a `go.mod` file (`module example.com/app`). */
export function goModulePath(source: string): string | undefined {
  const match = /^\s*module\s+"?([^\s"]+)"?/m.exec(source);
  return match?.[1];
}

/** Reads every indexed `go.mod` back from its chunks: module path to the file's directory. */
async function loadGoModules(
  store: VectorStore,
  indexed: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  for (const file of [...indexed].sort(compare)) {
    if (path.posix.basename(file) !== 'go.mod') continue;
    const chunks = await store.findChunks({ path: file });
    const source = chunks
      .sort((a, b) => a.startLine - b.startLine)
      .map((chunk) => chunk.content)
      .join('\n');
    const modulePath = goModulePath(source);
    const dir = path.posix.dirname(file);
    if (modulePath !== undefined) modules.set(modulePath, dir === '.' ? '' : dir);
  }
  return modules;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Builds the file-level map of an index: one node per indexed file and one weighted link per
 * pair of files joined by import statements. Modules are tied to files by path alone (see the
 * resolvers in resolve.ts and resolve-modules.ts), so packages, C# namespaces and Swift modules
 * count as unresolved. A Go import or a JVM wildcard links to every file of its package. Output is sorted for stable rendering.
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
  const context: ResolveContext = { indexed, goModules: await loadGoModules(store, indexed) };

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
    const targets = resolveImport(edge, context);
    if (targets.length === 0) unresolvedImports++;
    for (const target of targets) {
      if (target !== edge.path && target.startsWith(prefix)) {
        bump(weights, JSON.stringify([edge.path, target]));
      }
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
