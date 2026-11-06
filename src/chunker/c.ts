import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

/** Specifier node types that become chunks, with the kind of chunk they produce. */
const SPECIFIERS: Record<string, SymbolKind> = {
  struct_specifier: 'class',
  union_specifier: 'class',
  enum_specifier: 'enum',
};

/** Conditional-compilation blocks whose contents count as top level. */
const CONDITIONALS = new Set(['preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif']);

/**
 * Maps the last row of each comment to its first row, for every comment in the file,
 * so a comment block directly above a declaration can be found by row.
 */
function commentRows(root: Node): Map<number, number> {
  const rows = new Map<number, number>();
  for (const comment of root.descendantsOfType('comment')) {
    if (comment) rows.set(comment.endPosition.row, comment.startPosition.row);
  }
  return rows;
}

/** Start row of a node, extended upwards over comments directly above it. */
function startRowWithComments(node: Node, comments: Map<number, number>): number {
  let row = node.startPosition.row;
  let start = comments.get(row - 1);
  while (start !== undefined) {
    row = start;
    start = comments.get(row - 1);
  }
  return row;
}

/** The identifier at the bottom of a declarator chain such as `*(*name)(int)`. */
function declaredName(declarator: Node | null | undefined): string | undefined {
  let node = declarator;
  while (node && node.type !== 'identifier' && node.type !== 'type_identifier') {
    node = node.childForFieldName('declarator') ?? node.namedChildren[0];
  }
  return node?.text;
}

/** A struct, union or enum specifier that has a body, so it is a definition and not a reference. */
function definition(node: Node | null | undefined): Node | undefined {
  return node && node.type in SPECIFIERS && node.childForFieldName('body') ? node : undefined;
}

function symbol(
  name: string | undefined,
  kind: SymbolKind,
  node: Node,
  comments: Map<number, number>,
): RawSymbol[] {
  if (!name) return [];
  return [
    {
      name,
      kind,
      startRow: startRowWithComments(node, comments),
      endRow: node.endPosition.row,
    },
  ];
}

/** Symbols of one top-level node. Function-pointer typedefs and plain declarations give none. */
function nodeSymbols(node: Node, comments: Map<number, number>): RawSymbol[] {
  if (node.type === 'function_definition') {
    return symbol(declaredName(node.childForFieldName('declarator')), 'function', node, comments);
  }
  if (node.type in SPECIFIERS) {
    return definition(node)
      ? symbol(node.childForFieldName('name')?.text, SPECIFIERS[node.type]!, node, comments)
      : [];
  }
  if (node.type === 'type_definition' || node.type === 'declaration') {
    const spec = definition(node.childForFieldName('type'));
    if (!spec) return [];
    // `typedef struct {...} Name;` has no tag, so the typedef name is used.
    const name =
      spec.childForFieldName('name')?.text ??
      (node.type === 'type_definition' ? declaredName(node.childForFieldName('declarator')) : '');
    return symbol(name, SPECIFIERS[spec.type]!, node, comments);
  }
  return [];
}

function collect(parent: Node, comments: Map<number, number>, out: RawSymbol[]): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (CONDITIONALS.has(node.type)) collect(node, comments, out);
    else out.push(...nodeSymbols(node, comments));
  }
}

/**
 * Finds functions, structs, unions and enums in a C file. A `typedef struct {...} Name;` is named
 * after the typedef. Contents of `#if` and `#ifdef` blocks are treated as top level.
 */
export function extractCSymbols(root: Node): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  collect(root, commentRows(root), symbols);
  return symbols;
}
