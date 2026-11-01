import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/ruby-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Ruby chunking', () => {
  it('finds modules, classes, nested classes, methods and singleton methods', async () => {
    const chunks = await chunkFile('shapes.rb', 'ruby', fixture('shapes.rb'));
    expect(summary(chunks)).toEqual([
      'class:Geometry',
      'class:Geometry.Circle',
      'method:Circle.initialize',
      'method:Circle.unit',
      'method:Circle.area',
      'class:Circle.Label',
      'method:Label.text',
      'method:Geometry.square',
      'function:total_area',
    ]);
  });

  it('includes leading comments and stops type chunks at the first member', async () => {
    const chunks = await chunkFile('shapes.rb', 'ruby', fixture('shapes.rb'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Geometry')).toEqual([4, 7]);
    expect(range('Circle')).toEqual([8, 11]);
    expect(range('initialize')).toEqual([12, 15]);
    expect(range('Label')).toEqual([25, 25]);
    const initialize = chunks.find((c) => c.name === 'initialize')!;
    expect(initialize.content.startsWith('    # Builds a circle.')).toBe(true);
  });

  it('keeps a type without members whole and names scoped classes by their last segment', async () => {
    const src = 'class Errors::NotFound < StandardError\nend\n';
    expect(summary(await chunkFile('e.rb', 'ruby', src))).toEqual(['class:NotFound']);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('app.rb', 'ruby', "require 'json'\n");
    expect(summary(chunks)).toEqual(['file:app.rb']);
  });
});
