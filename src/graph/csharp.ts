import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

const CLASS_LIKE = new Set([
  'class_declaration',
  'struct_declaration',
  'record_declaration',
  'record_struct_declaration',
]);
const OTHER_TYPES = new Set(['interface_declaration', 'enum_declaration']);
const NAMESPACES = new Set(['namespace_declaration', 'file_scoped_namespace_declaration']);
const METHODS = new Set(['method_declaration', 'constructor_declaration']);

/** The simple name of a callee or type: `Foo` in `Foo`, `a.Foo`, `a.Foo<T>` and `N.Foo`. */
function simpleName(node: Node | null): Node | undefined {
  switch (node?.type) {
    case 'identifier':
      return node;
    case 'generic_name':
      return node.namedChildren.find((n) => n?.type === 'identifier') ?? undefined;
    case 'member_access_expression':
    case 'member_binding_expression':
      return simpleName(node.childForFieldName('name'));
    // `N.Foo` has no name field and `a?.Foo` wraps the call target: the name comes last.
    case 'qualified_name':
    case 'alias_qualified_name':
    case 'conditional_access_expression':
      return simpleName(node.namedChildren[node.namedChildren.length - 1] ?? null);
    default:
      return undefined;
  }
}

function addUsing(node: Node, c: EdgeCollector): void {
  // The namespace is the last named child; for `using A = X.Y;` the alias comes before it.
  const target = node.namedChildren[node.namedChildren.length - 1];
  if (target) c.addImport('*', target.text, node);
}

/** Records usings and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'using_directive') return addUsing(node, c);
  if (node.type === 'invocation_expression' || node.type === 'object_creation_expression') {
    const field = node.type === 'invocation_expression' ? 'function' : 'type';
    const name = simpleName(node.childForFieldName(field));
    if (name) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitType(decl: Node, c: EdgeCollector, parent?: string): void {
  const name = decl.childForFieldName('name')?.text;
  const own: Scope = parent ? { from: name, fromParent: parent } : { from: name };
  if (!name || !CLASS_LIKE.has(decl.type)) return visit(decl, own, c);
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
    if (CLASS_LIKE.has(member.type) || OTHER_TYPES.has(member.type)) {
      visitType(member, c, typeName);
      continue;
    }
    const methodName = METHODS.has(member.type)
      ? member.childForFieldName('name')?.text
      : undefined;
    visit(member, methodName ? { from: methodName, fromParent: typeName } : own, c);
  }
}

function collect(container: Node, c: EdgeCollector): void {
  for (const node of container.namedChildren) {
    if (!node) continue;
    if (CLASS_LIKE.has(node.type) || OTHER_TYPES.has(node.type)) visitType(node, c);
    else if (NAMESPACES.has(node.type)) {
      // Visit the namespace's own children (e.g. its name) at top level, then its body.
      collect(node.childForFieldName('body') ?? node, c);
    } else visit(node, {}, c);
  }
}

/** Finds usings and calls in a C# file, inside namespaces or not. */
export function extractCSharpEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'csharp');
  collect(root, collector);
  return collector.result();
}
