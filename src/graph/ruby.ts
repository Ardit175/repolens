import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Calls that are Ruby keywords in practice, not edges worth linking. */
const NOISE = new Set([
  'require',
  'require_relative',
  'load',
  'attr_accessor',
  'attr_reader',
  'attr_writer',
  'include',
  'extend',
  'prepend',
  'private',
  'protected',
  'public',
  'module_function',
  'puts',
  'print',
  'p',
  'raise',
  'new',
]);

const IMPORTS = new Set(['require', 'require_relative']);

/** The string argument of `require 'x'`: the module path without quotes. */
function requirePath(call: Node): string | undefined {
  const arg = call.childForFieldName('arguments')?.namedChildren[0];
  if (arg?.type !== 'string') return undefined;
  return arg.namedChildren.find((n) => n?.type === 'string_content')?.text;
}

/** Name of the class or module declared by a node. */
function typeName(decl: Node): string | undefined {
  const name = decl.childForFieldName('name');
  if (name?.type === 'scope_resolution') return name.childForFieldName('name')?.text;
  return name?.text;
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'call') {
    const method = node.childForFieldName('method');
    const receiver = node.childForFieldName('receiver');
    if (method) {
      if (!receiver && IMPORTS.has(method.text)) {
        const target = requirePath(node);
        if (target) c.addImport(target, target, node);
      } else if (!(NOISE.has(method.text) && !receiver)) {
        c.addCall(method.text, method, scope);
      }
    }
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitBody(parent: Node, enclosing: string | undefined, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'method' || node.type === 'singleton_method') {
      const from = node.childForFieldName('name')?.text;
      const scope: Scope =
        from && enclosing ? { from, fromParent: enclosing } : from ? { from } : {};
      visit(node, scope, c);
    } else if (node.type === 'class' || node.type === 'module') {
      const body = node.childForFieldName('body');
      if (body) visitBody(body, typeName(node) ?? enclosing, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds `require` imports and method calls in a Ruby file. */
export function extractRubyEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'ruby');
  visitBody(root, undefined, collector);
  return collector.result();
}
