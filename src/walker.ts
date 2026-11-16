import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface WalkOptions {
  /** Files larger than this many bytes are skipped. Default 1 MiB. */
  maxFileSize?: number;
}

export interface WalkedFile {
  /** POSIX-style path relative to the walk root. */
  path: string;
  absolutePath: string;
  size: number;
}

const DEFAULT_MAX_FILE_SIZE = 1_048_576;
const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);
const BINARY_SNIFF_BYTES = 8000;

/** A .gitignore plus the directory (relative to root, posix) it applies beneath. */
interface Rules {
  base: string;
  matcher: Ignore;
}

export async function walkFiles(root: string, opts: WalkOptions = {}): Promise<WalkedFile[]> {
  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const absRoot = path.resolve(root);

  let rootStat;
  try {
    rootStat = await fs.stat(absRoot);
  } catch {
    throw new Error(`walkFiles: root does not exist: ${absRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`walkFiles: root is not a directory: ${absRoot}`);
  }

  const results: WalkedFile[] = [];
  await walkDir(absRoot, '', [], maxFileSize, absRoot, results);
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}

async function loadRules(absDir: string, relDir: string): Promise<Rules | null> {
  try {
    const content = await fs.readFile(path.join(absDir, '.gitignore'), 'utf8');
    return { base: relDir, matcher: ignore().add(content) };
  } catch {
    return null;
  }
}

/** Deeper .gitignore files override shallower ones, so the last decisive answer wins. */
function isIgnored(rules: Rules[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const { base, matcher } of rules) {
    const local = base === '' ? relPath : relPath.slice(base.length + 1);
    const result = matcher.test(isDir ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

/**
 * Builds a predicate telling whether the walker would skip a POSIX path relative to `root`:
 * a path segment in the always-skipped set, or the path or an ancestor directory matched by
 * the root or a nested .gitignore. An fs event does not say whether a path is a file or a
 * directory, so the full path is tested as both. `.gitignore` files themselves are never
 * ignored, because editing one changes what the walker sees.
 */
export async function loadIgnoreFilter(root: string): Promise<(relativePath: string) => boolean> {
  const all: Rules[] = [];
  await collectRules(path.resolve(root), '', [], all);

  const rulesFor = (relPath: string): Rules[] =>
    all.filter(({ base }) => base === '' || relPath.startsWith(`${base}/`));

  return (relativePath) => {
    const segments = relativePath.split('/').filter((segment) => segment !== '');
    if (segments.some((segment) => ALWAYS_SKIPPED.has(segment))) return true;
    if (segments.at(-1) === '.gitignore') return false;

    for (let end = 1; end < segments.length; end++) {
      const ancestor = segments.slice(0, end).join('/');
      if (isIgnored(rulesFor(ancestor), ancestor, true)) return true;
    }
    const full = segments.join('/');
    const rules = rulesFor(full);
    return isIgnored(rules, full, false) || isIgnored(rules, full, true);
  };
}

/** Gathers the .gitignore files the walker would read, descending only into directories it would enter. */
async function collectRules(
  absDir: string,
  relDir: string,
  parentRules: Rules[],
  out: Rules[],
): Promise<void> {
  const own = await loadRules(absDir, relDir);
  if (own) out.push(own);
  const rules = own ? [...parentRules, own] : parentRules;
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  for (const entry of entries) {
    if (ALWAYS_SKIPPED.has(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (isIgnored(rules, relPath, true)) continue;
    await collectRules(path.join(absDir, entry.name), relPath, rules, out);
  }
}

async function walkDir(
  absDir: string,
  relDir: string,
  parentRules: Rules[],
  maxFileSize: number,
  absRoot: string,
  out: WalkedFile[],
): Promise<void> {
  const own = await loadRules(absDir, relDir);
  const rules = own ? [...parentRules, own] : parentRules;
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  for (const entry of entries) {
    if (ALWAYS_SKIPPED.has(entry.name) || entry.isSymbolicLink()) continue;
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      if (isIgnored(rules, relPath, true)) continue;
      await walkDir(absPath, relPath, rules, maxFileSize, absRoot, out);
    } else if (entry.isFile()) {
      if (isIgnored(rules, relPath, false)) continue;
      const { size } = await fs.stat(absPath);
      if (size > maxFileSize) continue;
      if (await looksBinary(absPath)) continue;
      out.push({ path: relPath, absolutePath: absPath, size });
    }
  }
}

async function looksBinary(absPath: string): Promise<boolean> {
  const handle = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
