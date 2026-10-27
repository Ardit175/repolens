import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/go-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Go chunking', () => {
  it('finds functions, methods, structs, interfaces and grouped types', async () => {
    const chunks = await chunkFile('shapes.go', 'go', fixture('shapes.go'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'class:Circle',
      'function:NewCircle',
      'method:Circle.Area',
      'method:Circle.String',
      'class:Stack',
      'method:Stack.Push',
      'type:ID',
      'type:Names',
    ]);
  });

  it('includes doc comments, with 1-based line ranges', async () => {
    const chunks = await chunkFile('shapes.go', 'go', fixture('shapes.go'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape')).toEqual([8, 11]);
    expect(range('Circle')).toEqual([13, 17]);
    expect(range('NewCircle')).toEqual([19, 22]);
    expect(range('Area')).toEqual([24, 27]);
    expect(range('ID')).toEqual([45, 46]);
    expect(range('Names')).toEqual([47, 47]);
    const circle = chunks.find((c) => c.name === 'Circle')!;
    expect(circle.content.startsWith('// Circle is a round shape.\n// It stores')).toBe(true);
  });

  it('resolves the receiver type for pointer, value and generic receivers', async () => {
    const chunks = await chunkFile('shapes.go', 'go', fixture('shapes.go'));
    const parentOf = (name: string) => chunks.find((c) => c.name === name)!.parent;
    expect(parentOf('Area')).toBe('Circle');
    expect(parentOf('String')).toBe('Circle');
    expect(parentOf('Push')).toBe('Stack');
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('doc.go', 'go', 'package geometry\n');
    expect(summary(chunks)).toEqual(['file:doc.go']);
  });
});
