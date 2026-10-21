import type { Node } from 'web-tree-sitter';
import { EdgeCollector, type Scope } from './collector.js';
import type { GraphEdge } from './types.js';

// Same top-level declarations the chunker turns into chunks.
const NAMED_DECLARATIONS = new Set([
  'function_declaration',
  'generator_function_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
]);
const CLASSES = new Set(['class_declaration', 'abstract_class_declaration']);
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

/** Module specifier without its quotes. */
function moduleOf(source: Node | null): string | undefined {
  return source?.text.slice(1, -1);
}

function addImports(node: Node, c: EdgeCollector): void {
  const module = moduleOf(node.childForFieldName('source'));
  if (module === undefined) return;
  const clause = node.namedChildren.find((n) => n?.type === 'import_clause');
  if (!clause) {
    c.addImport('*', module, node); // import 'm'
    return;
  }
  for (const part of clause.namedChildren) {
    if (!part) continue;
    if (part.type === 'identifier') {
      c.addImport(part.text, module, part); // import foo from 'm'
    } else if (part.type === 'namespace_import') {
      c.addImport('*', module, part);
    } else if (part.type === 'named_imports') {
      for (const spec of part.namedChildren) {
        const name = spec?.childForFieldName('name');
        if (spec && name) c.addImport(name.text, module, spec); // original name, not the alias
      }
    }
  }
}

function addReExports(node: Node, c: EdgeCollector): void {
  const module = moduleOf(node.childForFieldName('source'));
  if (module === undefined) return;
  const clause = node.namedChildren.find((n) => n?.type === 'export_clause');
  if (!clause) {
    c.addImport('*', module, node); // export * from 'm'
    return;
  }
  for (const spec of clause.namedChildren) {
    const name = spec?.childForFieldName('name');
    if (spec && name) c.addImport(name.text, module, spec);
  }
}

/** `require('m')` as the value of a top-level declarator: records the import. */
function addRequire(declarator: Node, c: EdgeCollector): boolean {
  const value = declarator.childForFieldName('value');
  if (value?.type !== 'call_expression') return false;
  if (value.childForFieldName('function')?.text !== 'require') return false;
  const arg = value.childForFieldName('arguments')?.namedChildren[0];
  if (arg?.type !== 'string') return false;
  c.addImport('*', arg.text.slice(1, -1), value);
  return true;
}

/** The name node of a callee: `foo` in `foo()`, `a.b.foo()` and `new ns.Foo()`. */
function calleeName(callee: Node | null): Node | undefined {
  if (callee?.type === 'identifier') return callee;
  if (callee?.type === 'member_expression')
    return callee.childForFieldName('property') ?? undefined;
  return undefined;
}

/** Records calls in a subtree. Nested functions keep the scope of their enclosing chunk. */
function visit(node: Node, scope: Scope, c: EdgeCollector): void {
  if (node.type === 'call_expression' || node.type === 'new_expression') {
    const field = node.type === 'call_expression' ? 'function' : 'constructor';
    const name = calleeName(node.childForFieldName(field));
    if (name) c.addCall(name.text, name, scope);
  }
  for (const child of node.namedChildren) if (child) visit(child, scope, c);
}

function visitClass(cls: Node, name: string, c: EdgeCollector): void {
  for (const child of cls.namedChildren) {
    if (!child) continue;
    if (child.type !== 'class_body') {
      visit(child, { from: name }, c);
      continue;
    }
    for (const member of child.namedChildren) {
      if (!member) continue;
      const isMethod =
        member.type === 'method_definition' || member.type === 'abstract_method_signature';
      const methodName = isMethod ? member.childForFieldName('name')?.text : undefined;
      visit(member, methodName ? { from: methodName, fromParent: name } : { from: name }, c);
    }
  }
}

function visitTopLevel(node: Node, c: EdgeCollector): void {
  if (node.type === 'import_statement') return addImports(node, c);
  if (node.type === 'export_statement') {
    if (node.childForFieldName('source')) return addReExports(node, c);
    const decl = node.childForFieldName('declaration');
    return decl ? visitTopLevel(decl, c) : visit(node, {}, c);
  }
  const name = node.childForFieldName('name')?.text;
  if (CLASSES.has(node.type) && name) return visitClass(node, name, c);
  if (NAMED_DECLARATIONS.has(node.type) && name) return visit(node, { from: name }, c);
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (const declarator of node.namedChildren) {
      if (declarator?.type !== 'variable_declarator' || addRequire(declarator, c)) continue;
      const value = declarator.childForFieldName('value');
      const varName = declarator.childForFieldName('name')?.text;
      const isFunction = value && varName && FUNCTION_VALUES.has(value.type);
      visit(declarator, isFunction ? { from: varName } : {}, c);
    }
    return;
  }
  visit(node, {}, c);
}

/** Finds imports, re-exports and calls in a TypeScript or JavaScript file. */
export function extractTypeScriptEdges(root: Node, path: string): GraphEdge[] {
  const collector = new EdgeCollector(path, 'typescript');
  for (const node of root.namedChildren) if (node) visitTopLevel(node, collector);
  return collector.result();
}
