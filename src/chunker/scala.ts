import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const COMMENTS = ['comment', 'block_comment'];

/** Declarations that hold members: classes (case classes too), traits, objects, package objects. */
const TYPES = new Set([
  'class_definition',
  'trait_definition',
  'object_definition',
  'package_object',
]);

/** Member declarations that become method chunks. Abstract `def`s are function declarations. */
const FUNCTIONS = new Set(['function_definition', 'function_declaration']);

/**
 * A comment above a declaration is not always its previous sibling, so this maps the last row of
 * each comment to its first row, for every comment in the file.
 */
function commentRows(root: Node): Map<number, number> {
  const rows = new Map<number, number>();
  for (const comment of root.descendantsOfType(COMMENTS)) {
    if (comment) rows.set(comment.endPosition.row, comment.startPosition.row);
  }
  return rows;
}

/** Start row of a node, extended upwards over comments directly above it. */
function startRowWithComments(node: Node, comments: Map<number, number>): number {
  let row = node.startPosition.row;
  let start = comments.get(row - 1);
  while (start !== undefined) {
    row = start;
    start = comments.get(row - 1);
  }
  return row;
}

function typeKind(decl: Node): SymbolKind {
  return decl.type === 'trait_definition' ? 'interface' : 'class';
}

function declaredName(decl: Node): string | undefined {
  return decl.namedChildren.find((c) => c?.type === 'identifier')?.text;
}

function function_(
  node: Node,
  parent: string | undefined,
  comments: Map<number, number>,
): RawSymbol | undefined {
  const name = declaredName(node);
  if (!name) return undefined;
  const symbol: RawSymbol = {
    name,
    kind: parent ? 'method' : 'function',
    startRow: startRowWithComments(node, comments),
    endRow: node.endPosition.row,
  };
  if (parent) symbol.parent = parent;
  return symbol;
}

/** Symbols found among the members of a body, with `parent` as the nearest enclosing type. */
function memberSymbols(
  container: Node,
  parent: string | undefined,
  comments: Map<number, number>,
): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of container.namedChildren) {
    if (!node) continue;
    if (TYPES.has(node.type)) {
      symbols.push(...typeSymbols(node, comments));
    } else if (FUNCTIONS.has(node.type)) {
      const fn = function_(node, parent, comments);
      if (fn) symbols.push(fn);
    } else if (node.type === 'package_clause') {
      const body = node.namedChildren.find((c) => c?.type === 'template_body');
      if (body) symbols.push(...memberSymbols(body, parent, comments));
    }
  }
  return symbols;
}

/** Symbols of one type declaration followed by those of its members, in source order. */
function typeSymbols(decl: Node, comments: Map<number, number>): RawSymbol[] {
  const name = declaredName(decl);
  if (!name) return [];
  const startRow = startRowWithComments(decl, comments);
  // A trait is one chunk: its members are part of the contract and are not split out.
  if (decl.type === 'trait_definition') {
    return [{ name, kind: 'interface', startRow, endRow: decl.endPosition.row }];
  }
  const body = decl.namedChildren.find((c) => c?.type === 'template_body');
  const members = body ? memberSymbols(body, name, comments) : [];
  // The type chunk stops where its first function or nested type starts, so nothing is embedded twice.
  const first = members[0];
  const endRow = first ? Math.max(startRow, first.startRow - 1) : decl.endPosition.row;
  return [{ name, kind: typeKind(decl), startRow, endRow }, ...members];
}

/**
 * Finds classes, case classes, traits, objects and functions in a Scala file. Methods take the
 * nearest enclosing type as parent. Scala 3 enums are not found: the grammar cannot parse them.
 */
export function extractScalaSymbols(root: Node): RawSymbol[] {
  return memberSymbols(root, undefined, commentRows(root));
}
