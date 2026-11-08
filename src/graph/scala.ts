import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

/** Standard library functions and constructors that say nothing about the codebase. */
const NOISE = new Set([
  'println',
  'print',
  'printf',
  'require',
  'assert',
  'assume',
  'ensuring',
  'sys',
  'List',
  'Seq',
  'Vector',
  'Array',
  'Map',
  'Set',
  'Some',
  'None',
  'Option',
  'Left',
  'Right',
  'Try',
  'Success',
  'Failure',
  'Future',
  'StringBuilder',
  'identity',
  'implicitly',
  'to',
  'until',
]);

const TYPES = new Set(['class_definition', 'object_definition', 'package_object']);
const FUNCTIONS = new Set(['function_definition', 'function_declaration']);

function identifiers(node: Node): Node[] {
  return node.namedChildren.filter((n): n is Node => n?.type === 'identifier');
}

/**
 * Records one `import_declaration`: `import a.B`, `import a.{B, C => D, _}`, `import a._`.
 * An import is recorded under the name it makes visible, or `*` for a wildcard.
 */
function addImport(declaration: Node, c: EdgeCollector): void {
  const children = declaration.namedChildren.filter((n): n is Node => n !== null);
  const path = children.find((n) => n.type === 'stable_identifier' || n.type === 'identifier');
  if (!path) return;
  const module = path.text;
  const selectors = children.find((n) => n.type === 'import_selectors');
  if (children.some((n) => n.type === 'wildcard')) {
    c.addImport('*', module, declaration);
  } else if (selectors) {
    for (const selector of selectors.namedChildren) {
      if (!selector) continue;
      if (selector.type === 'renamed_identifier') {
        const alias = identifiers(selector)[1];
        if (alias && alias.text !== '_') c.addImport(alias.text, module, declaration);
      } else if (selector.type === 'wildcard' || selector.text === '_') {
        c.addImport('*', module, declaration);
      } else {
        c.addImport(selector.text, module, declaration);
      }
    }
  } else {
    const last = (path.type === 'stable_identifier' ? path.namedChildren.at(-1) : path)?.text;
    if (last) c.addImport(last, module, declaration);
  }
}

/** The called name: `foo` in `foo(x)` and `foo[T](x)`, `bar` in `a.b.bar(x)`. `new Foo(x)` calls Foo. */
function calleeName(call: Node): Node | undefined {
  let fn = call.namedChildren[0];
  if (fn?.type === 'generic_function') fn = fn.namedChildren[0];
  if (fn?.type === 'identifier') return fn;
  if (fn?.type === 'field_expression') {
    const name = fn.namedChildren.at(-1);
    return name?.type === 'identifier' ? name : undefined;
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
  } else if (node.type === 'instance_expression') {
    // `new Foo` without arguments has the type name directly under the expression.
    const name = node.namedChildren[0];
    if (name?.type === 'identifier' && !NOISE.has(name.text)) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitBody(parent: Node, enclosing: string | undefined, c: EdgeCollector): void {
  for (const node of parent.namedChildren) {
    if (!node) continue;
    if (FUNCTIONS.has(node.type)) {
      const from = identifiers(node)[0]?.text;
      const scope: Scope =
        from && enclosing ? { from, fromParent: enclosing } : from ? { from } : {};
      visit(node, scope, c);
    } else if (node.type === 'trait_definition') {
      // A trait is a single chunk, so calls anywhere in it belong to the trait itself.
      const name = identifiers(node)[0]?.text;
      visit(node, name ? { from: name } : {}, c);
    } else if (TYPES.has(node.type)) {
      visitBody(node, identifiers(node)[0]?.text ?? enclosing, c);
    } else if (node.type === 'template_body' || node.type === 'package_clause') {
      visitBody(node, enclosing, c);
    } else {
      visit(node, {}, c);
    }
  }
}

/** Finds imports and function, method and constructor calls in a Scala file. */
export function extractScalaEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'scala');
  visitBody(root, undefined, collector);
  return collector.result();
}
