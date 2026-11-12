import type { GraphEdge } from '../graph/types.js';

/** What an import resolver may look at. Resolution is by path alone, with no disk access. */
export interface ResolveContext {
  /** POSIX paths of every indexed file. */
  indexed: ReadonlySet<string>;
  /**
   * Go modules declared by indexed `go.mod` files: module path (`example.com/app`) to the
   * directory that holds the `go.mod` (`''` for the repository root, otherwise `svc/api`).
   */
  goModules: ReadonlyMap<string, string>;
}

/** Returns the indexed files an import edge points at; an empty list means unresolved. */
export type ImportResolver = (edge: GraphEdge, context: ResolveContext) => string[];

/** The first candidate that is an indexed path. */
export function firstIndexed(
  candidates: readonly string[],
  indexed: ReadonlySet<string>,
): string | undefined {
  return candidates.find((candidate) => indexed.has(candidate));
}

/**
 * The single indexed path that equals one of `files` or ends with `/<file>`. Returns undefined
 * when nothing matches or when more than one path matches, so an ambiguous name is never guessed.
 */
export function uniqueSuffixMatch(
  files: readonly string[],
  indexed: ReadonlySet<string>,
): string | undefined {
  const exact = firstIndexed(files, indexed);
  if (exact !== undefined) return exact;
  const matches = [...indexed].filter((candidate) =>
    files.some((file) => candidate.endsWith(`/${file}`)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
