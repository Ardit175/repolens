import path from 'node:path';
import type { ImportResolver } from './paths.js';
import { firstIndexed, uniqueSuffixMatch } from './paths.js';

const JVM_EXTENSIONS = ['.java', '.kt', '.kts', '.scala', '.sc'];

const RUST_ROOT_FILES: ReadonlySet<string> = new Set(['lib.rs', 'main.rs', 'mod.rs']);

/** Candidate source files for a dotted class name such as `com.acme.Circle`. */
function classFiles(dotted: string): string[] {
  const base = dotted.replaceAll('.', '/');
  return JVM_EXTENSIONS.map((extension) => base + extension);
}

/** The indexed file for a dotted class name, found under any source root. */
function findClass(dotted: string, indexed: ReadonlySet<string>): string | undefined {
  return uniqueSuffixMatch(classFiles(dotted), indexed);
}

/** The module without its last segment: `com.acme.Util` for `com.acme.Util.max`. */
function parentModule(dotted: string): string | undefined {
  const cut = dotted.lastIndexOf('.');
  return cut > 0 ? dotted.slice(0, cut) : undefined;
}

/** Every indexed JVM file directly inside a directory that is, or ends with, the package path. */
function packageFiles(dotted: string, indexed: ReadonlySet<string>): string[] {
  const packagePath = dotted.replaceAll('.', '/');
  return [...indexed]
    .filter((file) => JVM_EXTENSIONS.includes(path.posix.extname(file)))
    .filter((file) => {
      const dir = path.posix.dirname(file);
      return dir === packagePath || dir.endsWith(`/${packagePath}`);
    })
    .sort();
}

/**
 * Resolves Java, Kotlin and Scala imports, including across those languages. A class import
 * falls back to the enclosing class, which covers static imports and nested classes. A wildcard
 * names a class (`import static a.B.*`, `import a.B._`) or a package; a package resolves only
 * when all its files sit in one directory. Kotlin top-level functions and properties
 * (`import com.acme.util.helper`) live in a file whose name is free, so they stay unresolved.
 */
export const resolveJvm: ImportResolver = (edge, { indexed }) => {
  if (edge.module === undefined) return [];
  const asClass =
    findClass(edge.module, indexed) ??
    (edge.target === '*' ? undefined : findParentClass(edge.module, indexed));
  if (asClass !== undefined) return [asClass];
  if (edge.target !== '*') return [];
  const files = packageFiles(edge.module, indexed);
  const directories = new Set(files.map((file) => path.posix.dirname(file)));
  return directories.size === 1 ? files : [];
};

function findParentClass(dotted: string, indexed: ReadonlySet<string>): string | undefined {
  const parent = parentModule(dotted);
  return parent === undefined ? undefined : findClass(parent, indexed);
}

/** Picks the longest module path that equals the import or is a prefix of it. */
function matchGoModule(
  importPath: string,
  modules: ReadonlyMap<string, string>,
): { modulePath: string; dir: string } | undefined {
  let best: { modulePath: string; dir: string } | undefined;
  for (const [modulePath, dir] of modules) {
    const matches = importPath === modulePath || importPath.startsWith(`${modulePath}/`);
    if (matches && (!best || modulePath.length > best.modulePath.length)) {
      best = { modulePath, dir };
    }
  }
  return best;
}

/**
 * Resolves a Go import to the non-test `.go` files directly inside the package directory.
 * Standard library and third-party imports match no module and stay unresolved.
 */
export const resolveGo: ImportResolver = (edge, { indexed, goModules }) => {
  if (edge.module === undefined) return [];
  const match = matchGoModule(edge.module, goModules);
  if (!match) return [];
  const rest = edge.module.slice(match.modulePath.length + 1);
  const packageDir = path.posix.join(match.dir, rest);
  const dir = packageDir === '.' ? '' : packageDir;
  return [...indexed]
    .filter((file) => file.endsWith('.go') && !file.endsWith('_test.go'))
    .filter((file) => (path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)) === dir)
    .sort();
};

/** Joins path parts with `/`, skipping empty ones so the root directory stays `''`. */
function joinParts(...parts: string[]): string {
  return parts.filter((part) => part !== '').join('/');
}

function dirOf(file: string): string {
  const dir = path.posix.dirname(file);
  return dir === '.' ? '' : dir;
}

/** The crate source root: the file's path through its last `src` segment, else its directory. */
function rustCrateRoot(file: string): string {
  const segments = dirOf(file).split('/');
  const last = segments.lastIndexOf('src');
  return last === -1 ? dirOf(file) : segments.slice(0, last + 1).join('/');
}

/** The directory that holds the child modules of a file. */
function rustModuleDir(file: string): string {
  const name = path.posix.basename(file);
  return RUST_ROOT_FILES.has(name)
    ? dirOf(file)
    : joinParts(dirOf(file), name.replace(/\.rs$/, ''));
}

/** Where a `use` path starts and which segments remain, or undefined for non-local paths. */
function rustStart(segments: string[], file: string): { dir: string; rest: string[] } | undefined {
  const root = rustCrateRoot(file);
  const [first, ...after] = segments;
  if (first === 'crate') return { dir: root, rest: after };
  if (first === 'self') return { dir: rustModuleDir(file), rest: after };
  if (first !== 'super') return undefined;
  let dir = rustModuleDir(file);
  let rest = segments;
  while (rest[0] === 'super') {
    if (dir === root || !dir.startsWith(root)) return undefined;
    dir = dirOf(dir);
    rest = rest.slice(1);
  }
  return { dir, rest };
}

/** The file that defines the module living in `dir`: `lib.rs`/`main.rs` at the crate root. */
function rustModuleFile(
  dir: string,
  root: string,
  indexed: ReadonlySet<string>,
): string | undefined {
  const candidates =
    dir === root
      ? [joinParts(dir, 'lib.rs'), joinParts(dir, 'main.rs')]
      : [`${dir}.rs`, `${dir}/mod.rs`];
  return firstIndexed(candidates, indexed);
}

/**
 * Resolves a Rust `use` path that starts with `crate`, `self` or `super` to the module file it
 * names. Trailing segments that are items (`Circle`, `new`) are dropped until a module file is
 * indexed. A single item (`super::Shape`, `crate::Config`) resolves to the file of the module it
 * starts from. External crates and `std` stay unresolved.
 */
export const resolveRust: ImportResolver = (edge, { indexed }) => {
  if (edge.module === undefined) return [];
  const start = rustStart(edge.module.split('::'), edge.path);
  if (!start) return [];
  for (let count = start.rest.length; count > 0; count--) {
    const base = joinParts(start.dir, ...start.rest.slice(0, count));
    const found = firstIndexed([`${base}.rs`, `${base}/mod.rs`], indexed);
    if (found !== undefined) return [found];
  }
  if (start.rest.length !== 1) return [];
  const own = rustModuleFile(start.dir, rustCrateRoot(edge.path), indexed);
  return own === undefined || own === edge.path ? [] : [own];
};
