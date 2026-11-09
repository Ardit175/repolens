import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/cpp-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('C++ chunking', () => {
  it('finds types, methods and functions inside namespaces', async () => {
    const chunks = await chunkFile('shapes.cpp', 'cpp', fixture('shapes.cpp'));
    expect(summary(chunks)).toEqual([
      'class:Point',
      'enum:Color',
      'class:Circle',
      'method:Circle.Circle',
      'method:Circle.area',
      'class:Tag',
      'method:Circle.grow',
      'function:square',
      'function:make',
      'function:main',
    ]);
  });

  it('includes comments and template headers, and ends a class before its first member', async () => {
    const chunks = await chunkFile('shapes.cpp', 'cpp', fixture('shapes.cpp'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Point')).toEqual([6, 10]);
    expect(range('Color')).toEqual([12, 12]);
    expect(range('Circle')).toEqual([14, 17]);
    expect(range('area')).toEqual([20, 22]);
    expect(range('Tag')).toEqual([24, 26]);
    expect(range('grow')).toEqual([34, 37]);
    const circle = chunks.find((c) => c.name === 'Circle' && c.kind === 'class')!;
    expect(circle.content.startsWith('/** A circle. */\ntemplate <typename T>')).toBe(true);
  });

  it('chunks the whole out-of-class definition under its type', async () => {
    const src =
      'int Foo::bar(int x) {\n  return x;\n}\nBar::~Bar() {}\nbool Bar::operator==(const Bar&) const { return true; }\n';
    const chunks = await chunkFile('a.cpp', 'cpp', src);
    expect(summary(chunks)).toEqual(['method:Foo.bar', 'method:Bar.~Bar', 'method:Bar.operator==']);
    expect(chunks[0]!.endLine).toBe(3);
  });

  it('handles nested scopes, extern "C", unions, typedefs and pointer returns', async () => {
    const src = [
      'namespace a::b { int *p() { return 0; } }',
      'extern "C" { void c_api() {} }',
      'union U { int i; float f; };',
      'typedef struct { int v; } Alias;',
      'struct S { int v; } s;',
      '#ifdef X',
      'T& ref() { return t; }',
      '#endif',
      'ns::Outer::Inner::m() {}',
    ].join('\n');
    expect(summary(await chunkFile('a.cpp', 'cpp', src))).toEqual([
      'function:p',
      'function:c_api',
      'class:U',
      'class:Alias',
      'class:S',
      'function:ref',
      'method:Inner.m',
    ]);
  });

  it('skips prototypes, forward declarations, anonymous types and variables', async () => {
    const src =
      'struct Fwd;\nint f(int);\nint x = 1;\nstruct { int a; } anon;\ntemplate <class T> void g(T);\nclass K { void m(); int v; };\n';
    expect(summary(await chunkFile('a.cpp', 'cpp', src))).toEqual(['class:K']);
  });

  it('chunks templated methods and nested types inside a class', async () => {
    const src = 'class A {\n  template <class T> T get() { return T(); }\n  enum E { X };\n};\n';
    const chunks = await chunkFile('a.cpp', 'cpp', src);
    expect(summary(chunks)).toEqual(['class:A', 'method:A.get', 'enum:E']);
    expect(chunks[0]!.endLine).toBe(1);
    expect(chunks[1]!.content.trimStart().startsWith('template')).toBe(true);
  });
});
