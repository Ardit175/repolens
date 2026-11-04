import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Standard library functions that are everywhere and say nothing about the codebase. */
const NOISE = new Set([
  'println',
  'print',
  'listOf',
  'mapOf',
  'setOf',
  'mutableListOf',
  'mutableMapOf',
  'mutableSetOf',
  'arrayOf',
  'emptyList',
  'emptyMap',
  'require',
  'requireNotNull',
  'check',
  'checkNotNull',
  'error',
  'TODO',
  'to',
]);

const TYPES = new Set(['class_declaration', 'object_declaration', 'companion_object']);

/** Records the import of one `import_header`: `import a.b.C`, `import a.b.C as D`, `import a.b.*`. */
function addImport(header: Node, c: EdgeCollector): void {
  const path = header.namedChildren.find((n) => n?.type === 'identifier');
  if (!path) return;
  const alias = header.namedChildren.find((n) => n?.type === 'import_alias');
  const wildcard = header.namedChildren.some((n) => n?.type === 'wildcard_import');
  const last = path.namedChildren.at(-1)?.text;
  if (wildcard) c.addImport('*', path.text, header);
  else if (alias) {
    const name = alias.namedChildren[0]?.text;
    if (name) c.addImport(name, path.text, header);
  } else if (last) c.addImport(last, path.text, header);
}

/** The called name: `foo` in `foo()` and `bar` in `a.b.bar()`. */
function calleeName(call: Node): Node | undefined {
  const fn = call.namedChildren[0];
  if (fn?.type === 'simple_identifier') return fn;
  if (fn?.type === 'navigation_expression') {
    const suffix = fn.namedChildren.at(-1);
    if (suffix?.type !== 'navigation_suffix') return undefined;
    const name = suffix.namedChildren[0];
    return name?.type === 'simple_identifier' ? name : undefined;
  }
  return undefined;
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'import_header') {
    addImport(node, c);
    return;
  }
  if (node.type === 'call_expression') {
    const name = calleeName(node);
    if (name && !NOISE.has(name.text)) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitBody(parent: Node, enclosing: string | undefined, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (node.type === 'function_declaration') {
      const from = node.namedChildren.find((n) => n?.type === 'simple_identifier')?.text;
      const scope: Scope =
        from && enclosing ? { from, fromParent: enclosing } : from ? { from } : {};
      visit(node, scope, c);
    } else if (TYPES.has(node.type)) {
      const name =
        node.namedChildren.find((n) => n?.type === 'type_identifier')?.text ??
        (node.type === 'companion_object' ? 'Companion' : enclosing);
      visitBody(node, name, c);
    } else if (node.type === 'class_body' || node.type === 'enum_class_body') {
      visitBody(node, enclosing, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds imports and function and method calls in a Kotlin file. */
export function extractKotlinEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'kotlin');
  visitBody(root, undefined, collector);
  return collector.result();
}
