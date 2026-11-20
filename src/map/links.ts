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

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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

export interface FileLinks {
  /** All indexed paths. */
  indexed: Set<string>;
  /** As returned by `store.listIdsByPath()`. */
  idsByPath: Map<string, string[]>;
  /** All import edges. */
  imports: GraphEdge[];
  /** All call edges (the map needs them for reference counts). */
  calls: GraphEdge[];
  /** Resolved file to file import edges: one entry per (edge, target) with target !== edge.path. */
  resolved: { from: string; to: string; edge: GraphEdge }[];
  /** Import edges whose path is indexed but resolved to nothing. */
  unresolved: GraphEdge[];
}

/**
 * Reads the index and the symbol graph and ties every import edge of an indexed file to the
 * indexed files it points at. Resolution is by path alone (see resolve.ts and resolve-modules.ts).
 */
export async function loadFileLinks(store: VectorStore, graph: GraphStore): Promise<FileLinks> {
  const idsByPath = await store.listIdsByPath();
  const indexed = new Set(idsByPath.keys());
  const imports = await graph.findEdges({ kind: 'import', limit: EDGE_LIMIT });
  const calls = await graph.findEdges({ kind: 'call', limit: EDGE_LIMIT });
  const context: ResolveContext = { indexed, goModules: await loadGoModules(store, indexed) };

  const resolved: FileLinks['resolved'] = [];
  const unresolved: GraphEdge[] = [];
  for (const edge of imports) {
    if (!indexed.has(edge.path)) continue;
    const targets = resolveImport(edge, context);
    if (targets.length === 0) unresolved.push(edge);
    for (const target of targets) {
      if (target !== edge.path) resolved.push({ from: edge.path, to: target, edge });
    }
  }
  return { indexed, idsByPath, imports, calls, resolved, unresolved };
}
