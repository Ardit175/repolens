import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const TYPES: Record<string, SymbolKind> = {
  class: 'class',
  module: 'class',
};

const METHODS = new Set(['method', 'singleton_method']);

/** Start row of a node, extended upwards over comments that sit directly above it. */
function startRowWithComments(node: Node): number {
  let row = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev?.type === 'comment' && prev.endPosition.row >= row - 1) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return row;
}

/** Name of a class or module: the last segment of `A::B`. */
function typeName(decl: Node): string | undefined {
  const name = decl.childForFieldName('name');
  if (name?.type === 'scope_resolution') return name.childForFieldName('name')?.text;
  return name?.text;
}

/** Symbols of one class or module: the type itself, its methods and its nested types. */
function typeSymbols(decl: Node, parent?: string): RawSymbol[] {
  const name = typeName(decl);
  if (!name) return [];
  const startRow = startRowWithComments(decl);
  const self: RawSymbol = { name, kind: 'class', startRow, endRow: decl.endPosition.row };
  if (parent) self.parent = parent;

  const members: RawSymbol[] = [];
  let firstMemberRow: number | undefined;
  for (const member of decl.childForFieldName('body')?.namedChildren ?? []) {
    if (!member) continue;
    if (member.type in TYPES) {
      const nested = typeSymbols(member, name);
      if (nested.length === 0) continue;
      members.push(...nested);
      firstMemberRow ??= startRowWithComments(member);
    } else if (METHODS.has(member.type)) {
      const methodName = member.childForFieldName('name')?.text;
      if (!methodName) continue;
      const methodStart = startRowWithComments(member);
      members.push({
        name: methodName,
        kind: 'method',
        parent: name,
        startRow: methodStart,
        endRow: member.endPosition.row,
      });
      firstMemberRow ??= methodStart;
    }
  }
  // The type chunk stops where its first method or nested type starts, so they are not embedded twice.
  const typeEnd =
    firstMemberRow === undefined ? self.endRow : Math.max(startRow, firstMemberRow - 1);
  return [{ ...self, endRow: typeEnd }, ...members];
}

/**
 * Finds classes and modules (with their methods, singleton methods and nested types) and
 * top-level methods in a Ruby file. Methods take the innermost enclosing class or module as parent.
 */
export function extractRubySymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type in TYPES) {
      symbols.push(...typeSymbols(node));
    } else if (METHODS.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startRow: startRowWithComments(node),
          endRow: node.endPosition.row,
        });
      }
    }
  }
  return symbols;
}
