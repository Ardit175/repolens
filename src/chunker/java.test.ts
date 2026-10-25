import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/java-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('Java chunking', () => {
  it('finds types, constructors, methods, nested types and records', async () => {
    const chunks = await chunkFile('Shapes.java', 'java', fixture('Shapes.java'));
    expect(summary(chunks)).toEqual([
      'interface:Shape',
      'enum:Color',
      'class:Circle',
      'method:Circle.Circle',
      'method:Circle.area',
      'class:Circle.Builder',
      'method:Builder.build',
      'class:Point',
    ]);
  });

  it('includes Javadoc and annotations, with 1-based line ranges', async () => {
    const chunks = await chunkFile('Shapes.java', 'java', fixture('Shapes.java'));
    const iface = chunks.find((c) => c.name === 'Shape')!;
    expect(iface.content.startsWith('/** Something with an area. */')).toBe(true);
    expect([iface.startLine, iface.endLine]).toEqual([6, 9]);
    const area = chunks.find((c) => c.name === 'area' && c.kind === 'method')!;
    expect(area.content.startsWith('    @Override')).toBe(true);
    expect([area.startLine, area.endLine]).toEqual([26, 29]);
  });

  it('stops the type chunk before its first method', async () => {
    const chunks = await chunkFile('Shapes.java', 'java', fixture('Shapes.java'));
    const circle = chunks.find((c) => c.kind === 'class' && c.name === 'Circle')!;
    expect(circle.content.startsWith('/**\n * A circle.')).toBe(true);
    expect(circle.content).toContain('private double radius = 1;');
    expect(circle.content).not.toContain('this.radius = radius');
    expect([circle.startLine, circle.endLine]).toEqual([16, 21]);
  });

  it('falls back to a file chunk when there are no types', async () => {
    const chunks = await chunkFile('package-info.java', 'java', 'package geometry;\n');
    expect(summary(chunks)).toEqual(['file:package-info.java']);
  });
});
