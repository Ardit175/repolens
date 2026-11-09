import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/**
 * Common libc functions that say nothing about the codebase. Everything in the `std` namespace
 * (`std::move`, `std::make_unique`, ...) is skipped as well.
 */
const NOISE = new Set([
  'printf',
  'fprintf',
  'snprintf',
  'malloc',
  'calloc',
  'realloc',
  'free',
  'memcpy',
  'memset',
  'strlen',
  'strcmp',
  'strncmp',
  'strcpy',
  'strncpy',
  'exit',
  'assert',
  'abort',
  'puts',
]);

/** Blocks whose contents are visited like top-level code. */
const TRANSPARENT = new Set([
  'preproc_if',
  'preproc_ifdef',
  'preproc_else',
  'preproc_elif',
  'template_declaration',
  'declaration',
  'field_declaration',
  'type_definition',
]);

const TYPE_SPECIFIERS = new Set(['class_specifier', 'struct_specifier', 'union_specifier']);

/** The name node of a callee such as `f`, `a.f`, `ns::f`, `f<int>` or `Box<int>`, if it has one. */
function calleeName(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'identifier':
    case 'field_identifier':
    case 'type_identifier':
      return node;
    case 'field_expression':
      return calleeName(node.childForFieldName('field'));
    case 'qualified_identifier':
      return node.childForFieldName('scope')?.text === 'std'
        ? undefined
        : calleeName(node.childForFieldName('name'));
    case 'template_function':
    case 'template_method':
    case 'template_type':
      return calleeName(node.childForFieldName('name'));
    default:
      return undefined;
  }
}

/** Name and owning type of a function definition, from `name`, `Type::name` or `Type<T>::name`. */
function functionScope(fn: Node): Scope {
  let declarator: Node | null = fn.childForFieldName('declarator');
  while (declarator && declarator.type !== 'function_declarator') {
    declarator = declarator.childForFieldName('declarator') ?? declarator.namedChildren[0] ?? null;
  }
  let current = declarator?.childForFieldName('declarator') ?? null;
  let owner: Node | null = null;
  while (current?.type === 'qualified_identifier') {
    owner = current.childForFieldName('scope');
    current = current.childForFieldName('name');
  }
  if (!current) return {};
  const ownerName = owner?.type === 'template_type' ? owner.childForFieldName('name') : owner;
  return { from: current.text, ...(ownerName && { fromParent: ownerName.text }) };
}

/**
 * Records one `#include`. Like C, the target and the module are both the path as written,
 * without the quotes or angle brackets: `#include "util/x.hpp"` gives `util/x.hpp`.
 */
function addInclude(include: Node, c: EdgeCollector): void {
  const path = include.childForFieldName('path');
  if (!path) return;
  const target =
    path.type === 'string_literal'
      ? path.namedChildren.find((n) => n?.type === 'string_content')?.text
      : path.text.replace(/^<|>$/g, '');
  if (target) c.addImport(target, target, include);
}

/** Records calls in a subtree: plain, member and qualified calls, and `new T(...)`. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'call_expression' || node.type === 'new_expression') {
    const callee = node.childForFieldName(node.type === 'new_expression' ? 'type' : 'function');
    const name = calleeName(callee);
    if (name && !NOISE.has(name.text)) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

/** Walks declarations, keeping track of the class that owns a method defined in its body. */
function visitTop(parent: Node, owner: string | undefined, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'preproc_include') {
      addInclude(node, c);
    } else if (node.type === 'function_definition') {
      const scope = functionScope(node);
      const fromParent = scope.fromParent ?? owner;
      visit(node, fromParent ? { ...scope, fromParent } : scope, c);
    } else if (TYPE_SPECIFIERS.has(node.type) && node.childForFieldName('body')) {
      const body = node.childForFieldName('body')!;
      visitTop(body, node.childForFieldName('name')?.text ?? owner, c);
    } else if (node.type === 'namespace_definition' || node.type === 'linkage_specification') {
      const body = node.childForFieldName('body');
      if (body) visitTop(body.type === 'declaration_list' ? body : node, owner, c);
    } else if (TRANSPARENT.has(node.type) || node.type === 'declaration_list') {
      visitTop(node, owner, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/**
 * Finds `#include` imports and calls in a C++ file. Calls are attributed to the function or
 * method that contains them, with its class as parent. Calls through templates and to
 * overloaded or virtual methods are recorded by name only.
 */
export function extractCppEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'cpp');
  visitTop(root, undefined, collector);
  return collector.result();
}
