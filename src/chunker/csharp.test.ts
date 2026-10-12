import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkFile } from './index.js';

const fixture = (p: string): string =>
  readFileSync(new URL(`../../test/fixtures/cs-basic/${p}`, import.meta.url), 'utf8');
const summary = (chunks: Awaited<ReturnType<typeof chunkFile>>) =>
  chunks.map((c) => `${c.kind}:${c.parent ? c.parent + '.' : ''}${c.name}`);

describe('C# chunking', () => {
  it('finds types, constructors, methods and nested types in a block namespace', async () => {
    const chunks = await chunkFile('Shapes.cs', 'csharp', fixture('Shapes.cs'));
    expect(summary(chunks)).toEqual([
      'interface:IShape',
      'enum:Color',
      'class:Circle',
      'method:Circle.Circle',
      'method:Circle.Area',
      'class:Circle.Builder',
      'method:Builder.Build',
      'class:Point',
    ]);
  });

  it('includes doc comments and attributes, with 1-based line ranges', async () => {
    const chunks = await chunkFile('Shapes.cs', 'csharp', fixture('Shapes.cs'));
    const iface = chunks.find((c) => c.name === 'IShape')!;
    expect(iface.content.startsWith('    /// <summary>')).toBe(true);
    expect([iface.startLine, iface.endLine]).toEqual([5, 9]);
    const area = chunks.find((c) => c.name === 'Area' && c.kind === 'method')!;
    expect(area.content).toContain('/// <summary>Returns the circle area.');
    expect(area.content).toContain('[Obsolete("use Scale")]');
    expect([area.startLine, area.endLine]).toEqual([27, 32]);
  });

  it('stops the type chunk before its first method', async () => {
    const chunks = await chunkFile('Shapes.cs', 'csharp', fixture('Shapes.cs'));
    const circle = chunks.find((c) => c.kind === 'class' && c.name === 'Circle')!;
    expect(circle.content.startsWith('    // A circle')).toBe(true);
    expect(circle.content).toContain('private double radius = 1;');
    expect(circle.content).not.toContain('this.radius = radius');
  });

  it('handles file-scoped namespaces and structs', async () => {
    const chunks = await chunkFile('FileScoped.cs', 'csharp', fixture('FileScoped.cs'));
    expect(summary(chunks)).toEqual(['class:Counter', 'method:Counter.Increment', 'class:Pair']);
    expect(chunks[0]!.content.startsWith('// Counts things.')).toBe(true);
  });

  it('falls back to a file chunk when there are no types', async () => {
    const chunks = await chunkFile(
      'Program.cs',
      'csharp',
      'using System;\nConsole.WriteLine(1);\n',
    );
    expect(summary(chunks)).toEqual(['file:Program.cs']);
  });
});
