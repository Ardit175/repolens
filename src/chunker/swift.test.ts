import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/swift-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Swift chunking', () => {
  it('finds protocols, structs, classes, enums, extensions, functions and methods', async () => {
    const chunks = await chunkFile('shapes.swift', 'swift', fixture('shapes.swift'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'class:Point',
      'class:Circle',
      'method:Circle.init',
      'method:Circle.deinit',
      'method:Circle.area',
      'class:Style',
      'method:Style.name',
      'enum:Color',
      'method:Color.label',
      'class:Circle',
      'method:Circle.unit',
      'function:totalArea',
    ]);
  });

  it('includes leading comments and attributes and stops type chunks at the first member', async () => {
    const chunks = await chunkFile('shapes.swift', 'swift', fixture('shapes.swift'));
    const range = (name: string, kind = 'class') => {
      const c = chunks.find((x) => x.name === name && x.kind === kind)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape', 'interface')).toEqual([3, 6]);
    expect(range('Point')).toEqual([8, 12]);
    expect(range('Circle')).toEqual([14, 18]);
    expect(range('init', 'method')).toEqual([19, 22]);
    expect(range('deinit', 'method')).toEqual([24, 24]);
    expect(range('Style')).toEqual([30, 30]);
    expect(range('Color', 'enum')).toEqual([35, 37]);
    expect(range('unit', 'method')).toEqual([42, 43]);
    expect(range('totalArea', 'function')).toEqual([46, 49]);
    const circle = chunks.find((c) => c.name === 'Circle')!;
    expect(circle.content.startsWith('/// A round shape.\n@MainActor')).toBe(true);
  });

  it('names an extension after the extended type', async () => {
    const src = 'extension Array where Element == Int {\n  func total() -> Int { 0 }\n}\n';
    expect(summary(await chunkFile('a.swift', 'swift', src))).toEqual([
      'class:Array',
      'method:Array.total',
    ]);
  });

  it('chunks actors and sets the parent of nested type members to the nearest type', async () => {
    const src = 'actor A {\n  struct B {\n    func f() {}\n  }\n  func g() {}\n}\n';
    expect(summary(await chunkFile('a.swift', 'swift', src))).toEqual([
      'class:A',
      'class:B',
      'method:B.f',
      'method:A.g',
    ]);
  });

  it('skips properties and subscripts', async () => {
    const src =
      'struct S {\n  var a = 1\n  var b: Int { 2 }\n  subscript(i: Int) -> Int { i }\n}\n';
    expect(summary(await chunkFile('a.swift', 'swift', src))).toEqual(['class:S']);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('main.swift', 'swift', 'print("hi")\n');
    expect(summary(chunks)).toEqual(['file:main.swift']);
  });
});
