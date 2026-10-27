import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

/** Type specs are classified by the node type of the type they define. */
const SPEC_KINDS: Record<string, SymbolKind> = {
  struct_type: 'class',
  interface_type: 'interface',
};

const SPECS = new Set(['type_spec', 'type_alias']);

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

/** Name of the receiver's base type: `*Stack[T]` gives `Stack`. */
function receiverType(method: Node): string | undefined {
  const param = method.childForFieldName('receiver')?.namedChildren[0];
  return param?.childForFieldName('type')?.descendantsOfType('type_identifier')[0]?.text;
}

/** One symbol per type spec. A lone spec spans the whole declaration, including `type`. */
function typeSymbols(decl: Node): RawSymbol[] {
  const specs = decl.namedChildren.filter((n): n is Node => !!n && SPECS.has(n.type));
  const grouped = specs.length > 1 || decl.text.startsWith('type (');
  const symbols: RawSymbol[] = [];
  for (const spec of specs) {
    const name = spec.childForFieldName('name')?.text;
    if (!name) continue;
    const kind = SPEC_KINDS[spec.childForFieldName('type')?.type ?? ''] ?? 'type';
    const range = grouped ? spec : decl;
    symbols.push({
      name,
      kind,
      startRow: startRowWithComments(range),
      endRow: range.endPosition.row,
    });
  }
  return symbols;
}

/** Finds functions, methods and type declarations (structs, interfaces, other types) in a Go file. */
export function extractGoSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type === 'type_declaration') {
      symbols.push(...typeSymbols(node));
    } else if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (!name) continue;
      const symbol: RawSymbol = {
        name,
        kind: node.type === 'method_declaration' ? 'method' : 'function',
        startRow: startRowWithComments(node),
        endRow: node.endPosition.row,
      };
      const parent = node.type === 'method_declaration' ? receiverType(node) : undefined;
      if (parent) symbol.parent = parent;
      symbols.push(symbol);
    }
  }
  return symbols;
}
