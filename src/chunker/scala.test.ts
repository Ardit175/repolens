import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/scala-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Scala chunking', () => {
  it('finds traits, case classes, classes, objects, functions and methods', async () => {
    const chunks = await chunkFile('Shapes.scala', 'scala', fixture('Shapes.scala'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'class:Point',
      'class:Circle',
      'method:Circle.area',
      'class:Style',
      'method:Style.name',
      'class:Shapes',
      'method:Shapes.unitCircle',
      'method:Shapes.total',
      'class:Color',
      'method:Color.label',
      'function:describe',
    ]);
  });

  it('includes scaladoc and stops type chunks at the first member', async () => {
    const chunks = await chunkFile('Shapes.scala', 'scala', fixture('Shapes.scala'));
    const range = (name: string, kind = 'class') => {
      const c = chunks.find((x) => x.name === name && x.kind === kind)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape', 'interface')).toEqual([7, 10]);
    expect(range('Point')).toEqual([12, 13]);
    expect(range('Circle')).toEqual([15, 18]);
    expect(range('area', 'method')).toEqual([19, 20]);
    expect(range('Shapes')).toEqual([27, 28]);
    expect(range('total', 'method')).toEqual([31, 32]);
    expect(range('describe', 'function')).toEqual([39, 39]);
    const circle = chunks.find((c) => c.name === 'Circle')!;
    expect(circle.content.startsWith('/** A round shape. */\nclass Circle')).toBe(true);
  });

  it('finds members inside package blocks, package objects and abstract defs', async () => {
    const src = [
      'package a {',
      '  object O { def f() = 1 }',
      '}',
      'package object util { def u() = 1 }',
      'abstract class A { def g: Int }',
      'case object Nil2',
    ].join('\n');
    expect(summary(await chunkFile('a.scala', 'scala', src))).toEqual([
      'class:O',
      'method:O.f',
      'class:util',
      'method:util.u',
      'class:A',
      'method:A.g',
      'class:Nil2',
    ]);
  });

  it('keeps a trait as one chunk including its defs', async () => {
    const src = 'trait T {\n  def a = 1\n  def b: Int\n}\n';
    const chunks = await chunkFile('a.scala', 'scala', src);
    expect(summary(chunks)).toEqual(['interface:T']);
    expect(chunks[0]!.endLine).toBe(4);
  });
});
