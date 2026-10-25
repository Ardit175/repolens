import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const TYPES: Record<string, SymbolKind> = {
  class_declaration: 'class',
  record_declaration: 'class',
  interface_declaration: 'interface',
  annotation_type_declaration: 'interface',
  enum_declaration: 'enum',
};

const METHODS = new Set(['method_declaration', 'constructor_declaration']);
const COMMENTS = new Set(['line_comment', 'block_comment']);

/** Start row of a node, extended upwards over comments that sit directly above it. */
function startRowWithComments(node: Node): number {
  let row = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev && COMMENTS.has(prev.type) && prev.endPosition.row >= row - 1) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return row;
}

function nameOf(node: Node): string | undefined {
  return node.childForFieldName('name')?.text;
}

/** Symbols of one type declaration: the type itself, its methods and its nested types. */
function typeSymbols(decl: Node, kind: SymbolKind, parent?: string): RawSymbol[] {
  const name = nameOf(decl);
  if (!name) return [];
  const startRow = startRowWithComments(decl);
  const endRow = decl.endPosition.row;
  const self: RawSymbol = { name, kind, startRow, endRow };
  if (parent) self.parent = parent;
  if (kind !== 'class') return [self];

  const members: RawSymbol[] = [];
  const body = decl.childForFieldName('body');
  for (const member of body?.namedChildren ?? []) {
    if (!member) continue;
    const memberKind = TYPES[member.type];
    if (memberKind) {
      members.push(...typeSymbols(member, memberKind, name));
    } else if (METHODS.has(member.type)) {
      const methodName = nameOf(member);
      if (!methodName) continue;
      members.push({
        name: methodName,
        kind: 'method',
        parent: name,
        startRow: startRowWithComments(member),
        endRow: member.endPosition.row,
      });
    }
  }
  // The type chunk stops where its first method starts, so methods are not embedded twice.
  const firstMethod = members.find((m) => m.kind === 'method' && m.parent === name);
  const typeEnd = firstMethod ? Math.max(startRow, firstMethod.startRow - 1) : endRow;
  return [{ ...self, endRow: typeEnd }, ...members];
}

/** Finds types (with their methods and constructors) in a Java file. */
export function extractJavaSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    const kind = node ? TYPES[node.type] : undefined;
    if (node && kind) symbols.push(...typeSymbols(node, kind));
  }
  return symbols;
}
