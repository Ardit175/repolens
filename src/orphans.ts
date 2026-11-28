import path from 'node:path';
import { isTestFile, sourceStem } from './affected-tests.js';
import { normalisePath } from './deps.js';
import type { GraphStore } from './graph/types.js';
import { detectLanguage, type Language } from './language.js';
import { compare, loadFileLinks, type FileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export interface UnimportedFile {
  path: string;
  language: Language;
  /** How many resolved imports the file itself makes: a leaf has few, a dead subtree many. */
  imports: number;
}

export interface UnimportedFiles {
  /** Ordered by path, cut to MAX_UNIMPORTED_FILES. */
  files: UnimportedFile[];
  /** Counted before the cut. */
  total: number;
  /** Files considered, after the filters and the entry-point exclusions. */
  checked: number;
  /** Indexed files left out because their language or file kind is used without a path-resolvable import. */
  skipped: number;
  /** True when `total` is larger than `files.length`. */
  truncated: boolean;
}

export interface UnimportedFilesInput {
  /** Only report files under this directory prefix. Imports are still counted everywhere. */
  pathPrefix?: string;
  /** Only report files of this language, e.g. `typescript`. */
  language?: string;
  /** Also report test files. Imports from test files count as uses either way. */
  includeTests?: boolean;
  /** Reuse links that were already loaded instead of reading the index again. */
  links?: FileLinks;
}

export const MAX_UNIMPORTED_FILES = 200;

/**
 * Languages where a file can only be used after an import that resolves to its path. The rest are
 * left out on purpose: Java, Kotlin and Scala classes in the same package are used without an
 * import; PHP classes in the same namespace need no `use` and are autoloaded; Rust modules are
 * reached by `mod x;`, which is not stored as an edge; C# and Swift have no path resolution.
 */
const CHECKED_LANGUAGES: ReadonlySet<Language> = new Set<Language>([
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'ruby',
  'go',
  'c',
  'cpp',
]);

const C_FAMILY: ReadonlySet<Language> = new Set<Language>(['c', 'cpp']);
const HEADER_EXTENSIONS: ReadonlySet<string> = new Set(['.h', '.hpp', '.hh', '.hxx']);

/** File stems (lower-cased, extension stripped) of files that are run or loaded by convention. */
const ENTRY_STEMS: ReadonlySet<string> = new Set([
  'main',
  'index',
  'cli',
  'app',
  'server',
  '__main__',
  '__init__',
  'setup',
  'conftest',
  'manage',
  'wsgi',
  'asgi',
  'lib',
  'mod',
]);

/** Directories whose files are run as programs or read as samples, not imported. */
const ENTRY_DIRS: ReadonlySet<string> = new Set(['bin', 'scripts', 'examples']);

const CONFIG_FILE = /\.config\.[^.]+$/i;

const ORPHANS_NOTE =
  'Only TS/JS, Python, Ruby, Go and C/C++ headers are checked, and imports resolve by path only, so files reached through packages, dynamic imports or framework conventions can show up here. They are candidates, not proof.';

/** True for a C or C++ file that is not a header: it is compiled, never included. */
function isCompiledSource(file: string, language: Language): boolean {
  return C_FAMILY.has(language) && !HEADER_EXTENSIONS.has(path.posix.extname(file).toLowerCase());
}

/** True when imports of the file can be checked: a checked language, and not a compiled source. */
function isCheckable(file: string, language: Language | undefined): language is Language {
  return (
    language !== undefined && CHECKED_LANGUAGES.has(language) && !isCompiledSource(file, language)
  );
}

/** True when the file's stem is a conventional entry point such as `main`, `index` or `cli`. */
function hasEntryStem(file: string): boolean {
  return ENTRY_STEMS.has(sourceStem(file));
}

/** True when the file sits in a `bin/`, `scripts/` or `examples/` directory at any depth. */
function isInEntryDirectory(file: string): boolean {
  return path.posix
    .dirname(file)
    .split('/')
    .some((dir) => ENTRY_DIRS.has(dir));
}

/** True for tool configuration such as `vite.config.ts`, which the tool loads by name. */
function isConfigFile(file: string): boolean {
  return CONFIG_FILE.test(path.posix.basename(file));
}

/**
 * True for a Go file in a directory that holds an indexed `main.go`. Those files belong to a
 * `package main` that is run as a program, and files of one Go package never import each other.
 */
function isInGoMainPackage(file: string, indexed: ReadonlySet<string>): boolean {
  if (detectLanguage(file) !== 'go') return false;
  const dir = path.posix.dirname(file);
  return indexed.has(dir === '.' ? 'main.go' : `${dir}/main.go`);
}

/** True when the file is run, loaded by a tool or part of a program rather than imported. */
function isEntryPoint(file: string, indexed: ReadonlySet<string>): boolean {
  return (
    hasEntryStem(file) ||
    isInEntryDirectory(file) ||
    isConfigFile(file) ||
    isInGoMainPackage(file, indexed)
  );
}

/**
 * The indexed source files that no other indexed file imports, as candidates for dead files.
 * Only languages whose imports resolve by path are checked, test files and entry points are
 * left out, and a file reached through a package, a namespace or a framework convention shows
 * up here too, so the result lists candidates, not proven dead files.
 */
export async function getUnimportedFiles(
  store: VectorStore,
  graph: GraphStore,
  input: UnimportedFilesInput = {},
): Promise<UnimportedFiles> {
  const prefix = input.pathPrefix === undefined ? '' : normalisePath(input.pathPrefix);
  const links = input.links ?? (await loadFileLinks(store, graph));

  const importedFiles = new Set(links.resolved.map((link) => link.to));
  const importsMade = new Map<string, number>();
  for (const link of links.resolved) {
    importsMade.set(link.from, (importsMade.get(link.from) ?? 0) + 1);
  }

  const unimported: UnimportedFile[] = [];
  let checked = 0;
  let skipped = 0;
  for (const file of [...links.indexed].sort(compare)) {
    if (!file.startsWith(prefix)) continue;
    const language = detectLanguage(file);
    if (input.language !== undefined && language !== input.language) continue;
    if (!isCheckable(file, language)) {
      skipped++;
      continue;
    }
    if (input.includeTests !== true && isTestFile(file)) continue;
    if (isEntryPoint(file, links.indexed)) continue;
    checked++;
    if (importedFiles.has(file)) continue;
    unimported.push({ path: file, language, imports: importsMade.get(file) ?? 0 });
  }
  const files = unimported.slice(0, MAX_UNIMPORTED_FILES);
  return {
    files,
    total: unimported.length,
    checked,
    skipped,
    truncated: unimported.length > files.length,
  };
}

/** Renders the unimported files as text for the terminal and for MCP clients. */
export function formatUnimportedFiles(result: UnimportedFiles): string {
  const lines = [`Unimported files (${result.total}) of ${result.checked} files checked:`];
  if (result.files.length === 0) lines.push('  (none)');
  for (const f of result.files) {
    lines.push(`  ${f.path} (${f.language}, imports ${f.imports})`);
  }
  if (result.truncated) {
    lines.push(`... truncated: showing ${result.files.length} of ${result.total}`);
  }
  if (result.skipped > 0) {
    lines.push(
      `Skipped ${result.skipped} files whose language or kind is used without a path-resolvable import (for example JVM, PHP, Rust, C#, Swift, C/C++ sources).`,
    );
  }
  lines.push(ORPHANS_NOTE);
  return lines.join('\n');
}
