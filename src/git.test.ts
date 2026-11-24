import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changedFiles, GitError } from './git.js';

let repo: string;

function git(...args: string[]): void {
  execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { stdio: 'pipe' },
  );
}

function write(rel: string, content = 'x'): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(message: string): void {
  git('add', '-A');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', message);
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'repolens-git-'));
  git('init', '-b', 'main');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('changedFiles against HEAD', () => {
  it('lists modified, staged and untracked files, sorted', async () => {
    write('a.ts', '1');
    write('b.ts', '1');
    write('src/c.ts', '1');
    commitAll('init');
    write('a.ts', '2');
    write('b.ts', '2');
    git('add', 'b.ts');
    write('src/new.ts');
    expect(await changedFiles(repo)).toEqual(['a.ts', 'b.ts', 'src/new.ts']);
  });

  it('returns nothing for a clean tree', async () => {
    write('a.ts');
    commitAll('init');
    expect(await changedFiles(repo)).toEqual([]);
  });

  it('excludes ignored files', async () => {
    write('.gitignore', 'dist/\n');
    write('a.ts');
    commitAll('init');
    write('dist/out.js');
    write('b.ts');
    expect(await changedFiles(repo)).toEqual(['b.ts']);
  });

  it('includes deleted files', async () => {
    write('a.ts');
    write('b.ts');
    commitAll('init');
    rmSync(path.join(repo, 'a.ts'));
    expect(await changedFiles(repo)).toEqual(['a.ts']);
  });

  it('gives paths relative to a subdirectory root and skips files outside it', async () => {
    write('pkg/a.ts', '1');
    write('other/b.ts', '1');
    commitAll('init');
    write('pkg/a.ts', '2');
    write('pkg/deep/new.ts');
    write('other/b.ts', '2');
    expect(await changedFiles(path.join(repo, 'pkg'))).toEqual(['a.ts', 'deep/new.ts']);
  });

  it('keeps file names with spaces intact', async () => {
    write('a.ts');
    commitAll('init');
    write('my file.ts');
    expect(await changedFiles(repo)).toEqual(['my file.ts']);
  });

  it('returns untracked files in a repository without commits', async () => {
    write('a.ts');
    write('src/b.ts');
    expect(await changedFiles(repo)).toEqual(['a.ts', 'src/b.ts']);
  });
});

describe('changedFiles against a ref', () => {
  it('includes branch commits and uncommitted work but not newer commits on the ref', async () => {
    write('base.ts');
    commitAll('init');
    git('checkout', '-b', 'feature');
    write('feature.ts');
    commitAll('feature work');
    git('checkout', 'main');
    write('later-on-main.ts');
    commitAll('main moves on');
    git('checkout', 'feature');
    write('base.ts', 'edited');
    write('untracked.ts');
    expect(await changedFiles(repo, 'main')).toEqual(['base.ts', 'feature.ts', 'untracked.ts']);
  });

  it('throws a GitError for an unknown ref', async () => {
    write('a.ts');
    commitAll('init');
    await expect(changedFiles(repo, 'nope')).rejects.toThrow(
      new GitError('unknown git ref "nope"'),
    );
  });

  it('rejects a ref that starts with a dash without calling git with it', async () => {
    write('a.ts');
    commitAll('init');
    const attempt = changedFiles(repo, '--output=pwned.txt');
    await expect(attempt).rejects.toBeInstanceOf(GitError);
    await expect(attempt).rejects.toThrow('invalid git ref');
  });
});

describe('changedFiles outside a repository', () => {
  it('throws a GitError', async () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'repolens-nogit-'));
    try {
      await expect(changedFiles(plain)).rejects.toThrow(
        new GitError(`${plain} is not inside a git repository`),
      );
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
