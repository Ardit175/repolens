import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

const TYPES = new Set([
  'class_declaration',
  'record_declaration',
  'interface_declaration',
  'enum_declaration',
  'annotation_type_declaration',
]);
const METHODS = new Set(['method_declaration', 'constructor_declaration']);

/** The simple name of a created type: `Foo` in `Foo`, `a.b.Foo` and `Foo<T>`. */
function typeName(node: Node | null): Node | undefined {
  switch (node?.type) {
    case 'type_identifier':
      return node;
    case 'generic_type':
      return typeName(node.namedChildren.find((n) => n?.type !== 'type_arguments') ?? null);
    // `a.b.Foo` nests its qualifier first, so the simple name comes last.
    case 'scoped_type_identifier':
      return typeName(node.namedChildren[node.namedChildren.length - 1] ?? null);
    default:
      return undefined;
  }
}

function addImport(node: Node, c: EdgeCollector): void {
  const name = node.namedChildren.find(
    (n) => n?.type === 'identifier' || n?.type === 'scoped_identifier',
  );
  if (!name) return;
  const wildcard = node.namedChildren.some((n) => n?.type === 'asterisk');
  c.addImport(wildcard ? '*' : (name.childForFieldName('name') ?? name).text, name.text, node);
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'import_declaration') return addImport(node, c);
  if (node.type === 'method_invocation') {
    const name = node.childForFieldName('name');
    if (name) c.addCall(name.text, name, scope);
  } else if (node.type === 'object_creation_expression') {
    const name = typeName(node.childForFieldName('type'));
    if (name) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitType(decl: Node, c: EdgeCollector, parent?: string): void {
  const name = decl.childForFieldName('name')?.text;
  const own: Scope = parent ? { from: name, fromParent: parent } : { from: name };
  if (!name) return visit(decl, own, c);
  const body = decl.childForFieldName('body');
  for (const child of decl.namedChildren) {
    if (!child) continue;
    if (child.id !== body?.id) visit(child, own, c);
    else visitMembers(child, name, own, c);
  }
}

function visitMembers(body: Node, typeName: string, own: Scope, c: EdgeCollector): void {
  for (const member of body.namedChildren) {
    if (!member) continue;
    if (TYPES.has(member.type)) {
      visitType(member, c, typeName);
    } else if (member.type === 'enum_body_declarations') {
      visitMembers(member, typeName, own, c);
    } else {
      const methodName = METHODS.has(member.type)
        ? member.childForFieldName('name')?.text
        : undefined;
      visit(member, methodName ? { from: methodName, fromParent: typeName } : own, c);
    }
  }
}

/** Finds imports and calls in a Java file. */
export function extractJavaEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'java');
  for (const node of root.namedChildren) {
    if (!node) continue;
    if (TYPES.has(node.type)) visitType(node, collector);
    else visit(node, {}, collector);
  }
  return collector.result();
}
