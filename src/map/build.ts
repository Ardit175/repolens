import type { GraphStore } from '../graph/types.js';
import { detectLanguage } from '../language.js';
import type { VectorStore } from '../store/types.js';
import { compare, loadFileLinks } from './links.js';
import type { MapData, MapLink, MapNode } from './types.js';

export { goModulePath } from './links.js';

export interface MapOptions {
  /** Keep only files whose POSIX path starts with this prefix. */
  pathPrefix?: string;
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
  const { indexed, idsByPath, imports, calls, resolved, unresolved } = await loadFileLinks(
    store,
    graph,
  );

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
  for (const { from, to } of resolved) {
    if (from.startsWith(prefix) && to.startsWith(prefix)) bump(weights, JSON.stringify([from, to]));
  }
  const unresolvedImports = unresolved.filter((edge) => edge.path.startsWith(prefix)).length;

  const links: MapLink[] = [...weights]
    .map(([key, weight]) => {
      const [from, to] = JSON.parse(key) as [string, string];
      return { from, to, weight };
    })
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));

  return { nodes, links, unresolvedImports };
}
