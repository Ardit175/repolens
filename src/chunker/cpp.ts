import type { Node } from 'web-tree-sitter';
import type { RawSymbol, SymbolKind } from './types.js';

/** Specifier node types that become chunks, with the kind of chunk they produce. */
const SPECIFIERS: Record<string, SymbolKind> = {
  class_specifier: 'class',
  struct_specifier: 'class',
  union_specifier: 'class',
  enum_specifier: 'enum',
};

/** Blocks whose contents count as top level: namespaces, `extern "C"` and conditional compilation. */
const TRANSPARENT = new Set([
  'namespace_definition',
  'linkage_specification',
  'preproc_if',
  'preproc_ifdef',
  'preproc_else',
  'preproc_elif',
  'declaration_list',
]);

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

/** A class, struct, union or enum specifier that has a body, so it is a definition. */
function definition(node: Node | null | undefined): Node | undefined {
  return node && node.type in SPECIFIERS && node.childForFieldName('body') ? node : undefined;
}

/** The `function_declarator` at the bottom of a chain such as `*&name(int)`. */
function functionDeclarator(declarator: Node | null | undefined): Node | undefined {
  let node = declarator;
  while (node && node.type !== 'function_declarator') {
    node = node.childForFieldName('declarator') ?? node.namedChildren[0] ?? null;
  }
  return node ?? undefined;
}

/** The name of `Type::method`, `ns::Type::method` or `Type<T>::method` and the scope it belongs to. */
function qualifiedName(node: Node): { name: string; scope?: string } {
  let current = node;
  let scope: Node | null = null;
  while (current.type === 'qualified_identifier') {
    scope = current.childForFieldName('scope');
    const next = current.childForFieldName('name');
    if (!next) break;
    current = next;
  }
  // Template arguments are dropped so `Box<T>::get` has the parent `Box`.
  const scopeName = scope?.type === 'template_type' ? scope.childForFieldName('name') : scope;
  return { name: current.text, ...(scopeName && { scope: scopeName.text }) };
}

function functionSymbol(
  node: Node,
  parent: string | undefined,
  start: Node,
  comments: Map<number, number>,
): RawSymbol[] {
  const declarator = functionDeclarator(node.childForFieldName('declarator'))?.childForFieldName(
    'declarator',
  );
  if (!declarator) return [];
  const { name, scope } = qualifiedName(declarator);
  // `Type::method` defined outside its class belongs to Type.
  const owner = scope ?? parent;
  return [
    {
      name,
      kind: owner ? 'method' : 'function',
      ...(owner && { parent: owner }),
      startRow: startRowWithComments(start, comments),
      endRow: start.endPosition.row,
    },
  ];
}

/** Symbols of a type definition followed by those of its members, in source order. */
function typeSymbols(spec: Node, start: Node, comments: Map<number, number>, name?: string) {
  const typeName = name ?? spec.childForFieldName('name')?.text;
  if (!typeName) return [];
  const startRow = startRowWithComments(start, comments);
  const body = spec.childForFieldName('body');
  const members =
    spec.type === 'enum_specifier' || !body ? [] : memberSymbols(body, typeName, comments);
  // The type chunk stops where its first method or nested type starts, so nothing is embedded twice.
  const first = members[0];
  const endRow = first ? Math.max(startRow, first.startRow - 1) : start.endPosition.row;
  return [{ name: typeName, kind: SPECIFIERS[spec.type]!, startRow, endRow }, ...members];
}

/**
 * Symbols of one declaration node. `start` is the node whose range becomes the chunk: the
 * `template<...>` wrapper when there is one, so the template header is part of the chunk.
 */
function nodeSymbols(
  node: Node,
  parent: string | undefined,
  start: Node,
  comments: Map<number, number>,
): RawSymbol[] {
  if (node.type === 'function_definition') return functionSymbol(node, parent, start, comments);
  if (definition(node)) return typeSymbols(node, start, comments);
  if (node.type === 'template_declaration') {
    const inner = node.namedChildren.find(
      (c) => c && (c.type === 'function_definition' || definition(c)),
    );
    return inner ? nodeSymbols(inner, parent, node, comments) : [];
  }
  if (
    node.type === 'type_definition' ||
    node.type === 'declaration' ||
    node.type === 'field_declaration'
  ) {
    const spec = definition(node.childForFieldName('type'));
    if (!spec) return [];
    // `typedef struct {...} Name;` has no tag, so the typedef name is used.
    const alias =
      node.type === 'type_definition' ? node.childForFieldName('declarator')?.text : undefined;
    return typeSymbols(spec, start, comments, spec.childForFieldName('name')?.text ?? alias);
  }
  return [];
}

function memberSymbols(
  container: Node,
  parent: string | undefined,
  comments: Map<number, number>,
): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const node of container.namedChildren) {
    if (!node) continue;
    if (TRANSPARENT.has(node.type)) {
      const body = node.childForFieldName('body');
      symbols.push(...memberSymbols(body ?? node, parent, comments));
    } else {
      symbols.push(...nodeSymbols(node, parent, node, comments));
    }
  }
  return symbols;
}

/**
 * Finds functions, classes, structs, unions and enums (including `enum class`) in a C++ file.
 * Namespaces, `extern "C"` and `#if` blocks are treated as top level. A template's chunk includes
 * its `template<...>` header. Methods take their class as parent, whether they are defined in the
 * class body or outside it as `Type::method`. Methods of a class nested in a function are not found.
 */
export function extractCppSymbols(root: Node): RawSymbol[] {
  return memberSymbols(root, undefined, commentRows(root));
}
