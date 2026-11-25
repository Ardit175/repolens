import { isTestFile } from './affected-tests.js';
import type { Chunk } from './chunker/types.js';
import { normalisePath } from './deps.js';
import type { GraphEdge, GraphStore } from './graph/types.js';
import { compare, loadFileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export interface UnusedSymbol {
  path: string;
  name: string;
  parent?: string;
  kind: 'function' | 'method';
  startLine: number;
  endLine: number;
}

export interface UnusedSymbols {
  /** Ordered by path then start line, cut to MAX_UNUSED_SYMBOLS. */
  symbols: UnusedSymbol[];
  /** Counted before the cut. */
  total: number;
  /** Function and method chunks considered, after the filters and the implicit-name exclusions. */
  checked: number;
  /** True when `total` is larger than `symbols.length`. */
  truncated: boolean;
}

export interface UnusedSymbolsInput {
  /** Only report symbols in files under this directory prefix. Usage is still counted everywhere. */
  pathPrefix?: string;
  /** Only report symbols of this language, e.g. `typescript`. */
  language?: string;
  /** Also report symbols in test files. Calls from test files count as uses either way. */
  includeTests?: boolean;
}

export const MAX_UNUSED_SYMBOLS = 200;

/** Larger than any realistic number of chunks in one file. */
const CHUNK_LIMIT = 10_000;

/**
 * Names that a framework, a runtime or the language calls without any call site in the code, so
 * "nothing calls it" says nothing about them: entry points, constructors, lifecycle hooks, the
 * methods behind built-in protocols (`__init__`, `toString`, Go's `String` and `Error`).
 * Python dunders and Go test, benchmark and example functions are matched by pattern instead.
 */
const IMPLICIT_NAMES: ReadonlySet<string> = new Set([
  'main',
  'constructor',
  'init',
  'deinit',
  '__init__',
  'toString',
  'equals',
  'hashCode',
  'String',
  'Error',
  'ServeHTTP',
  'setUp',
  'tearDown',
]);

const DUNDER = /^__.+__$/;
const GO_TEST_NAME = /^(?:Test|Benchmark|Example)(?:[A-Z]|$)/;

const UNUSED_NOTE =
  'Matched by name: a symbol called only through dynamic dispatch, reflection, callbacks passed by reference or from outside the index shows up here too, so check before deleting.';

function isImplicitName(name: string): boolean {
  return IMPLICIT_NAMES.has(name) || DUNDER.test(name) || GO_TEST_NAME.test(name);
}

function isCallable(chunk: Chunk): chunk is Chunk & { kind: 'function' | 'method' } {
  return chunk.kind === 'function' || chunk.kind === 'method';
}

/** True when the edge is a call made from inside the symbol itself, which is not a real use. */
function isSelfCall(edge: GraphEdge, chunk: Chunk): boolean {
  return edge.path === chunk.path && edge.from === chunk.name && edge.fromParent === chunk.parent;
}

/**
 * The functions and methods that no call edge and no named import in the index points at.
 * Matching is by name only, so a same-named symbol elsewhere counts as a use and dynamic calls
 * are invisible; the result lists candidates for dead code, not proven dead code.
 */
export async function getUnusedSymbols(
  store: VectorStore,
  graph: GraphStore,
  input: UnusedSymbolsInput = {},
): Promise<UnusedSymbols> {
  const prefix = input.pathPrefix === undefined ? '' : normalisePath(input.pathPrefix);
  const links = await loadFileLinks(store, graph);

  const callsByTarget = new Map<string, GraphEdge[]>();
  for (const edge of links.calls) {
    const edges = callsByTarget.get(edge.target);
    if (edges === undefined) callsByTarget.set(edge.target, [edge]);
    else edges.push(edge);
  }
  const importedNames = new Set(links.imports.map((edge) => edge.target));

  const unused: UnusedSymbol[] = [];
  let checked = 0;
  for (const path of [...links.indexed].sort(compare)) {
    if (!path.startsWith(prefix)) continue;
    if (input.includeTests !== true && isTestFile(path)) continue;
    const chunks = await store.findChunks({ path, limit: CHUNK_LIMIT });
    for (const chunk of chunks.sort((a, b) => a.startLine - b.startLine)) {
      if (!isCallable(chunk) || isImplicitName(chunk.name)) continue;
      if (input.language !== undefined && chunk.language !== input.language) continue;
      checked++;
      if (importedNames.has(chunk.name)) continue;
      const callers = callsByTarget.get(chunk.name) ?? [];
      if (callers.some((edge) => !isSelfCall(edge, chunk))) continue;
      unused.push({
        path,
        name: chunk.name,
        ...(chunk.parent === undefined ? {} : { parent: chunk.parent }),
        kind: chunk.kind,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
  }
  const symbols = unused.slice(0, MAX_UNUSED_SYMBOLS);
  return {
    symbols,
    total: unused.length,
    checked,
    truncated: unused.length > symbols.length,
  };
}

export function formatUnusedSymbols(result: UnusedSymbols): string {
  const lines = [
    `Unused symbols (${result.total}) of ${result.checked} functions and methods checked:`,
  ];
  if (result.symbols.length === 0) lines.push('  (none)');
  for (const s of result.symbols) {
    const name = s.parent === undefined ? s.name : `${s.parent}.${s.name}`;
    lines.push(`  ${s.path}:${s.startLine}-${s.endLine}  ${s.kind}  ${name}`);
  }
  if (result.truncated) {
    lines.push(`... truncated: showing ${result.symbols.length} of ${result.total}`);
  }
  lines.push(UNUSED_NOTE);
  return lines.join('\n');
}
