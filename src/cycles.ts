import { firstEdges, normalisePath } from './deps.js';
import type { GraphEdge, GraphStore } from './graph/types.js';
import { compare, loadFileLinks, type FileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export interface CycleStep {
  from: string;
  to: string;
  /** Line of the lowest-line import in `from` that resolves to `to`. */
  line: number;
  /** The module specifier as written in that import. */
  module: string;
}

export interface ImportCycle {
  /** Every file in the strongly connected component, sorted. */
  files: string[];
  /** One shortest import loop that starts and ends at `files[0]`. */
  loop: CycleStep[];
}

export interface ImportCycles {
  /** Ordered by size (largest first) then first file, cut to MAX_IMPORT_CYCLES. */
  cycles: ImportCycle[];
  /** Cycles counted before the cut, after the path filter. */
  total: number;
  /** Distinct files across all cycles counted before the cut. */
  filesInCycles: number;
  /** True when `total` is larger than `cycles.length`. */
  truncated: boolean;
}

export interface ImportCyclesInput {
  /** Keep a cycle when any of its files starts with this prefix. The graph covers the whole index. */
  pathPrefix?: string;
  /** Reuse links that were already loaded instead of reading the index again. */
  links?: FileLinks;
}

export const MAX_IMPORT_CYCLES = 50;

const CYCLES_NOTE =
  'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked, so cycles through them are not shown.';

type Adjacency = Map<string, string[]>;

/** The files each file imports, both sorted, so every walk below is deterministic. */
function buildAdjacency(edges: Map<string, Map<string, GraphEdge>>): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const [from, targets] of edges) adjacency.set(from, [...targets.keys()].sort(compare));
  return adjacency;
}

/** One stack frame of the iterative depth-first search: a file and the next neighbour to try. */
interface Frame {
  node: string;
  next: number;
}

/**
 * Strongly connected components with Tarjan's algorithm, written with an explicit stack so a
 * long import chain cannot overflow the call stack. Components of one file are dropped.
 */
function findComponents(adjacency: Adjacency): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const enter = (node: string, frames: Frame[]): void => {
    index.set(node, counter);
    lowlink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    frames.push({ node, next: 0 });
  };

  for (const start of [...adjacency.keys()].sort(compare)) {
    if (index.has(start)) continue;
    const frames: Frame[] = [];
    enter(start, frames);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next++]!;
        if (!index.has(neighbour)) {
          enter(neighbour, frames);
        } else if (onStack.has(neighbour)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, index.get(neighbour)!));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component.sort(compare));
      }
    }
  }
  return components;
}

/**
 * The shortest loop from `start` back to itself that stays inside `members`, found by a
 * breadth-first search. Neighbours are visited in sorted order, so the result is deterministic.
 */
function shortestLoop(
  start: string,
  members: ReadonlySet<string>,
  adjacency: Adjacency,
  edges: Map<string, Map<string, GraphEdge>>,
): CycleStep[] {
  const parent = new Map<string, string>();
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const file = queue[head]!;
    for (const neighbour of adjacency.get(file) ?? []) {
      if (!members.has(neighbour)) continue;
      if (neighbour === start) {
        const path = [file];
        while (path[0] !== start) path.unshift(parent.get(path[0]!)!);
        return [...path, start].slice(1).map((to, i) => {
          const from = path[i]!;
          const edge = edges.get(from)!.get(to)!;
          return { from, to, line: edge.line, module: edge.module ?? edge.target };
        });
      }
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      parent.set(neighbour, file);
      queue.push(neighbour);
    }
  }
  // A component of two or more files always contains a loop through every member.
  throw new Error(`no import loop found through ${start}`);
}

/**
 * The groups of files that import each other in a ring, directly or through others. Each group
 * is a strongly connected component of the file import graph with its shortest loop. Pass
 * `links` to reuse links that were already loaded.
 */
export async function getImportCycles(
  store: VectorStore,
  graph: GraphStore,
  input: ImportCyclesInput = {},
): Promise<ImportCycles> {
  const prefix = input.pathPrefix === undefined ? '' : normalisePath(input.pathPrefix);
  const links = input.links ?? (await loadFileLinks(store, graph));
  const edges = firstEdges(links);
  const adjacency = buildAdjacency(edges);

  const cycles: ImportCycle[] = findComponents(adjacency)
    .filter((files) => files.some((file) => file.startsWith(prefix)))
    .map((files) => {
      const members = new Set(files);
      return { files, loop: shortestLoop(files[0]!, members, adjacency, edges) };
    })
    .sort((a, b) => b.files.length - a.files.length || compare(a.files[0]!, b.files[0]!));

  const kept = cycles.slice(0, MAX_IMPORT_CYCLES);
  return {
    cycles: kept,
    total: cycles.length,
    filesInCycles: new Set(cycles.flatMap((cycle) => cycle.files)).size,
    truncated: cycles.length > kept.length,
  };
}

/** Renders import cycles as text for the terminal and for MCP clients. */
export function formatImportCycles(result: ImportCycles): string {
  const header =
    result.total === 0
      ? 'Import cycles (0):'
      : `Import cycles (${result.total}) covering ${result.filesInCycles} files:`;
  const lines = [header];
  if (result.cycles.length === 0) lines.push('  (none)');
  result.cycles.forEach((cycle, i) => {
    lines.push(`  ${i + 1}. ${cycle.files.length} files: ${cycle.files.join(', ')}`);
    for (const step of cycle.loop) {
      lines.push(`     ${step.from}:${step.line} imports ${step.module} -> ${step.to}`);
    }
  });
  if (result.truncated) {
    lines.push(`... truncated: showing ${result.cycles.length} of ${result.total}`);
  }
  lines.push(CYCLES_NOTE);
  return lines.join('\n');
}
