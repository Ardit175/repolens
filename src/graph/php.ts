import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Built-in functions that are everywhere and say nothing about the codebase. */
const NOISE = new Set([
  'isset',
  'unset',
  'empty',
  'count',
  'define',
  'defined',
  'array',
  'array_map',
  'array_filter',
  'array_sum',
  'array_keys',
  'array_values',
  'array_merge',
  'in_array',
  'implode',
  'explode',
  'sprintf',
  'printf',
  'var_dump',
  'print_r',
  'strlen',
  'strtoupper',
  'strtolower',
  'str_replace',
  'is_null',
  'is_array',
  'is_string',
  'json_encode',
  'json_decode',
]);

const INCLUDES = new Set([
  'require_expression',
  'require_once_expression',
  'include_expression',
  'include_once_expression',
]);

const TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
]);

/** Last segment of a `name` or `qualified_name` such as `\Foo\Bar`. */
function lastSegment(node: Node): string | undefined {
  if (node.type === 'name') return node.text;
  if (node.type === 'qualified_name') return node.namedChildren.at(-1)?.text;
  return undefined;
}

/** The text of a plain string literal (no interpolation), without quotes. */
function stringValue(node: Node | null | undefined): string | undefined {
  if (node?.type !== 'string' && node?.type !== 'encapsed_string') return undefined;
  if (node.namedChildren.some((n) => n?.type !== 'string_content')) return undefined;
  return node.namedChildren[0]?.text;
}

/** Records the imports of one `use` clause, with `prefix` for grouped clauses. */
function useClause(clause: Node, prefix: string, c: EdgeCollector): void {
  const path = clause.namedChildren.find(
    (n) => n?.type === 'qualified_name' || n?.type === 'name' || n?.type === 'namespace_name',
  );
  if (!path) return;
  const alias = clause.namedChildren.find((n) => n?.type === 'namespace_aliasing_clause');
  const module = (prefix + path.text).replace(/^\\/, '');
  const target = alias?.namedChildren[0]?.text ?? module.split('\\').at(-1);
  if (target) c.addImport(target, module, clause);
}

function useDeclaration(decl: Node, c: EdgeCollector): void {
  const group = decl.namedChildren.find((n) => n?.type === 'namespace_use_group');
  if (group) {
    const prefix = decl.namedChildren.find((n) => n?.type === 'namespace_name')?.text ?? '';
    for (const clause of group.namedChildren) {
      if (clause) useClause(clause, `${prefix}\\`, c);
    }
    return;
  }
  for (const clause of decl.namedChildren) {
    if (clause?.type === 'namespace_use_clause') useClause(clause, '', c);
  }
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (INCLUDES.has(node.type)) {
    const target = stringValue(node.namedChildren[0]);
    if (target) c.addImport(target, target, node);
  } else if (node.type === 'namespace_use_declaration') {
    useDeclaration(node, c);
    return;
  } else if (node.type === 'function_call_expression') {
    const fn = node.childForFieldName('function');
    const name = fn && lastSegment(fn);
    if (fn && name && !NOISE.has(name)) c.addCall(name, fn, scope);
  } else if (
    node.type === 'member_call_expression' ||
    node.type === 'nullsafe_member_call_expression' ||
    node.type === 'scoped_call_expression'
  ) {
    const name = node.childForFieldName('name');
    if (name?.type === 'name') c.addCall(name.text, name, scope);
  } else if (node.type === 'object_creation_expression') {
    const cls = node.namedChildren.find((n) => n?.type === 'name' || n?.type === 'qualified_name');
    const name = cls && lastSegment(cls);
    if (cls && name && !['self', 'static', 'parent'].includes(name)) c.addCall(name, cls, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitBody(parent: Node, enclosing: string | undefined, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'method_declaration' || node.type === 'function_definition') {
      const from = node.childForFieldName('name')?.text;
      const scope: Scope =
        from && enclosing ? { from, fromParent: enclosing } : from ? { from } : {};
      visit(node, scope, c);
    } else if (TYPES.has(node.type)) {
      const body = node.childForFieldName('body');
      if (body) visitBody(body, node.childForFieldName('name')?.text ?? enclosing, c);
    } else if (node.type === 'namespace_definition') {
      const body = node.childForFieldName('body');
      if (body) visitBody(body, enclosing, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds `use` and `require`/`include` imports and function, method and `new` calls in a PHP file. */
export function extractPhpEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'php');
  visitBody(root, undefined, collector);
  return collector.result();
}
