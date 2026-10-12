import type { Node } from 'web-tree-sitter';
import type { RawSymbol } from './types.js';

/** Start row of a node, extended upwards over `#` comments that sit directly above it. */
function startRowWithComments(node: Node): number {
  let row = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev && prev.type === 'comment' && prev.endPosition.row >= row - 1) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return row;
}

/** Returns the definition inside a node, unwrapping `@decorator` lines. */
function definitionOf(node: Node): Node | undefined {
  if (node.type === 'decorated_definition')
    return node.childForFieldName('definition') ?? undefined;
  return node;
}

function classMethods(cls: Node, className: string): RawSymbol[] {
  const body = cls.childForFieldName('body');
  if (!body) return [];
  const methods: RawSymbol[] = [];
  for (const member of body.namedChildren) {
    if (!member) continue;
    const def = definitionOf(member);
    if (def?.type !== 'function_definition') continue;
    const name = def.childForFieldName('name')?.text;
    if (!name) continue;
    methods.push({
      name,
      kind: 'method',
      parent: className,
      // `member` is the decorated_definition when decorators are present, so they are included.
      startRow: startRowWithComments(member),
      endRow: member.endPosition.row,
    });
  }
  return methods;
}

/** Finds top-level functions and classes (with their direct methods), decorators included. */
export function extractPythonSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    if (!node) continue;
    const def = definitionOf(node);
    if (!def) continue;
    const name = def.childForFieldName('name')?.text;
    if (!name) continue;
    const startRow = startRowWithComments(node);
    const endRow = node.endPosition.row;
    if (def.type === 'function_definition') {
      symbols.push({ name, kind: 'function', startRow, endRow });
    } else if (def.type === 'class_definition') {
      const methods = classMethods(def, name);
      // The class chunk stops where the first method starts, so methods are not embedded twice.
      const firstMethod = methods[0];
      const classEnd = firstMethod ? Math.max(startRow, firstMethod.startRow - 1) : endRow;
      symbols.push({ name, kind: 'class', startRow, endRow: classEnd }, ...methods);
    }
  }
  return symbols;
}
