import type { Language } from '../language.js';

/** One indexed file, drawn as a node on the map. */
export interface MapNode {
  /** POSIX path, unique. */
  id: string;
  language: Language | undefined;
  /** Number of chunks indexed for the file. */
  chunks: number;
  /** Number of edges (imports plus calls) the graph store holds for the file. */
  references: number;
}

/** A file importing from another indexed file. */
export interface MapLink {
  from: string;
  to: string;
  /** Number of import statements from `from` that resolved to `to`. */
  weight: number;
}

export interface MapData {
  nodes: MapNode[];
  links: MapLink[];
  /** Import edges whose module could not be tied to an indexed file (packages, C# namespaces, ...). */
  unresolvedImports: number;
}
