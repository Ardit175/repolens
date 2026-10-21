import type { Language } from '../language.js';

export type EdgeKind = 'import' | 'call';

/**
 * One reference found in a source file. Targets are matched by name only: repolens does not
 * resolve types or modules, so `target` is the identifier as written at the reference site.
 */
export interface GraphEdge {
  /** POSIX-style path of the file that contains the reference. */
  path: string;
  language: Language;
  kind: EdgeKind;
  /**
   * Imports: the imported name (`readFile`, or `*` for a whole-module import).
   * Calls: the called function or method name, without the receiver (`foo` for `a.b.foo()`).
   */
  target: string;
  /** Imports only: the module specifier as written, for example `./util.js` or `os.path`. */
  module?: string;
  /** Calls only: name of the symbol that contains the call. Absent for top-level code. */
  from?: string;
  /** Calls only: name of the class or type that contains `from`, when there is one. */
  fromParent?: string;
  /** 1-based line of the reference. */
  line: number;
}

export interface EdgeQuery {
  kind?: EdgeKind;
  /** Exact match on `target`. */
  target?: string;
  /** Exact match on `from`. */
  from?: string;
  /** Exact POSIX path of the containing file. */
  path?: string;
  /** Maximum number of edges to return. Defaults to 1000. */
  limit?: number;
}

export interface GraphStore {
  /** Creates the backing collection if needed. */
  ensure(): Promise<void>;
  /** Replaces every edge of `path` with `edges` and records `hash` as the file's edge-set hash. */
  replaceFile(path: string, hash: string, edges: GraphEdge[]): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  /** Maps each path that has graph data to the edge-set hash stored by `replaceFile`. */
  listHashes(): Promise<Map<string, string>>;
  /** Looks edges up by exact field values, ordered by path then line. */
  findEdges(query: EdgeQuery): Promise<GraphEdge[]>;
}
