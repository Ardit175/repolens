import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** The imported name of `a.b` or `a.b as x`: always the dotted name, never the alias. */
function dottedName(node: Node): string {
  return (node.type === 'aliased_import' ? node.childForFieldName('name') : node)?.text ?? '';
}

function addImports(node: Node, c: EdgeCollector): void {
  if (node.type === 'import_statement') {
    for (const item of node.namedChildren) {
      if (item) c.addImport('*', dottedName(item), item); // import a.b / import a as x
    }
    return;
  }
  // from m import a, b as c / from m import *
  const moduleNode = node.childForFieldName('module_name');
  if (!moduleNode) return;
  for (const item of node.namedChildren) {
    if (!item || item.startIndex === moduleNode.startIndex) continue;
    c.addImport(item.type === 'wildcard_import' ? '*' : dottedName(item), moduleNode.text, item);
  }
}

/** Records imports and calls in a subtree. Nested defs keep the scope of their chunk. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'import_statement' || node.type === 'import_from_statement') {
    return addImports(node, c);
  }
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    const name = fn?.type === 'attribute' ? fn.childForFieldName('attribute') : fn;
    if (name?.type === 'identifier') c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitClass(cls: Node, name: string, c: EdgeCollector): void {
  for (const child of cls.namedChildren) {
    if (!child) continue;
    if (child.type !== 'block') {
      visit(child, { from: name }, c);
      continue;
    }
    for (const member of child.namedChildren) {
      if (!member) continue;
      const def =
        member.type === 'decorated_definition' ? member.childForFieldName('definition') : member;
      const methodName =
        def?.type === 'function_definition' ? def.childForFieldName('name')?.text : undefined;
      visit(member, methodName ? { from: methodName, fromParent: name } : { from: name }, c);
    }
  }
}

/** Finds imports and calls in a Python file. */
export function extractPythonEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'python');
  for (const node of root.namedChildren) {
    if (!node) continue;
    // Visiting `node` rather than `def` keeps decorator calls inside the symbol's scope.
    const def = node.type === 'decorated_definition' ? node.childForFieldName('definition') : node;
    const name = def?.childForFieldName('name')?.text;
    if (def?.type === 'class_definition' && name) {
      for (const decorator of node.namedChildren) {
        if (decorator?.type === 'decorator') visit(decorator, { from: name }, collector);
      }
      visitClass(def, name, collector);
    } else if (def?.type === 'function_definition' && name) visit(node, { from: name }, collector);
    else visit(node, {}, collector);
  }
  return collector.result();
}
