import { describe, expect, it } from 'vitest';
import { renderMapHtml } from './html.js';
import type { MapData } from './types.js';

const META = { title: 'repolens map', generatedAt: '2026-01-02T03:04:05Z' };

const SAMPLE: MapData = {
  nodes: [
    { id: 'src/a.ts', language: 'typescript', chunks: 3, references: 2 },
    { id: 'src/b.py', language: 'python', chunks: 1, references: 0 },
    { id: 'Makefile', language: undefined, chunks: 2, references: 1 },
  ],
  links: [{ from: 'src/a.ts', to: 'Makefile', weight: 2 }],
  unresolvedImports: 7,
};

const EMPTY: MapData = { nodes: [], links: [], unresolvedImports: 0 };

function embeddedJson(html: string): unknown {
  const match = /<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

describe('renderMapHtml', () => {
  it('produces one HTML document with inline style, svg host and script', () => {
    const html = renderMapHtml(SAMPLE, META);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>repolens map</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('<svg id="graph"');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html.match(/<html/g)).toHaveLength(1);
  });

  it('shows the header counts and the unresolved imports note', () => {
    const html = renderMapHtml(SAMPLE, META);
    expect(html).toContain('2026-01-02T03:04:05Z');
    expect(html).toContain('3 files, 1 links, 7 unresolved imports');
    expect(html).toContain('imports of packages or namespaces are not drawn');
  });

  it('round-trips the data through the embedded JSON block', () => {
    expect(embeddedJson(renderMapHtml(SAMPLE, META))).toEqual(SAMPLE);
  });

  it('keeps hostile ids from breaking out of the script block', () => {
    const id = '</script><img src=x onerror=alert(1)>.ts';
    const data: MapData = {
      nodes: [{ id, language: 'typescript', chunks: 1, references: 0 }],
      links: [],
      unresolvedImports: 0,
    };
    const html = renderMapHtml(data, META);
    // One closing tag for the JSON block and one for the client script.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain('<img src=x');
    expect(embeddedJson(html)).toEqual(data);
  });

  it('escapes ampersands and line separators in the JSON', () => {
    const id = 'a&b\u2028c\u2029d.ts';
    const data: MapData = {
      nodes: [{ id, language: undefined, chunks: 0, references: 0 }],
      links: [],
      unresolvedImports: 0,
    };
    const html = renderMapHtml(data, META);
    expect(html).not.toContain('\u2028');
    expect(html).not.toContain('\u2029');
    expect(html).toContain('a\\u0026b\\u2028c\\u2029d.ts');
    expect(embeddedJson(html)).toEqual(data);
  });

  it('escapes the title and generation time', () => {
    const html = renderMapHtml(EMPTY, {
      title: '<b onmouseover="x">&\'</b>',
      generatedAt: '<i>now</i>',
    });
    expect(html).not.toContain('<b onmouseover');
    expect(html).not.toContain('<i>now</i>');
    expect(html).toContain(
      '<title>&lt;b onmouseover=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;</title>',
    );
    expect(html).toContain('&lt;i&gt;now&lt;/i&gt;');
  });

  it('makes no external requests and builds no markup from data', () => {
    const html = renderMapHtml(SAMPLE, META);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:\/\/|[a-z]+:)/i);
    expect(html).not.toMatch(/url\(\s*["']?(?!#)/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toContain('innerHTML');
  });

  it('shows a clear message and disables the controls when there are no files', () => {
    const html = renderMapHtml(EMPTY, META);
    expect(html).toContain('No files are indexed yet');
    expect(html).toContain('0 files, 0 links, 0 unresolved imports');
    expect(html).toMatch(/<input type="search"[^>]* disabled>/);
  });

  it('omits the empty message when there are files', () => {
    expect(renderMapHtml(SAMPLE, META)).not.toContain('No files are indexed yet');
  });

  it('lists each language present with its file count, unknown included', () => {
    const html = renderMapHtml(SAMPLE, META);
    expect(html).toMatch(/data-language="typescript" data-color="0"/);
    expect(html).toMatch(/data-language="python" data-color="4"/);
    expect(html).toMatch(/data-language="unknown" data-color="13"/);
    expect(html).not.toContain('data-language="rust"');
    expect(html.match(/<input type="checkbox"/g)).toHaveLength(3);
  });

  it('treats a language outside the palette as unknown colour', () => {
    const data = {
      nodes: [{ id: 'x.zig', language: 'zig', chunks: 1, references: 0 }],
      links: [],
      unresolvedImports: 0,
    } as unknown as MapData;
    expect(renderMapHtml(data, META)).toContain('data-language="zig" data-color="13"');
  });

  it('labels the controls for keyboard and screen reader users', () => {
    const html = renderMapHtml(SAMPLE, META);
    for (const label of ['Zoom in', 'Zoom out', 'Reset zoom', 'Search file paths']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it('is deterministic for the same input', () => {
    expect(renderMapHtml(SAMPLE, META)).toBe(renderMapHtml(SAMPLE, META));
  });
});
