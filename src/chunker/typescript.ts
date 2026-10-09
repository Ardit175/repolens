import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

const DECLARATIONS: Record<string, SymbolKind> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
};

const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

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

function classMethods(cls: Node, className: string): RawSymbol[] {
  const body = cls.childForFieldName('body');
  if (!body) return [];
  const methods: RawSymbol[] = [];
  for (const member of body.namedChildren) {
    if (!member) continue;
    if (member.type !== 'method_definition' && member.type !== 'abstract_method_signature')
      continue;
    const name = nameOf(member);
    if (!name) continue;
    methods.push({
      name,
      kind: 'method',
      parent: className,
      startRow: startRowWithComments(member),
      endRow: member.endPosition.row,
    });
  }
  return methods;
}

function symbolsOfDeclaration(decl: Node, outer: Node): RawSymbol[] {
  const startRow = startRowWithComments(outer);
  const endRow = outer.endPosition.row;
  const kind = DECLARATIONS[decl.type];
  if (kind) {
    const name = nameOf(decl);
    if (!name) return [];
    if (kind !== 'class') return [{ name, kind, startRow, endRow }];
    const methods = classMethods(decl, name);
    // The class chunk stops where the first method starts, so methods are not embedded twice.
    const firstMethod = methods[0];
    const classEnd = firstMethod ? Math.max(startRow, firstMethod.startRow - 1) : endRow;
    return [{ name, kind, startRow, endRow: classEnd }, ...methods];
  }
  if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
    const out: RawSymbol[] = [];
    for (const declarator of decl.namedChildren) {
      if (declarator?.type !== 'variable_declarator') continue;
      const value = declarator.childForFieldName('value');
      const name = nameOf(declarator);
      if (!value || !name || !FUNCTION_VALUES.has(value.type)) continue;
      out.push({ name, kind: 'function', startRow, endRow });
    }
    return out;
  }
  return [];
}

/** Finds top-level functions, classes (with their methods), interfaces, types and enums. */
export function extractTypeScriptSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (node.type === 'export_statement') {
      const decl = node.childForFieldName('declaration');
      if (decl) symbols.push(...symbolsOfDeclaration(decl, node));
    } else {
      symbols.push(...symbolsOfDeclaration(node, node));
    }
  }
  return symbols;
}
