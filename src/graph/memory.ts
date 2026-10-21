import { DEFAULT_EDGE_LIMIT, sortEdges } from './order.js';
import type { EdgeQuery, GraphEdge, GraphStore } from './types.js';

interface FileEntry {
  hash: string;
  edges: GraphEdge[];
}

export class InMemoryGraphStore implements GraphStore {
  private readonly files = new Map<string, FileEntry>();

  async ensure(): Promise<void> {}

  async replaceFile(path: string, hash: string, edges: GraphEdge[]): Promise<void> {
    this.files.set(path, { hash, edges: edges.map((edge) => ({ ...edge })) });
  }

  async deleteByPath(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listHashes(): Promise<Map<string, string>> {
    return new Map([...this.files].map(([path, entry]) => [path, entry.hash]));
  }

  async findEdges(query: EdgeQuery): Promise<GraphEdge[]> {
    const matches: GraphEdge[] = [];
    for (const { edges } of this.files.values()) {
      for (const edge of edges) {
        if (query.kind !== undefined && edge.kind !== query.kind) continue;
        if (query.target !== undefined && edge.target !== query.target) continue;
        if (query.from !== undefined && edge.from !== query.from) continue;
        if (query.path !== undefined && edge.path !== query.path) continue;
        matches.push({ ...edge });
      }
    }
    return sortEdges(matches).slice(0, query.limit ?? DEFAULT_EDGE_LIMIT);
  }
}
