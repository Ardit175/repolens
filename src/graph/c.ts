import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Common libc functions that are everywhere and say nothing about the codebase. */
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
  'fopen',
  'fclose',
  'fread',
  'fwrite',
]);

/** Conditional-compilation blocks whose contents are visited like top-level code. */
const CONDITIONALS = new Set(['preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif']);

/** The identifier at the bottom of a declarator chain such as `*name(int)`. */
function functionName(declarator: Node | null | undefined): string | undefined {
  let node = declarator;
  while (node && node.type !== 'identifier') {
    node = node.childForFieldName('declarator') ?? node.namedChildren[0];
  }
  return node?.text;
}

/**
 * Records one `#include`. Like PHP's `require`, the target and the module are both the path as
 * written, without the quotes or angle brackets: `#include "util/x.h"` gives `util/x.h`.
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

/** Records includes and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'preproc_include') {
    addInclude(node, c);
    return;
  }
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    // Calls through a function pointer field, `s->cb()`, name the field.
    const name = fn?.type === 'field_expression' ? fn.childForFieldName('field') : fn;
    if (name && (name.type === 'identifier' || name.type === 'field_identifier')) {
      if (!NOISE.has(name.text)) c.addCall(name.text, name, scope);
    }
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitTop(parent: Node, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'function_definition') {
      const from = functionName(node.childForFieldName('declarator'));
      visit(node, from ? { from } : {}, c);
    } else if (CONDITIONALS.has(node.type)) {
      visitTop(node, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds `#include` imports and function calls in a C file. Functions have no parent in C. */
export function extractCEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'c');
  visitTop(root, collector);
  return collector.result();
}
