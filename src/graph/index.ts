import { createHash } from 'node:crypto';
import type { Node } from 'web-tree-sitter';
import { parse, type Grammar } from '../chunker/parser.js';
import type { Language } from '../language.js';
import { extractCSharpEdges } from './csharp.js';
import { extractPythonEdges } from './python.js';
import { extractTypeScriptEdges } from './typescript.js';
import type { GraphEdge } from './types.js';

export type { EdgeKind, EdgeQuery, GraphEdge, GraphStore } from './types.js';

interface Adapter {
  grammar: Grammar;
  extract: (root: Node, path: string) => GraphEdge[];
}

const ADAPTERS: Partial<Record<Language, Adapter>> = {
  typescript: { grammar: 'typescript', extract: extractTypeScriptEdges },
  tsx: { grammar: 'tsx', extract: extractTypeScriptEdges },
  javascript: { grammar: 'javascript', extract: extractTypeScriptEdges },
  jsx: { grammar: 'javascript', extract: extractTypeScriptEdges },
  csharp: { grammar: 'c_sharp', extract: extractCSharpEdges },
  python: { grammar: 'python', extract: extractPythonEdges },
};

/** Extracts imports and calls from a source file. Unsupported languages have no edges. */
export async function extractGraph(
  path: string,
  language: Language | undefined,
  source: string,
): Promise<GraphEdge[]> {
  const adapter = language ? ADAPTERS[language] : undefined;
  if (!language || !adapter) return [];
  const tree = await parse(adapter.grammar, source);
  try {
    // The adapters share one grammar across several languages, so the caller's language wins.
    return adapter.extract(tree.rootNode, path).map((edge) => ({ ...edge, language }));
  } finally {
    tree.delete();
  }
}

/** Stable fingerprint of an edge set, used to skip unchanged files when syncing the graph. */
export function edgesHash(edges: GraphEdge[]): string {
  const stable = edges.map((e) => [
    e.path,
    e.language,
    e.kind,
    e.target,
    e.module ?? null,
    e.from ?? null,
    e.fromParent ?? null,
    e.line,
  ]);
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
