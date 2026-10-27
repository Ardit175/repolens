import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/**
 * Import target names:
 * - `import "net/http"` and `import h "net/http"` -> the alias, else the last path segment (`http`)
 * - `import . "net/http"` and `import _ "net/http"` -> `*`, since no single name is bound
 */
function addImport(spec: Node, c: EdgeCollector): void {
  const path = spec.childForFieldName('path');
  if (!path) return;
  const module = path.text.slice(1, -1);
  const alias = spec.childForFieldName('name')?.text;
  const named = alias && alias !== '.' && alias !== '_' ? alias : undefined;
  const target = named ?? (alias ? '*' : (module.split('/').pop() ?? module));
  c.addImport(target, module, spec);
}

/** The receiver's base type: `T` in `(t T)`, `(t *T)` and `(t *T[K])`. */
function receiverType(method: Node): string | undefined {
  const param = method.childForFieldName('receiver')?.namedChildren.find((n) => n !== null);
  let type = param?.childForFieldName('type') ?? null;
  if (type?.type === 'pointer_type') type = type.namedChildren[0] ?? null;
  if (type?.type === 'generic_type') type = type.childForFieldName('type');
  return type?.type === 'type_identifier' ? type.text : undefined;
}

/** The called name: `foo` in `foo()`, `Foo` in `pkg.Foo()` and `obj.Foo()`. */
function calleeName(call: Node): Node | undefined {
  const fn = call.childForFieldName('function');
  if (fn?.type === 'identifier') return fn;
  if (fn?.type === 'selector_expression') return fn.childForFieldName('field') ?? undefined;
  return undefined;
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'import_spec') return addImport(node, c);
  if (node.type === 'call_expression') {
    const name = calleeName(node);
    if (name) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

/** Finds imports and calls in a Go file. */
export function extractGoEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'go');
  for (const node of root.namedChildren) {
    if (!node) continue;
    const name = node.childForFieldName('name')?.text;
    let scope: Scope = {};
    if (node.type === 'function_declaration' && name) {
      scope = { from: name };
    } else if (node.type === 'method_declaration' && name) {
      const parent = receiverType(node);
      scope = parent ? { from: name, fromParent: parent } : { from: name };
    }
    visit(node, scope, collector);
  }
  return collector.result();
}
