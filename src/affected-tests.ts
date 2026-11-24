import path from 'node:path';
import type { GraphStore } from './graph/types.js';
import { normalisePath, UnknownFileError } from './deps.js';
import { getChangeImpact, type ChangeImpact } from './impact.js';
import { detectLanguage, hasKnownExtension } from './language.js';
import { compare, loadFileLinks } from './map/links.js';
import type { VectorStore } from './store/types.js';

export type TestReasonKind = 'changed' | 'imports' | 'calls' | 'name';

export interface TestReason {
  kind: TestReasonKind;
  /** The changed file that led to this test. */
  changed: string;
  /** imports: 1 for a direct import of the changed file, 2+ for an import through other files. */
  depth?: number;
  /** imports beyond depth 1: the file one level closer to the changed file. */
  via?: string;
  /** calls: number of call sites to the changed file's symbols. */
  calls?: number;
  /** calls: true when the test file does not import the changed file (name match only, may be unrelated). */
  nameOnly?: boolean;
}

export interface AffectedTest {
  path: string;
  reasons: TestReason[];
}

export interface AffectedTests {
  /** Normalised, deduplicated, in input order. */
  changed: string[];
  /** Normalised, deduplicated, in input order: requested paths that are not indexed. Needs `skipUnknown`. */
  skipped: string[];
  tests: AffectedTest[];
  /** Total before the MAX_AFFECTED_TESTS cut. */
  total: number;
  /** True when tests were cut or when an impact lookup left links out because of a limit. */
  truncated: boolean;
}

export interface AffectedTestsInput {
  paths: string[];
  /** How many import levels to follow, from 1 to MAX_TESTS_DEPTH. */
  depth?: number;
  /** Record paths that are not indexed in `skipped` instead of throwing. Default false. */
  skipUnknown?: boolean;
}

export const DEFAULT_TESTS_DEPTH = 3;
export const MAX_TESTS_DEPTH = 5;
export const MAX_CHANGED_FILES = 50;
export const MAX_AFFECTED_TESTS = 200;

const NOTE =
  'Picked by import links, call sites (matched by name) and test file naming conventions.';
const NON_TEST_DIRS = new Set(['fixtures', '__fixtures__', 'testdata', '__snapshots__']);
const TEST_DIRS = new Set(['tests', 'test', 'spec']);

/** Filename patterns; group 1 is the name of the tested file. */
const NAME_PATTERNS: RegExp[] = [
  /^(.+)\.(?:test|spec)\.[^.]+$/,
  /^test_(.+)\.py$/,
  /^(.+)_test\.py$/,
  /^(.+)_test\.go$/,
  /^(.+)_(?:spec|test)\.rb$/,
  /^test_(.+)\.rb$/,
  /^(.+)_test\.(?:rs|c|cc|cpp|cxx)$/,
  /^test_(.+)\.(?:c|cc|cpp|cxx|rs)$/,
  /^(.+?)(?:Tests|Test|Spec)\.(?:java|kt|scala|cs|swift|php)$/,
];

function stripExtension(name: string): string {
  return path.posix.parse(name).name;
}

/** The part of the basename that names the tested file, when the basename follows a convention. */
function nameMatch(base: string): string | undefined {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(base);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function isTestDirectory(filePath: string): boolean {
  const dirs = path.posix.dirname(filePath).split('/');
  if (dirs.includes('__tests__')) return true;
  return dirs.some((dir) => TEST_DIRS.has(dir)) && hasKnownExtension(filePath);
}

/**
 * True for paths that look like test files: a test naming convention of a common language, or a
 * test directory. Files under fixture, test data and snapshot directories are never tests.
 */
export function isTestFile(filePath: string): boolean {
  const dirs = path.posix.dirname(filePath).split('/');
  if (dirs.some((dir) => NON_TEST_DIRS.has(dir))) return false;
  return nameMatch(path.posix.basename(filePath)) !== undefined || isTestDirectory(filePath);
}

/** The lower-cased stem of the file a test most likely covers, or undefined for a non-test. */
export function testSubject(filePath: string): string | undefined {
  if (!isTestFile(filePath)) return undefined;
  const matched = nameMatch(path.posix.basename(filePath));
  return (matched ?? stripExtension(path.posix.basename(filePath))).toLowerCase();
}

/** The lower-cased basename without its last extension: what a test's subject is compared to. */
export function sourceStem(filePath: string): string {
  return stripExtension(path.posix.basename(filePath)).toLowerCase();
}

function reasonRank(reason: TestReason): number {
  switch (reason.kind) {
    case 'changed':
      return 0;
    case 'imports':
      return reason.depth === 1 ? 1 : 3;
    case 'name':
      return 2;
    case 'calls':
      return reason.nameOnly === true ? 4 : 1;
  }
}

function reasonKey(reason: TestReason): string {
  return `${reason.kind}\n${reason.changed}`;
}

function compareReasons(a: TestReason, b: TestReason): number {
  return reasonRank(a) - reasonRank(b) || compare(a.changed, b.changed);
}

/** Adds a reason unless the test already has one of that kind for that changed file. */
function addReason(reasons: Map<string, TestReason>, reason: TestReason): void {
  const key = reasonKey(reason);
  const known = reasons.get(key);
  if (known === undefined || (reason.depth ?? 0) < (known.depth ?? 0)) reasons.set(key, reason);
}

/** Number of leading directory segments two paths share. */
function sharedDirectories(a: string, b: string): number {
  const left = path.posix.dirname(a).split('/');
  const right = path.posix.dirname(b).split('/');
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++;
  return shared;
}

/**
 * The candidates nearest to `file` by directory. A common stem such as `index` or `utils` matches
 * tests all over a repository, so only those sharing the most leading directories are kept.
 */
function closestByDirectory<T extends { path: string }>(file: string, candidates: T[]): T[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    shared: sharedDirectories(file, candidate.path),
  }));
  const best = Math.max(...scored.map((entry) => entry.shared));
  return scored.filter((entry) => entry.shared === best).map((entry) => entry.candidate);
}

/**
 * The test files that should run after changing `paths`: tests that are themselves changed, that
 * import a changed file (up to `depth` levels), that call its symbols by name, or that are named
 * after it. Every test carries the reasons it was picked.
 */
export async function getAffectedTests(
  store: VectorStore,
  graph: GraphStore,
  input: AffectedTestsInput,
): Promise<AffectedTests> {
  if (input.paths.length === 0) throw new RangeError('at least one path is required');
  if (input.paths.length > MAX_CHANGED_FILES) {
    throw new RangeError(`at most ${MAX_CHANGED_FILES} paths are allowed`);
  }
  const depth = input.depth ?? DEFAULT_TESTS_DEPTH;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_TESTS_DEPTH) {
    throw new RangeError(`depth must be an integer from 1 to ${MAX_TESTS_DEPTH}`);
  }

  const links = await loadFileLinks(store, graph);
  const indexedTests = [...links.indexed]
    .filter(isTestFile)
    .sort(compare)
    .map((file) => ({
      path: file,
      subject: testSubject(file),
      language: detectLanguage(file),
    }));

  const changed: string[] = [];
  const skipped: string[] = [];
  const byTest = new Map<string, Map<string, TestReason>>();
  let impactTruncated = false;
  const reasonsOf = (test: string): Map<string, TestReason> => {
    const reasons = byTest.get(test) ?? new Map<string, TestReason>();
    byTest.set(test, reasons);
    return reasons;
  };

  for (const requested of input.paths) {
    let impact: ChangeImpact;
    try {
      impact = await getChangeImpact(
        store,
        graph,
        { path: requested, depth, unbounded: true },
        links,
      );
    } catch (error) {
      if (input.skipUnknown !== true || !(error instanceof UnknownFileError)) throw error;
      const unknown = normalisePath(requested);
      if (!skipped.includes(unknown)) skipped.push(unknown);
      continue;
    }
    const start = impact.path;
    if (changed.includes(start)) continue;
    changed.push(start);
    impactTruncated ||= impact.truncated;
    const startIsTest = isTestFile(start);

    if (startIsTest) addReason(reasonsOf(start), { kind: 'changed', changed: start });
    for (const file of impact.files) {
      if (!isTestFile(file.path)) continue;
      const reasons = reasonsOf(file.path);
      if (file.importDepth !== undefined) {
        addReason(reasons, {
          kind: 'imports',
          changed: start,
          depth: file.importDepth,
          ...(file.via !== undefined ? { via: file.via } : {}),
        });
      }
      if (file.calls.length > 0) {
        addReason(reasons, {
          kind: 'calls',
          changed: start,
          calls: file.calls.length,
          ...(file.link === 'name-only' ? { nameOnly: true } : {}),
        });
      }
    }
    if (startIsTest) continue;
    const stem = sourceStem(start);
    const language = detectLanguage(start);
    const candidates = indexedTests.filter(
      (test) => test.subject === stem && test.language === language,
    );
    for (const test of closestByDirectory(start, candidates)) {
      addReason(reasonsOf(test.path), { kind: 'name', changed: start });
    }
  }

  const all: AffectedTest[] = [...byTest]
    .map(([file, reasons]) => ({ path: file, reasons: [...reasons.values()].sort(compareReasons) }))
    .sort(
      (a, b) =>
        reasonRank(a.reasons[0]!) - reasonRank(b.reasons[0]!) ||
        b.reasons.length - a.reasons.length ||
        compare(a.path, b.path),
    );

  return {
    changed,
    skipped,
    tests: all.slice(0, MAX_AFFECTED_TESTS),
    total: all.length,
    truncated: all.length > MAX_AFFECTED_TESTS || impactTruncated,
  };
}

function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : many}`;
}

function describeReason(reason: TestReason): string {
  switch (reason.kind) {
    case 'changed':
      return 'is a changed file';
    case 'imports':
      return reason.depth === 1 || reason.depth === undefined
        ? `imports ${reason.changed} directly`
        : `imports ${reason.changed} at depth ${reason.depth} via ${reason.via}`;
    case 'name':
      return `named after ${reason.changed}`;
    case 'calls': {
      const calls = `makes ${plural(reason.calls ?? 0, 'call')} into ${reason.changed}`;
      return reason.nameOnly === true
        ? `${calls} by name only (no import, may be unrelated)`
        : calls;
    }
  }
}

/** Renders affected tests as text for the terminal and for MCP clients. */
export function formatAffectedTests(result: AffectedTests): string {
  const changed = result.changed.length === 0 ? '(none)' : result.changed.join(', ');
  const lines = [`Changed (${result.changed.length}): ${changed}`];
  if (result.skipped.length > 0) {
    lines.push(`Skipped (not indexed, ${result.skipped.length}): ${result.skipped.join(', ')}`);
  }
  lines.push(`Tests to run (${result.total}):`);
  if (result.tests.length === 0) {
    lines.push(
      '  (none). No indexed test file imports, calls or is named after the changed files.',
    );
  }
  for (const test of result.tests) {
    lines.push(`  ${test.path}`, ...test.reasons.map((r) => `    ${describeReason(r)}`));
  }
  if (result.total > result.tests.length) {
    lines.push(`... truncated: showing ${MAX_AFFECTED_TESTS} of ${result.total}`);
  } else if (result.truncated) {
    lines.push('... some links were left out because of a limit');
  }
  lines.push(NOTE);
  return lines.join('\n');
}
