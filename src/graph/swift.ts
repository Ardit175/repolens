import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Standard library functions and type conversions that say nothing about the codebase. */
const NOISE = new Set([
  'print',
  'debugPrint',
  'dump',
  'fatalError',
  'precondition',
  'preconditionFailure',
  'assert',
  'assertionFailure',
  'min',
  'max',
  'abs',
  'zip',
  'stride',
  'swap',
  'type',
  'String',
  'Int',
  'Double',
  'Float',
  'Bool',
  'Array',
  'Dictionary',
  'Set',
  'Character',
]);

const TYPES = new Set(['class_declaration', 'protocol_declaration']);

/** Nodes that hold member declarations. The parser wraps some members in an ERROR node. */
const BODIES = new Set(['class_body', 'enum_class_body', 'protocol_body', 'ERROR']);

/** Records the import of one `import_declaration`: `import Foo`, `import struct Foo.Bar`. */
function addImport(declaration: Node, c: EdgeCollector): void {
  const path = declaration.namedChildren.find((n) => n?.type === 'identifier');
  const last = path?.namedChildren.at(-1)?.text;
  if (path && last) c.addImport(last, path.text, declaration);
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

/** The declared type name. For `extension Foo.Bar` this is the extended type, `Bar`. */
function typeName(declaration: Node): string | undefined {
  for (const child of declaration.namedChildren) {
    if (child?.type === 'type_identifier') return child.text;
    if (child?.type === 'user_type') return child.namedChildren.at(-1)?.text;
  }
  return undefined;
}

/** Records imports and calls in a subtree. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'import_declaration') {
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
    if (node.type === 'function_declaration' || node.type === 'init_declaration') {
      const from =
        node.type === 'init_declaration'
          ? 'init'
          : node.namedChildren.find((n) => n?.type === 'simple_identifier')?.text;
      const scope: Scope =
        from && enclosing ? { from, fromParent: enclosing } : from ? { from } : {};
      visit(node, scope, c);
    } else if (TYPES.has(node.type)) {
      visitBody(node, typeName(node) ?? enclosing, c);
    } else if (BODIES.has(node.type)) {
      visitBody(node, enclosing, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds imports and function, method and initializer calls in a Swift file. */
export function extractSwiftEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'swift');
  visitBody(root, undefined, collector);
  return collector.result();
}
