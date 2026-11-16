import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadIgnoreFilter, walkFiles } from './walker.js';

let root: string;

async function write(rel: string, content: string | Buffer = 'x'): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function paths(opts?: Parameters<typeof walkFiles>[1]): Promise<string[]> {
  return (await walkFiles(root, opts)).map((f) => f.path);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'repolens-walker-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('walkFiles', () => {
  it('respects the root .gitignore', async () => {
    await write('.gitignore', '*.log\nbuild/\n');
    await write('a.ts');
    await write('debug.log');
    await write('build/out.js');
    await write('src/b.ts');
    expect(await paths()).toEqual(['.gitignore', 'a.ts', 'src/b.ts']);
  });

  it('applies a nested .gitignore only beneath its directory', async () => {
    await write('pkg/.gitignore', '/secret.txt\n*.tmp\n');
    await write('pkg/secret.txt');
    await write('pkg/keep.ts');
    await write('pkg/deep/x.tmp');
    await write('secret.txt');
    await write('other/secret.txt');
    await write('other/y.tmp');
    expect(await paths()).toEqual([
      'other/secret.txt',
      'other/y.tmp',
      'pkg/.gitignore',
      'pkg/keep.ts',
      'secret.txt',
    ]);
  });

  it('supports negation, including from a nested .gitignore', async () => {
    await write('.gitignore', '*.log\n!keep.log\n');
    await write('a.log');
    await write('keep.log');
    await write('sub/.gitignore', '!a.log\n');
    await write('sub/a.log');
    expect(await paths()).toEqual(['.gitignore', 'keep.log', 'sub/.gitignore', 'sub/a.log']);
  });

  it('skips binary files', async () => {
    await write('text.txt', 'hello');
    await write('image.bin', Buffer.from([1, 2, 0, 3]));
    expect(await paths()).toEqual(['text.txt']);
  });

  it('skips files over the size limit and honours a custom limit', async () => {
    await write('small.txt', 'a'.repeat(100));
    await write('big.txt', 'a'.repeat(1_048_577));
    expect(await paths()).toEqual(['small.txt']);
    expect(await paths({ maxFileSize: 50 })).toEqual([]);
    const files = await walkFiles(root, { maxFileSize: 2_000_000 });
    expect(files.map((f) => f.path)).toEqual(['big.txt', 'small.txt']);
    expect(files[1]?.size).toBe(100);
    expect(files[1]?.absolutePath).toBe(path.join(root, 'small.txt'));
  });

  it('always skips .git and node_modules', async () => {
    await write('.git/config');
    await write('node_modules/pkg/index.js');
    await write('sub/node_modules/x.js');
    await write('ok.ts');
    expect(await paths()).toEqual(['ok.ts']);
  });

  it('does not follow symlinks', async () => {
    await write('real/a.ts');
    await fs.symlink(path.join(root, 'real'), path.join(root, 'linkdir'));
    await fs.symlink(path.join(root, 'real/a.ts'), path.join(root, 'link.ts'));
    expect(await paths()).toEqual(['real/a.ts']);
  });

  it('throws a clear error when root is missing or not a directory', async () => {
    await expect(walkFiles(path.join(root, 'nope'))).rejects.toThrow(/does not exist/);
    await write('file.txt');
    await expect(walkFiles(path.join(root, 'file.txt'))).rejects.toThrow(/not a directory/);
  });

  it('returns results sorted by path', async () => {
    await write('b.ts');
    await write('a/z.ts');
    await write('a/b.ts');
    await write('c/d.ts');
    expect(await paths()).toEqual(['a/b.ts', 'a/z.ts', 'b.ts', 'c/d.ts']);
  });
});

describe('loadIgnoreFilter', () => {
  it('ignores always-skipped directories at any depth', async () => {
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('node_modules/x.js')).toBe(true);
    expect(ignored('pkg/node_modules/y/z.js')).toBe(true);
    expect(ignored('.git/HEAD')).toBe(true);
  });

  it('applies the root .gitignore to files and to ancestor directories', async () => {
    await write('.gitignore', 'dist/\n*.log\n');
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('dist')).toBe(true);
    expect(ignored('dist/out.js')).toBe(true);
    expect(ignored('a/dist/deep/out.js')).toBe(true);
    expect(ignored('debug.log')).toBe(true);
    expect(ignored('src/debug.log')).toBe(true);
    expect(ignored('src/a.ts')).toBe(false);
  });

  it('applies a nested .gitignore only beneath its directory', async () => {
    await write('pkg/.gitignore', '/secret.txt\n*.tmp\n');
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('pkg/secret.txt')).toBe(true);
    expect(ignored('pkg/a.tmp')).toBe(true);
    expect(ignored('secret.txt')).toBe(false);
    expect(ignored('other/a.tmp')).toBe(false);
  });

  it('honours negation, with deeper files overriding shallower ones', async () => {
    await write('.gitignore', '*.log\n!keep.log\n');
    await write('sub/.gitignore', '!debug.log\n');
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('keep.log')).toBe(false);
    expect(ignored('other.log')).toBe(true);
    expect(ignored('sub/debug.log')).toBe(false);
    expect(ignored('debug.log')).toBe(true);
  });

  it('never ignores .gitignore files themselves', async () => {
    await write('.gitignore', '.gitignore\n*.log\n');
    await write('pkg/.gitignore', 'x');
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('.gitignore')).toBe(false);
    expect(ignored('pkg/.gitignore')).toBe(false);
  });

  it('does not read .gitignore files inside ignored or skipped directories', async () => {
    await write('.gitignore', 'vendor/\n');
    await write('vendor/.gitignore', '*.ts\n');
    await write('node_modules/p/.gitignore', '*.ts\n');
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('src/a.ts')).toBe(false);
  });

  it('does not ignore ordinary files', async () => {
    const ignored = await loadIgnoreFilter(root);
    expect(ignored('src/a.ts')).toBe(false);
    expect(ignored('README.md')).toBe(false);
  });
});
