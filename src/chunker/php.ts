import type { Node } from 'web-tree-sitter';
import type { RawSymbol } from './types.js';

const TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
]);

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

/** Symbols of one class-like declaration: the type itself and its methods. */
function typeSymbols(decl: Node): RawSymbol[] {
  const name = decl.childForFieldName('name')?.text;
  if (!name) return [];
  const startRow = startRowWithComments(decl);
  const kind = decl.type === 'interface_declaration' ? 'interface' : 'class';

  const methods: RawSymbol[] = [];
  for (const member of decl.childForFieldName('body')?.namedChildren ?? []) {
    if (member?.type !== 'method_declaration') continue;
    const methodName = member.childForFieldName('name')?.text;
    if (!methodName) continue;
    methods.push({
      name: methodName,
      kind: 'method',
      parent: name,
      startRow: startRowWithComments(member),
      endRow: member.endPosition.row,
    });
  }
  // The type chunk stops where its first method starts, so methods are not embedded twice.
  const first = methods[0];
  const endRow = first ? Math.max(startRow, first.startRow - 1) : decl.endPosition.row;
  return [{ name, kind, startRow, endRow }, ...methods];
}

/** Symbols of a list of top-level statements. */
function collect(nodes: (Node | null)[]): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of nodes) {
    if (!node) continue;
    if (TYPES.has(node.type)) {
      symbols.push(...typeSymbols(node));
    } else if (node.type === 'function_definition') {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        symbols.push({
          name,
          kind: 'function',
          startRow: startRowWithComments(node),
          endRow: node.endPosition.row,
        });
      }
    } else if (node.type === 'namespace_definition') {
      // `namespace X { ... }` holds top-level items; `namespace X;` has no body.
      const body = node.childForFieldName('body');
      if (body) symbols.push(...collect(body.namedChildren));
    }
  }
  return symbols;
}

/**
 * Finds classes, interfaces, traits, enums (with their methods) and functions in a PHP file.
 * Methods take the enclosing type as parent. Items inside a namespace are top level.
 */
export function extractPhpSymbols(root: Node): RawSymbol[] {
  return collect(root.namedChildren);
}
