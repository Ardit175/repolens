import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const source = readFileSync(
  new URL('../../test/fixtures/py-basic/shapes.py', import.meta.url),
  'utf8',
);
const chunk = () => chunkFile('shapes.py', 'python', source);

describe('Python chunking', () => {
  it('finds functions, classes and their direct methods', async () => {
    const chunks = await chunk();
    expect(chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`)).toEqual([
      'function:distance',
      'function:tagged',
      'class:Circle',
      'method:Circle.unit',
      'method:Circle.area',
      'class:Square',
      'method:Square.area',
    ]);
  });

  it('reports 1-based line ranges', async () => {
    const chunks = await chunk();
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('distance')).toEqual([5, 7]);
    expect(range('tagged')).toEqual([10, 15]);
    expect(range('unit')).toEqual([23, 26]);
    expect(range('area')).toEqual([28, 29]);
  });

  it('includes decorators and leading comments', async () => {
    const chunks = await chunk();
    const distance = chunks.find((c) => c.name === 'distance')!;
    expect(distance.content.startsWith('# Computes the distance')).toBe(true);
    const tagged = chunks.find((c) => c.name === 'tagged')!;
    expect(tagged.content.startsWith('@dataclass\ndef tagged')).toBe(true);
    const unit = chunks.find((c) => c.name === 'unit')!;
    expect(unit.content.startsWith('    # Builds a unit circle.\n    @staticmethod')).toBe(true);
  });

  it('keeps nested functions inside the enclosing chunk and handles async methods', async () => {
    const chunks = await chunk();
    expect(chunks.find((c) => c.name === 'tagged')!.content).toContain('def inner()');
    expect(chunks.some((c) => c.name === 'inner')).toBe(false);
    expect(
      chunks.find((c) => c.kind === 'method' && c.name === 'area' && c.parent === 'Circle'),
    ).toMatchObject({
      content: expect.stringContaining('async def area'),
    });
  });

  it('stops the class chunk before its first method', async () => {
    const chunks = await chunk();
    const circle = chunks.find((c) => c.kind === 'class' && c.name === 'Circle')!;
    expect(circle.content).toContain('"""A circle."""');
    expect(circle.content).toContain('radius = 1.0');
    expect(circle.content).not.toContain('unit');
    expect(circle.endLine).toBe(22);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('consts.py', 'python', 'A = 1\nB = 2\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ kind: 'file', name: 'consts.py', language: 'python' });
  });
});
