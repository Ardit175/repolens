import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** The last segment of a `::` path: `HashMap` in `std::collections::HashMap`. */
function lastSegment(path: string): string {
  return path.split('::').pop() ?? path;
}

/**
 * Records the names a `use` tree binds, with `prefix` as the path walked so far:
 * - `use a::b::C` -> `C`, and `use a::b::C as D` -> the alias `D`
 * - `use a::{b, c}` -> one import per leaf, and `use a::{self}` -> `a`
 * - `use a::*` -> `*`, since no single name is bound
 */
function addUse(node: Node, prefix: string, c: EdgeCollector): void {
  const join = (tail: string): string => (prefix ? `${prefix}::${tail}` : tail);
  switch (node.type) {
    case 'self':
      if (prefix) c.addImport(lastSegment(prefix), prefix, node);
      break;
    case 'identifier':
    case 'scoped_identifier':
      c.addImport(lastSegment(node.text), join(node.text), node);
      break;
    case 'use_as_clause': {
      const path = node.childForFieldName('path');
      const alias = node.childForFieldName('alias');
      if (path && alias) c.addImport(alias.text, join(path.text), node);
      break;
    }
    case 'use_wildcard':
      c.addImport('*', join(node.text.replace(/(::)?\*$/, '')), node);
      break;
    case 'scoped_use_list': {
      const path = node.childForFieldName('path');
      const list = node.childForFieldName('list');
      if (list) addUse(list, path ? join(path.text) : prefix, c);
      break;
    }
    case 'use_list':
      for (const child of node.namedChildren) if (child) addUse(child, prefix, c);
      break;
  }
}

/** The implemented type of an `impl` block: `Stack` in `impl<T> Trait for Stack<T>`. */
function implType(impl: Node): string | undefined {
  let type = impl.childForFieldName('type');
  if (type?.type === 'generic_type') type = type.childForFieldName('type');
  if (type?.type === 'scoped_type_identifier') type = type.childForFieldName('name');
  return type?.type === 'type_identifier' ? type.text : undefined;
}

/** The called name: `foo` in `foo()`, `new` in `Circle::new()`, `area` in `c.area()` and `f::<T>()`. */
function calleeName(call: Node): Node | undefined {
  let fn = call.childForFieldName('function');
  if (fn?.type === 'generic_function') fn = fn.childForFieldName('function');
  if (fn?.type === 'identifier') return fn;
  if (fn?.type === 'scoped_identifier') return fn.childForFieldName('name') ?? undefined;
  if (fn?.type === 'field_expression') return fn.childForFieldName('field') ?? undefined;
  return undefined;
}

/** Records imports and calls in a subtree. Macro invocations are not calls. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'use_declaration') {
    const argument = node.childForFieldName('argument');
    if (argument) addUse(argument, '', c);
    return;
  }
  if (node.type === 'call_expression') {
    const name = calleeName(node);
    if (name) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitItems(parent: Node, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'function_item') {
      visit(node, { from: node.childForFieldName('name')?.text }, c);
    } else if (node.type === 'trait_item') {
      visit(node, { from: node.childForFieldName('name')?.text }, c);
    } else if (node.type === 'impl_item') {
      const body = node.childForFieldName('body');
      const type = implType(node);
      for (const item of body?.namedChildren ?? []) {
        if (!item) continue;
        const name = item.childForFieldName('name')?.text;
        const scope: Scope =
          type && name ? { from: name, fromParent: type } : name ? { from: name } : {};
        visit(item, scope, c);
      }
    } else if (node.type === 'mod_item') {
      const body = node.childForFieldName('body');
      if (body) visitItems(body, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds imports and calls in a Rust file. */
export function extractRustEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'rust');
  visitItems(root, collector);
  return collector.result();
}
