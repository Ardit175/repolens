import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/rust-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Rust chunking', () => {
  it('finds functions, impl methods, traits, structs, enums and aliases', async () => {
    const chunks = await chunkFile('shapes.rs', 'rust', fixture('shapes.rs'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'class:Circle',
      'method:Circle.new',
      'method:Circle.area',
      'method:Wrapper.show',
      'enum:Kind',
      'type:Registry',
      'function:total_area',
      'function:helper',
    ]);
  });

  it('includes doc comments and attributes, with 1-based line ranges', async () => {
    const chunks = await chunkFile('shapes.rs', 'rust', fixture('shapes.rs'));
    const range = (name: string) => {
      const c = chunks.find((x) => x.name === name)!;
      return [c.startLine, c.endLine];
    };
    expect(range('Shape')).toEqual([4, 7]);
    expect(range('Circle')).toEqual([9, 13]);
    expect(range('new')).toEqual([16, 19]);
    expect(range('Kind')).toEqual([34, 37]);
    const circle = chunks.find((c) => c.name === 'Circle')!;
    expect(circle.content.startsWith('/// A round shape.\n#[derive(Debug, Clone)]')).toBe(true);
  });

  it('falls back to a file chunk when there are no symbols', async () => {
    const chunks = await chunkFile('lib.rs', 'rust', 'use std::io;\n');
    expect(summary(chunks)).toEqual(['file:lib.rs']);
  });
});
