import path from 'node:path';
import { firstIndexed, uniqueSuffixMatch, type ImportResolver } from './paths.js';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

/** Extensions that a TypeScript import may name as `.js` while the file on disk is `.ts`. */
const JS_TO_SOURCE: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.jsx': ['.tsx', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};

/** Joins `relative` onto the directory of `from`; undefined when the result leaves the root. */
function joinFromDir(from: string, relative: string): string | undefined {
  const joined = path.posix.join(path.posix.dirname(from), relative);
  return joined === '..' || joined.startsWith('../') ? undefined : joined;
}

/** Resolves a relative TS/JS specifier against the set of indexed paths. */
export const resolveScript: ImportResolver = (edge, { indexed }) => {
  const specifier = edge.module;
  if (specifier === undefined || !specifier.startsWith('.')) return [];
  const base = joinFromDir(edge.path, specifier);
  if (base === undefined) return [];
  const candidates = [base];
  const ext = path.posix.extname(base);
  if (Object.hasOwn(JS_TO_SOURCE, ext)) {
    const stem = base.slice(0, -ext.length);
    for (const replacement of JS_TO_SOURCE[ext] ?? []) candidates.push(stem + replacement);
  }
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(base + extension);
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  const found = firstIndexed(candidates, indexed);
  return found === undefined ? [] : [found];
};

/** Candidate files for a Python module path such as `pkg/util`. */
function pythonFiles(modulePath: string): string[] {
  return [`${modulePath}.py`, `${modulePath}/__init__.py`];
}

/**
 * Candidates for a submodule named by `from <module> import <target>`: `pkg/mod.py` or
 * `pkg/mod/__init__.py`. Empty for `import x` and `from x import *`, which import the module.
 */
function pythonSubmoduleFiles(modulePath: string, target: string): string[] {
  return target === '*' || target.includes('.') ? [] : pythonFiles(`${modulePath}/${target}`);
}

/** Resolves `.mod` or `..pkg.mod` against the importing file's directory. */
function resolvePythonRelative(
  from: string,
  module: string,
  target: string,
  indexed: ReadonlySet<string>,
): string | undefined {
  const dots = module.length - module.replace(/^\.+/, '').length;
  const parts = module.slice(dots).split('.').filter(Boolean);
  let dir = path.posix.dirname(from);
  for (let i = 1; i < dots; i++) {
    if (dir === '.') return undefined;
    dir = path.posix.dirname(dir);
  }
  const modulePath = path.posix.join(dir, ...parts);
  // `from . import util` and `from .pkg import mod` name a submodule through the imported name.
  const own = parts.length === 0 ? [`${modulePath}/__init__.py`] : pythonFiles(modulePath);
  return firstIndexed(
    [...pythonSubmoduleFiles(modulePath, target), ...own].map((p) => path.posix.normalize(p)),
    indexed,
  );
}

/** Resolves an absolute dotted module, preferring a submodule named by the imported name. */
function resolvePythonAbsolute(
  module: string,
  target: string,
  indexed: ReadonlySet<string>,
): string | undefined {
  const modulePath = module.split('.').join('/');
  return (
    uniqueSuffixMatch(pythonSubmoduleFiles(modulePath, target), indexed) ??
    uniqueSuffixMatch(pythonFiles(modulePath), indexed)
  );
}

/** Resolves Python imports: relative by directory, absolute by dotted path with a unique suffix. */
export const resolvePython: ImportResolver = (edge, { indexed }) => {
  const module = edge.module;
  if (module === undefined) return [];
  const found = module.startsWith('.')
    ? resolvePythonRelative(edge.path, module, edge.target, indexed)
    : resolvePythonAbsolute(module, edge.target, indexed);
  return found === undefined ? [] : [found];
};

/** Resolves a C/C++ `#include` relative to the including file, then from the root, then by unique suffix. */
export const resolveInclude: ImportResolver = (edge, { indexed }) => {
  const module = edge.module;
  if (module === undefined) return [];
  const sibling = joinFromDir(edge.path, module);
  const found =
    firstIndexed(sibling === undefined ? [module] : [sibling, module], indexed) ??
    uniqueSuffixMatch([module], indexed);
  return found === undefined ? [] : [found];
};

/** Resolves Ruby `require` and `require_relative`: by directory, then `lib/` and the root, then by unique suffix. */
export const resolveRuby: ImportResolver = (edge, { indexed }) => {
  const module = edge.module;
  if (module === undefined) return [];
  const file = module.endsWith('.rb') ? module : `${module}.rb`;
  const sibling = joinFromDir(edge.path, file);
  const explicitlyRelative = module.startsWith('./') || module.startsWith('../');
  const candidates = [
    ...(sibling === undefined ? [] : [sibling]),
    ...(explicitlyRelative ? [] : [`lib/${file}`, file]),
  ];
  const found =
    firstIndexed(candidates, indexed) ??
    (explicitlyRelative ? undefined : uniqueSuffixMatch([file], indexed));
  return found === undefined ? [] : [found];
};

/** Whether a PHP module is a `require`/`include` file path rather than a namespaced `use` name. */
function isPhpFilePath(module: string): boolean {
  return module.includes('/') || module.endsWith('.php');
}

/** PSR-4 style lookup: the longest namespace suffix that names exactly one indexed `.php` file. */
function resolvePhpNamespace(module: string, indexed: ReadonlySet<string>): string | undefined {
  const segments = module.split('\\').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const found = uniqueSuffixMatch([`${segments.slice(i).join('/')}.php`], indexed);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Resolves PHP `require`/`include` paths and namespaced `use` imports. */
export const resolvePhp: ImportResolver = (edge, { indexed }) => {
  const module = edge.module;
  if (module === undefined) return [];
  let found: string | undefined;
  if (isPhpFilePath(module)) {
    const sibling = joinFromDir(edge.path, module);
    found = firstIndexed(sibling === undefined ? [module] : [sibling, module], indexed);
  } else {
    found = resolvePhpNamespace(module, indexed);
  }
  return found === undefined ? [] : [found];
};
