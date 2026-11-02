import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/php-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('PHP chunking', () => {
  it('finds interfaces, classes, traits, enums, methods and functions', async () => {
    const chunks = await chunkFile('shapes.php', 'php', fixture('shapes.php'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'method:Shape.area',
      'class:Circle',
      'method:Circle.__construct',
      'method:Circle.unit',
      'method:Circle.area',
      'class:Labeled',
      'method:Labeled.label',
      'class:Color',
      'method:Color.name',
      'function:total_area',
    ]);
  });

  it('includes leading comments and stops type chunks at the first method', async () => {
    const chunks = await chunkFile('shapes.php', 'php', fixture('shapes.php'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape')).toEqual([10, 12]);
    expect(range('Circle')).toEqual([16, 20]);
    expect(range('__construct')).toEqual([21, 24]);
    expect(range('total_area')).toEqual([55, 59]);
    const ctor = chunks.find((c) => c.name === '__construct')!;
    expect(ctor.content.startsWith('    /** Builds a circle. */')).toBe(true);
  });

  it('treats items inside a braced namespace as top level', async () => {
    const src = '<?php\nnamespace A {\n  class B { function f() {} }\n  function g() {}\n}\n';
    expect(summary(await chunkFile('a.php', 'php', src))).toEqual([
      'class:B',
      'method:B.f',
      'function:g',
    ]);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('app.php', 'php', "<?php\nrequire 'x.php';\n");
    expect(summary(chunks)).toEqual(['file:app.php']);
  });
});
