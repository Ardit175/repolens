import type { SymbolKind } from './chunker/types.js';
import { getFileDependencies } from './deps.js';
import type { GraphStore } from './graph/types.js';
import { compare, type FileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export type ImpactLink = 'direct' | 'transitive' | 'name-only';

export interface ImpactSymbol {
  name: string;
  parent?: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  /** Calls to this symbol's name from other files. */
  callSites: number;
}

export interface ImpactCallSite {
  /** Qualified name (`Class.method` or `name`) of the symbol that is called. */
  symbol: string;
  line: number;
  /** Name of the symbol that contains the call. Absent for top-level code. */
  from?: string;
  fromParent?: string;
}

export interface ImpactedFile {
  path: string;
  /**
   * `direct` and `transitive` files import the start file within the requested depth.
   * `name-only` files call a symbol of it by name without importing it.
   */
  link: ImpactLink;
  /** Importers only: 1 for a direct import, 2 for an import through one other file, and so on. */
  importDepth?: number;
  /** Importers only, and only beyond depth 1: the file one level closer to the start file. */
  via?: string;
  /** Calls to the start file's symbols found in this file, ordered by line. */
  calls: ImpactCallSite[];
}

export interface ChangeImpact {
  path: string;
  /** Set only when the request named a symbol. */
  symbol?: string;
  symbols: ImpactSymbol[];
  files: ImpactedFile[];
  /** Counted before `files` is cut to MAX_IMPACT_FILES. */
  counts: { direct: number; transitive: number; nameOnly: number; callSites: number };
  /** True when files or call sites were left out because of a limit. */
  truncated: boolean;
}

export interface ChangeImpactInput {
  path: string;
  symbol?: string;
  /** How many import levels to follow, from 1 to MAX_IMPACT_DEPTH. */
  depth?: number;
  /**
   * Skip the MAX_DEPS_PER_LEVEL and MAX_IMPACT_FILES cuts and return every affected file. Only the
   * MAX_CALL_EDGES limit can still set `truncated`. For callers that filter the list themselves.
   */
  unbounded?: boolean;
}

export const DEFAULT_IMPACT_DEPTH = 1;
export const MAX_IMPACT_DEPTH = 5;
export const MAX_IMPACT_FILES = 100;
/** Per symbol lookup. */
export const MAX_CALL_EDGES = 1000;

const SYMBOL_CHUNK_LIMIT = 1000;
const MAX_LISTED_SYMBOLS = 10;
const IMPACT_NOTE =
  'Links resolve by import path; name-only callers match by symbol name and may be unrelated.';

/** Raised when the requested symbol is not defined in the file. */
export class UnknownSymbolError extends Error {}

interface Definition extends Omit<ImpactSymbol, 'callSites'> {
  qualified: string;
}

function unknownSymbol(
  symbol: string,
  path: string,
  definitions: Definition[],
): UnknownSymbolError {
  const names = definitions.map((d) => d.qualified);
  const listed = names.slice(0, MAX_LISTED_SYMBOLS).join(', ');
  const more = names.length > MAX_LISTED_SYMBOLS ? ', ...' : '';
  const hint =
    names.length === 0 ? 'It has no symbol chunks.' : `Symbols in this file: ${listed}${more}`;
  return new UnknownSymbolError(`Symbol "${symbol}" is not defined in ${path}. ${hint}`);
}

/** The symbols of a file in source order; fallback `file` chunks are not symbols. */
async function loadDefinitions(store: VectorStore, path: string): Promise<Definition[]> {
  const chunks = await store.findChunks({ path, limit: SYMBOL_CHUNK_LIMIT });
  return chunks
    .filter((chunk) => chunk.kind !== 'file')
    .sort((a, b) => a.startLine - b.startLine)
    .map((chunk) => ({
      name: chunk.name,
      ...(chunk.parent !== undefined ? { parent: chunk.parent } : {}),
      kind: chunk.kind,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      qualified: chunk.parent !== undefined ? `${chunk.parent}.${chunk.name}` : chunk.name,
    }));
}

function linkOf(importDepth: number | undefined): ImpactLink {
  if (importDepth === undefined) return 'name-only';
  return importDepth === 1 ? 'direct' : 'transitive';
}

const LINK_ORDER: Record<ImpactLink, number> = { direct: 0, transitive: 1, 'name-only': 2 };

/**
 * What a change to `path` (or to one symbol in it) can reach: the files that import it, up to
 * `depth` levels, and the files that call its symbols by name. Call targets are names only, so
 * `name-only` callers may be unrelated functions that happen to share a name.
 */
export async function getChangeImpact(
  store: VectorStore,
  graph: GraphStore,
  input: ChangeImpactInput,
  links?: FileLinks,
): Promise<ChangeImpact> {
  const depth = input.depth ?? DEFAULT_IMPACT_DEPTH;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_IMPACT_DEPTH) {
    throw new RangeError(`depth must be an integer from 1 to ${MAX_IMPACT_DEPTH}`);
  }
  const deps = await getFileDependencies(
    store,
    graph,
    {
      path: input.path,
      direction: 'importers',
      depth,
      ...(input.unbounded === true ? { perLevelLimit: Infinity } : {}),
    },
    links,
  );
  const start = deps.path;

  const requested = input.symbol?.trim();
  const symbol = requested === '' ? undefined : requested;
  let definitions = await loadDefinitions(store, start);
  if (symbol !== undefined) {
    const all = definitions;
    definitions = all.filter((d) => d.name === symbol || d.qualified === symbol);
    if (definitions.length === 0) throw unknownSymbol(symbol, start, all);
  }

  let truncated = deps.truncated;
  const sitesByFile = new Map<string, ImpactCallSite[]>();
  const seen = new Set<string>();
  const symbols: ImpactSymbol[] = [];
  for (const definition of definitions) {
    const edges = await graph.findEdges({
      kind: 'call',
      target: definition.name,
      limit: MAX_CALL_EDGES,
    });
    if (edges.length >= MAX_CALL_EDGES) truncated = true;
    let callSites = 0;
    for (const edge of edges) {
      if (edge.path === start) continue;
      const key = `${edge.path}\n${edge.line}\n${definition.qualified}`;
      if (seen.has(key)) continue;
      seen.add(key);
      callSites++;
      const sites = sitesByFile.get(edge.path) ?? [];
      sites.push({
        symbol: definition.qualified,
        line: edge.line,
        ...(edge.from !== undefined ? { from: edge.from } : {}),
        ...(edge.fromParent !== undefined ? { fromParent: edge.fromParent } : {}),
      });
      sitesByFile.set(edge.path, sites);
    }
    symbols.push({
      name: definition.name,
      ...(definition.parent !== undefined ? { parent: definition.parent } : {}),
      kind: definition.kind,
      startLine: definition.startLine,
      endLine: definition.endLine,
      callSites,
    });
  }

  const importers = new Map(deps.importers.map((entry) => [entry.path, entry]));
  const paths = new Set([...importers.keys(), ...sitesByFile.keys()]);
  const all: ImpactedFile[] = [...paths].map((file) => {
    const importer = importers.get(file);
    const calls = (sitesByFile.get(file) ?? []).sort(
      (a, b) => a.line - b.line || compare(a.symbol, b.symbol),
    );
    return {
      path: file,
      link: linkOf(importer?.depth),
      ...(importer !== undefined ? { importDepth: importer.depth } : {}),
      ...(importer !== undefined && importer.depth > 1 ? { via: importer.via } : {}),
      calls,
    };
  });
  all.sort(
    (a, b) =>
      LINK_ORDER[a.link] - LINK_ORDER[b.link] ||
      b.calls.length - a.calls.length ||
      compare(a.path, b.path),
  );

  const counts = {
    direct: all.filter((f) => f.link === 'direct').length,
    transitive: all.filter((f) => f.link === 'transitive').length,
    nameOnly: all.filter((f) => f.link === 'name-only').length,
    callSites: symbols.reduce((total, s) => total + s.callSites, 0),
  };
  const cut = input.unbounded !== true && all.length > MAX_IMPACT_FILES;
  if (cut) truncated = true;

  return {
    path: start,
    ...(symbol !== undefined ? { symbol } : {}),
    symbols,
    files: cut ? all.slice(0, MAX_IMPACT_FILES) : all,
    counts,
    truncated,
  };
}

function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : many}`;
}

function describeSymbol(symbol: ImpactSymbol): string {
  const name = symbol.parent !== undefined ? `${symbol.parent}.${symbol.name}` : symbol.name;
  const lines = `lines ${symbol.startLine}-${symbol.endLine}`;
  return `  ${name} (${symbol.kind}) ${lines}  ${plural(symbol.callSites, 'call site')}`;
}

function describeLink(file: ImpactedFile): string {
  if (file.link === 'direct') return 'direct import';
  if (file.link === 'name-only') return 'name-only caller';
  return `transitive (depth ${file.importDepth} via ${file.via})`;
}

function describeCall(call: ImpactCallSite): string {
  const container =
    call.from === undefined
      ? 'top level'
      : call.fromParent !== undefined
        ? `${call.fromParent}.${call.from}`
        : call.from;
  return `    line ${call.line}  ${call.symbol}  in ${container}`;
}

/** Renders a change impact as text for the terminal and for MCP clients. */
export function formatChangeImpact(impact: ChangeImpact): string {
  const { counts } = impact;
  const total = counts.direct + counts.transitive + counts.nameOnly;
  const lines = [
    impact.symbol === undefined ? impact.path : `${impact.path}  (symbol: ${impact.symbol})`,
    `Symbols (${impact.symbols.length}):`,
    ...(impact.symbols.length === 0 ? ['  (none)'] : impact.symbols.map(describeSymbol)),
  ];
  if (total === 0) {
    lines.push('Affected files (0):', '  (none)');
  } else {
    const parts = [
      plural(counts.direct, 'direct importer'),
      `${counts.transitive} transitive`,
      plural(counts.nameOnly, 'name-only caller'),
    ];
    lines.push(
      `Affected files (${total}): ${parts.join(', ')}; ${plural(counts.callSites, 'call site')}`,
    );
    for (const file of impact.files) {
      lines.push(`  ${file.path}  ${describeLink(file)}`, ...file.calls.map(describeCall));
    }
  }
  if (impact.truncated) {
    lines.push(
      `... truncated: at most ${MAX_IMPACT_FILES} files and ${MAX_CALL_EDGES} calls per symbol are read`,
    );
  }
  lines.push(IMPACT_NOTE);
  return lines.join('\n');
}
