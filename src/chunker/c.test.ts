import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/c-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.name}`);

describe('C chunking', () => {
  it('finds typedef structs, enums, functions and skips function pointer typedefs', async () => {
    const chunks = await chunkFile('shapes.c', 'c', fixture('shapes.c'));
    expect(summary(chunks)).toEqual([
      'class:Point',
      'enum:Color',
      'enum:Size',
      'function:square',
      'function:circle_area',
      'function:extra',
      'function:main',
    ]);
  });

  it('includes leading comments and treats #ifdef contents as top level', async () => {
    const chunks = await chunkFile('shapes.c', 'c', fixture('shapes.c'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Point')).toEqual([4, 8]);
    expect(range('Color')).toEqual([10, 10]);
    expect(range('Size')).toEqual([12, 12]);
    expect(range('square')).toEqual([16, 19]);
    expect(range('circle_area')).toEqual([21, 25]);
    expect(range('extra')).toEqual([28, 30]);
    expect(range('main')).toEqual([33, 36]);
    expect(chunks.find((c) => c.name === 'square')!.content.startsWith('/** Squares')).toBe(true);
  });

  it('chunks tagged structs and unions, and skips forward declarations', async () => {
    const src = [
      'struct Fwd;',
      'union U { int a; float b; };',
      'typedef struct Node { int v; } Node_t;',
      'struct Pair { int a; } pair;',
      'int *make(void) { return 0; }',
    ].join('\n');
    expect(summary(await chunkFile('a.c', 'c', src))).toEqual([
      'class:U',
      'class:Node',
      'class:Pair',
      'function:make',
    ]);
  });

  it('skips variable declarations and prototypes', async () => {
    const src = 'int x = 1;\nint f(int);\ntypedef int Num;\nstruct S s;\n';
    expect(summary(await chunkFile('a.c', 'c', src))).toEqual(['file:a.c']);
  });

  it('treats #else branches and nested conditionals as top level', async () => {
    const src = '#if A\nint a(void) {return 1;}\n#else\nint b(void) {return 2;}\n#endif\n';
    expect(summary(await chunkFile('a.c', 'c', src))).toEqual(['function:a', 'function:b']);
  });
});
