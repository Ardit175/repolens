import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const TYPES: Record<string, SymbolKind> = {
  class_declaration: 'class',
  struct_declaration: 'class',
  record_declaration: 'class',
  record_struct_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
};

const NAMESPACES = new Set(['namespace_declaration', 'file_scoped_namespace_declaration']);
const METHODS = new Set(['method_declaration', 'constructor_declaration']);

/** Start row of a node, extended upwards over comments that sit directly above it. */
function startRowWithComments(node: Node): number {
  let row = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev && prev.type === 'comment' && prev.endPosition.row >= row - 1) {
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

function collect(container: Node, out: RawSymbol[]): void {
  for (const node of container.namedChildren) {
    if (!node) continue;
    const kind = TYPES[node.type];
    if (kind) {
      out.push(...typeSymbols(node, kind));
    } else if (NAMESPACES.has(node.type)) {
      collect(node.childForFieldName('body') ?? node, out);
    }
  }
}

/** Finds types (with their methods and constructors) in a C# file, inside namespaces or not. */
export function extractCSharpSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  collect(root, symbols);
  return symbols;
}
