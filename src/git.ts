import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** A git command failed in a way the user can fix: not a repository, unknown ref, git missing. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/** Runs git without a shell, so arguments are never interpreted. */
async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return stdout;
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((name) => name !== '');
}

async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** The commit to diff against: HEAD, or the merge base of `ref` and HEAD. */
async function diffBase(root: string, ref: string | undefined): Promise<string | undefined> {
  if (ref === undefined) return (await hasCommits(root)) ? 'HEAD' : undefined;
  if (ref.startsWith('-')) throw new GitError(`invalid git ref "${ref}"`);
  try {
    return (await git(root, ['merge-base', ref, 'HEAD'])).trim();
  } catch {
    throw new GitError(`unknown git ref "${ref}"`);
  }
}

/**
 * Files changed in the working tree, relative to `root` with posix separators, sorted.
 * Without `ref` the comparison is against HEAD (staged and unstaged changes). With a `ref` it is
 * against the merge base of `ref` and HEAD, so the branch's own commits are included but newer
 * commits on `ref` are not. Untracked files that are not ignored are always included.
 */
export async function changedFiles(root: string, ref?: string): Promise<string[]> {
  try {
    await git(root, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new GitError(`${root} is not inside a git repository`);
  }
  const base = await diffBase(root, ref);
  const tracked =
    base === undefined ? '' : await git(root, ['diff', '--name-only', '--relative', '-z', base]);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = [...splitNul(tracked), ...splitNul(untracked)].map((name) =>
    name.replaceAll('\\', '/'),
  );
  return [...new Set(names)].sort();
}
