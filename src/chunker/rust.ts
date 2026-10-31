import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

/** Items that become one chunk each, by node type. */
const ITEM_KINDS: Record<string, SymbolKind> = {
  function_item: 'function',
  struct_item: 'class',
  union_item: 'class',
  enum_item: 'enum',
  trait_item: 'interface',
  type_item: 'type',
};

/** Lines directly above an item that belong to it: doc comments and attributes. */
const LEADING = new Set(['line_comment', 'block_comment', 'attribute_item']);

/** Start row of a node, extended upwards over comments and attributes that sit directly above it. */
function startRowWithLeading(node: Node): number {
  let row = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev && LEADING.has(prev.type) && prev.endPosition.row >= row - 1) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return row;
}

/** Name of the implemented type: `Stack` for `impl<T> Stack<T>` and `impl Trait for Stack<T>`. */
function implType(impl: Node): string | undefined {
  let type = impl.childForFieldName('type');
  if (type?.type === 'generic_type') type = type.childForFieldName('type');
  if (type?.type === 'scoped_type_identifier') type = type.childForFieldName('name');
  return type?.type === 'type_identifier' ? type.text : undefined;
}

function symbolsIn(parent: Node, enclosing: string | undefined, out: RawSymbol[]): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    const kind = ITEM_KINDS[node.type];
    if (kind) {
      const name = node.childForFieldName('name')?.text;
      if (!name) continue;
      const symbol: RawSymbol = {
        name,
        kind: enclosing ? 'method' : kind,
        startRow: startRowWithLeading(node),
        endRow: node.endPosition.row,
      };
      if (enclosing) symbol.parent = enclosing;
      out.push(symbol);
    } else if (node.type === 'impl_item') {
      const body = node.childForFieldName('body');
      if (body) symbolsIn(body, implType(node), out);
    } else if (node.type === 'mod_item') {
      const body = node.childForFieldName('body');
      if (body) symbolsIn(body, undefined, out);
    }
  }
}

/**
 * Finds functions, impl methods and type declarations in a Rust file. Methods take the
 * implemented type as parent, whether from an inherent impl or a trait impl. A trait is one chunk,
 * and items inside inline modules are treated as top level.
 */
export function extractRustSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  symbolsIn(root, undefined, symbols);
  return symbols;
}
