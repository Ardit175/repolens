import type { Node } from 'web-tree-sitter';
import { detectLanguage, type Language } from '../language.js';
import type { EdgeKind, GraphEdge } from './types.js';

/** The chunk-level symbol that contains a node. Both fields are absent for top-level code. */
export interface Scope {
  from?: string;
  fromParent?: string;
}

/** Gathers edges for one file, then deduplicates them and orders them by line. */
export class EdgeCollector {
  private readonly edges: GraphEdge[] = [];
  private readonly seen = new Set<string>();
  private readonly language: Language;

  /** `fallback` is used when the path's extension does not identify the language. */
  constructor(
    private readonly path: string,
    fallback: Language,
  ) {
    this.language = detectLanguage(path) ?? fallback;
  }

  addImport(target: string, module: string, at: Node): void {
    this.add('import', target, at, { module });
  }

  addCall(target: string, at: Node, scope: Scope): void {
    this.add('call', target, at, scope);
  }

  private add(
    kind: EdgeKind,
    target: string,
    at: Node,
    extra: Partial<Pick<GraphEdge, 'module' | 'from' | 'fromParent'>>,
  ): void {
    const edge: GraphEdge = {
      path: this.path,
      language: this.language,
      kind,
      target,
      ...(extra.module !== undefined && { module: extra.module }),
      ...(extra.from !== undefined && { from: extra.from }),
      ...(extra.fromParent !== undefined && { fromParent: extra.fromParent }),
      line: at.startPosition.row + 1,
    };
    const key = [kind, target, edge.from, edge.fromParent, edge.line, edge.module].join('\0');
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.edges.push(edge);
  }

  result(): GraphEdge[] {
    // Array.prototype.sort is stable, so edges on one line keep their source order.
    return [...this.edges].sort((a, b) => a.line - b.line);
  }
}
