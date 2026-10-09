import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';
import { fallbackChunks } from './fallback.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('TypeScript chunking', () => {
  it('finds every top-level symbol and class method', async () => {
    const chunks = await chunkFile('shapes.ts', 'typescript', fixture('ts-basic/shapes.ts'));
    expect(summary(chunks)).toEqual([
      'interface:Point',
      'type:Shape',
      'enum:Color',
      'function:distance',
      'function:area',
      'class:Circle',
      'method:Circle.area',
      'method:Circle.name',
      'class:Square',
      'method:Square.constructor',
      'method:Square.area',
    ]);
  });

  it('includes leading comments and reports 1-based line ranges', async () => {
    const chunks = await chunkFile('shapes.ts', 'typescript', fixture('ts-basic/shapes.ts'));
    const distance = chunks.find((c) => c.name === 'distance')!;
    expect(distance.content.startsWith('/**\n * Computes')).toBe(true);
    expect(distance.content.endsWith('}')).toBe(true);
    expect(distance.startLine).toBe(16);
    expect(distance.endLine).toBe(21);
    const method = chunks.find((c) => c.parent === 'Circle' && c.name === 'area')!;
    expect(method.content.startsWith('  // Returns the circle area.')).toBe(true);
  });

  it('stops the class chunk before its first method', async () => {
    const chunks = await chunkFile('shapes.ts', 'typescript', fixture('ts-basic/shapes.ts'));
    const circle = chunks.find((c) => c.kind === 'class' && c.name === 'Circle')!;
    expect(circle.content).toContain('radius = 1;');
    expect(circle.content).not.toContain('Math.PI');
  });

  it('gives identical content an identical hash and different content a different one', async () => {
    const a = await chunkFile('a.ts', 'typescript', 'function f() { return 1; }');
    const b = await chunkFile('b.ts', 'typescript', 'function f() { return 1; }');
    const c = await chunkFile('c.ts', 'typescript', 'function f() { return 2; }');
    expect(a[0]!.hash).toBe(b[0]!.hash);
    expect(a[0]!.hash).not.toBe(c[0]!.hash);
    expect(a[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles TSX', async () => {
    const chunks = await chunkFile('view.tsx', 'tsx', fixture('ts-basic/view.tsx'));
    expect(summary(chunks)).toEqual(['function:Greeting']);
  });
});

describe('JavaScript chunking', () => {
  it('finds functions, function expressions and classes', async () => {
    const chunks = await chunkFile('util.js', 'javascript', fixture('js-basic/util.js'));
    expect(summary(chunks)).toEqual([
      'function:add',
      'function:double',
      'class:Counter',
      'method:Counter.increment',
    ]);
    expect(chunks[0]!.content.startsWith('// Adds two numbers.')).toBe(true);
  });

  it('handles JSX', async () => {
    const chunks = await chunkFile('Button.jsx', 'jsx', fixture('js-basic/Button.jsx'));
    expect(summary(chunks)).toEqual(['function:Button']);
  });
});

describe('fallback chunking', () => {
  it('is used for unsupported languages', async () => {
    const chunks = await chunkFile('notes.md', 'markdown', '# Title\n\nSome text\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      kind: 'file',
      name: 'notes.md',
      language: 'markdown',
      startLine: 1,
      endLine: 3,
    });
  });

  it('is used when a supported file has no symbols', async () => {
    const chunks = await chunkFile('script.js', 'javascript', 'console.log(1);\n');
    expect(summary(chunks)).toEqual(['file:script.js']);
  });

  it('reports unknown language and splits long files into windows', () => {
    const source = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = fallbackChunks('dir/data.txt', undefined, source, 10);
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 10],
      [11, 20],
      [21, 25],
    ]);
    expect(chunks[0]!.language).toBe('unknown');
  });

  it('returns nothing for empty or blank files', async () => {
    expect(await chunkFile('empty.ts', 'typescript', '')).toEqual([]);
    expect(await chunkFile('blank.txt', undefined, '\n\n  \n')).toEqual([]);
  });
});
