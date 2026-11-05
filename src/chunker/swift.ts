import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const COMMENTS = ['comment', 'multiline_comment'];

/** Declarations that hold members: classes, structs, enums, actors and extensions share one node type. */
const TYPES = new Set(['class_declaration', 'protocol_declaration']);

/** Member declarations that become method chunks. */
const METHODS = new Set(['function_declaration', 'init_declaration', 'deinit_declaration']);

/**
 * A comment above a declaration is a sibling of it, or of its parent's earlier children, so it is
 * not always the declaration's previous sibling. This maps the last row of each comment to its
 * first row, for every comment in the file.
 */
function commentRows(root: Node): Map<number, number> {
  const rows = new Map<number, number>();
  for (const comment of root.descendantsOfType(COMMENTS)) {
    if (comment) rows.set(comment.endPosition.row, comment.startPosition.row);
  }
  return rows;
}

/** Start row of a node, extended upwards over comments directly above it. Attributes are part of the node. */
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
  if (decl.type === 'protocol_declaration') return 'interface';
  if (decl.children.some((c) => c?.type === 'enum')) return 'enum';
  return 'class';
}

/** The declared name, or for an extension the name of the extended type. */
function typeName(decl: Node): string | undefined {
  const direct = decl.namedChildren.find((c) => c?.type === 'type_identifier');
  if (direct) return direct.text;
  const extended = decl.namedChildren.find((c) => c?.type === 'user_type');
  const parts = extended?.namedChildren.filter((c) => c?.type === 'type_identifier');
  return parts && parts.length > 0 ? parts.map((c) => c?.text).join('.') : undefined;
}

function typeBody(decl: Node): Node | undefined {
  return (
    decl.namedChildren.find((c) => c?.type === 'class_body' || c?.type === 'enum_class_body') ??
    undefined
  );
}

function methodName(node: Node): string | undefined {
  if (node.type === 'init_declaration') return 'init';
  if (node.type === 'deinit_declaration') return 'deinit';
  return node.namedChildren.find((c) => c?.type === 'simple_identifier')?.text;
}

function function_(
  node: Node,
  parent: string | undefined,
  comments: Map<number, number>,
): RawSymbol | undefined {
  const name = methodName(node);
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
    if (METHODS.has(member.type)) {
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
 * Finds classes, structs, enums, actors, protocols, extensions and functions in a Swift file.
 * Methods, initializers and deinitializers take the nearest enclosing type as parent.
 */
export function extractSwiftSymbols(root: Node): RawSymbol[] {
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
