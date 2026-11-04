import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const COMMENTS = ['line_comment', 'multiline_comment'];

/** Declarations that hold members: classes, interfaces and enums, objects, companion objects. */
const TYPES = new Set(['class_declaration', 'object_declaration', 'companion_object']);

/**
 * The grammar attaches a comment to whichever node ends just before it, so a comment above a
 * declaration is not always its previous sibling. This maps the last row of each comment to
 * its first row, for every comment in the file.
 */
function commentRows(root: Node): Map<number, number> {
  const rows = new Map<number, number>();
  for (const comment of root.descendantsOfType(COMMENTS)) {
    if (comment) rows.set(comment.endPosition.row, comment.startPosition.row);
  }
  return rows;
}

/** Start row of a node, extended upwards over comments directly above it. Annotations are part of the node. */
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
  if (decl.type !== 'class_declaration') return 'class';
  if (decl.children.some((c) => c?.type === 'interface')) return 'interface';
  if (decl.namedChildren.some((c) => c?.type === 'enum_class_body')) return 'enum';
  return 'class';
}

function typeName(decl: Node): string | undefined {
  const name = decl.namedChildren.find((c) => c?.type === 'type_identifier')?.text;
  return name ?? (decl.type === 'companion_object' ? 'Companion' : undefined);
}

function typeBody(decl: Node): Node | undefined {
  return (
    decl.namedChildren.find((c) => c?.type === 'class_body' || c?.type === 'enum_class_body') ??
    undefined
  );
}

function function_(
  node: Node,
  parent: string | undefined,
  comments: Map<number, number>,
): RawSymbol | undefined {
  const name = node.namedChildren.find((c) => c?.type === 'simple_identifier')?.text;
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

/** Symbols of one type declaration followed by those of its members, in source order. */
function typeSymbols(decl: Node, comments: Map<number, number>): RawSymbol[] {
  const name = typeName(decl);
  if (!name) return [];
  const startRow = startRowWithComments(decl, comments);
  const members: RawSymbol[] = [];
  for (const member of typeBody(decl)?.namedChildren ?? []) {
    if (!member) continue;
    if (member.type === 'function_declaration') {
      const fn = function_(member, name, comments);
      if (fn) members.push(fn);
    } else if (TYPES.has(member.type)) {
      members.push(...typeSymbols(member, comments));
    }
  }
  // The type chunk stops where its first function or nested type starts, so nothing is embedded twice.
  const first = members[0];
  const endRow = first ? Math.max(startRow, first.startRow - 1) : decl.endPosition.row;
  return [{ name, kind: typeKind(decl), startRow, endRow }, ...members];
}

/**
 * Finds classes (data, sealed and enum classes included), interfaces, objects, companion objects
 * and functions in a Kotlin file. Member functions take the nearest enclosing type as parent.
 */
export function extractKotlinSymbols(root: Node): RawSymbol[] {
  const comments = commentRows(root);
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (TYPES.has(node.type)) {
      symbols.push(...typeSymbols(node, comments));
    } else if (node.type === 'function_declaration') {
      const fn = function_(node, undefined, comments);
      if (fn) symbols.push(fn);
    }
  }
  return symbols;
}
