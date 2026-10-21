import type { GraphEdge } from './types.js';

export const DEFAULT_EDGE_LIMIT = 1000;

/** Orders edges by path, then line, so results are stable across stores. */
export function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
}
