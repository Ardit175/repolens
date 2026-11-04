import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/kotlin-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Kotlin chunking', () => {
  it('finds interfaces, classes, enums, objects, functions and methods', async () => {
    const chunks = await chunkFile('shapes.kt', 'kotlin', fixture('shapes.kt'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'method:Shape.area',
      'class:Circle',
      'method:Circle.unit',
      'method:Circle.area',
      'class:Companion',
      'method:Companion.create',
      'class:Point',
      'enum:Color',
      'method:Color.label',
      'class:Registry',
      'method:Registry.size',
      'function:totalArea',
    ]);
  });

  it('includes leading comments and annotations and stops type chunks at the first member', async () => {
    const chunks = await chunkFile('shapes.kt', 'kotlin', fixture('shapes.kt'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape')).toEqual([7, 8]);
    expect(range('Circle')).toEqual([12, 14]);
    expect(range('unit')).toEqual([15, 18]);
    expect(range('Companion')).toEqual([24, 26]);
    expect(range('Point')).toEqual([31, 31]);
    expect(range('Color')).toEqual([33, 36]);
    expect(range('totalArea')).toEqual([44, 47]);
    const circle = chunks.find((c) => c.name === 'Circle')!;
    expect(circle.content.startsWith('/** A round shape. */\n@Suppress')).toBe(true);
  });

  it('sets the parent of nested type members to the nearest type', async () => {
    const src = 'class A {\n  class B {\n    fun f() {}\n  }\n  fun g() {}\n}\n';
    expect(summary(await chunkFile('a.kt', 'kotlin', src))).toEqual([
      'class:A',
      'class:B',
      'method:B.f',
      'method:A.g',
    ]);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('app.kts', 'kotlin', 'println("hi")\n');
    expect(summary(chunks)).toEqual(['file:app.kts']);
  });
});
