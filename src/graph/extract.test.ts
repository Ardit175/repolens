import { describe, expect, it } from 'vitest';
import { edgesHash, extractGraph } from './index.js';

/** Compact view of edges: "kind target [module] [parent.]from@line". */
async function edges(path: string, language: Parameters<typeof extractGraph>[1], src: string) {
  const all = await extractGraph(path, language, src);
  return all.map((e) => {
    const where = e.from ? `${e.fromParent ? e.fromParent + '.' : ''}${e.from}` : '-';
    return e.kind === 'import'
      ? `import ${e.target} ${e.module}@${e.line}`
      : `call ${e.target} ${where}@${e.line}`;
  });
}

describe('TypeScript edges', () => {
  it('extracts every import form', async () => {
    const src = [
      `import def from './a.js';`,
      `import { a, b as c } from './b.js';`,
      `import * as ns from './c.js';`,
      `import './side.js';`,
      `import type { T } from './t.js';`,
      `export { x, y as z } from './d.js';`,
      `export * from './e.js';`,
      `const fs = require('node:fs');`,
      `const local = 1;`,
    ].join('\n');
    expect(await edges('a.ts', 'typescript', src)).toEqual([
      'import def ./a.js@1',
      'import a ./b.js@2',
      'import b ./b.js@2',
      'import * ./c.js@3',
      'import * ./side.js@4',
      'import T ./t.js@5',
      'import x ./d.js@6',
      'import y ./d.js@6',
      'import * ./e.js@7',
      'import * node:fs@8',
    ]);
  });

  it('attributes calls to the enclosing chunk-level symbol', async () => {
    const src = [
      `top();`, // 1
      `export function outer() {`, // 2
      `  foo();`, // 3
      `  const inner = () => bar();`, // 4 nested: stays in outer
      `  a.b.baz(new Widget(), new ns.Gadget());`, // 5
      `}`,
      `export const arrow = () => { qux(); };`, // 7
      `const notFn = make();`, // 8
      `class Svc extends Base {`, // 9
      `  field = init();`, // 10
      `  run() { this.go(); }`, // 11
      `  static make() { return new Svc(); }`, // 12
      `}`,
    ].join('\n');
    expect(await edges('a.ts', 'typescript', src)).toEqual([
      'call top -@1',
      'call foo outer@3',
      'call bar outer@4',
      'call baz outer@5',
      'call Widget outer@5',
      'call Gadget outer@5',
      'call qux arrow@7',
      'call make -@8',
      'call init Svc@10',
      'call go Svc.run@11',
      'call Svc Svc.make@12',
    ]);
  });

  it('deduplicates identical edges and sets the language from the caller', async () => {
    const result = await extractGraph('a.jsx', 'jsx', `function f() { g(); g(); }`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ language: 'jsx', path: 'a.jsx', target: 'g', line: 1 });
  });

  it('handles tsx and javascript grammars and ignores dynamic callees', async () => {
    expect(await edges('a.tsx', 'tsx', `const A = () => <div>{f()}</div>;`)).toEqual([
      'call f A@1',
    ]);
    expect(await edges('a.js', 'javascript', `(() => 1)(); x[0]();`)).toEqual([]);
  });

  it('does not throw on broken syntax', async () => {
    const result = await extractGraph('a.ts', 'typescript', `import { from\nfunction (( { foo(`);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Python edges', () => {
  it('extracts every import form', async () => {
    const src = [
      `import a.b`,
      `import c as x, d`,
      `from m import a, b as c`,
      `from . import sibling`,
      `from ..pkg.mod import thing`,
      `from n import *`,
    ].join('\n');
    expect(await edges('a.py', 'python', src)).toEqual([
      'import * a.b@1',
      'import * c@2',
      'import * d@2',
      'import a m@3',
      'import b m@3',
      'import sibling .@4',
      'import thing ..pkg.mod@5',
      'import * n@6',
    ]);
  });

  it('attributes calls to defs, methods and classes', async () => {
    const src = [
      `top()`, // 1
      `def f():`, // 2
      `    foo()`, // 3
      `    def inner():`, // 4
      `        bar()`, // 5
      `    obj.attr.baz()`, // 6
      `@deco(1)`, // 7
      `class K:`, // 8
      `    x = make()`, // 9
      `    @staticmethod`, // 10
      `    def m(self):`, // 11
      `        self.go()`, // 12
      `        import os`, // 13
    ].join('\n');
    expect(await edges('a.py', 'python', src)).toEqual([
      'call top -@1',
      'call foo f@3',
      'call bar f@5',
      'call baz f@6',
      'call deco K@7',
      'call make K@9',
      'call go K.m@12',
      'import * os@13',
    ]);
  });

  it('keeps decorator calls on decorated functions inside the function', async () => {
    expect(await edges('a.py', 'python', `@wrap(1)\ndef f():\n    pass\n`)).toEqual([
      'call wrap f@1',
    ]);
  });

  it('does not throw on broken syntax', async () => {
    const result = await extractGraph('a.py', 'python', `def (:\n  from import\n  foo(`);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('C# edges', () => {
  it('extracts using directives', async () => {
    const src = [
      `using System;`,
      `using System.Collections.Generic;`,
      `using static System.Math;`,
      `using IO = System.IO;`,
    ].join('\n');
    expect(await edges('a.cs', 'csharp', src)).toEqual([
      'import * System@1',
      'import * System.Collections.Generic@2',
      'import * System.Math@3',
      'import * System.IO@4',
    ]);
  });

  it('attributes calls to methods, constructors and types', async () => {
    const src = [
      `namespace N {`, // 1
      `  public class Svc {`, // 2
      `    private Repo r = new Repo();`, // 3
      `    public Svc() { Init(); }`, // 4
      `    public void Run() {`, // 5
      `      Foo();`, // 6
      `      a.Bar();`, // 7
      `      a.Baz<int>(1);`, // 8
      `      var x = new Ns.Widget<T>();`, // 9
      `      a?.Opt();`, // 10
      `    }`,
      `    class Nested { void Go() { Deep(); } }`, // 12
      `  }`,
      `}`,
    ].join('\n');
    expect(await edges('a.cs', 'csharp', src)).toEqual([
      'call Repo Svc@3',
      'call Init Svc.Svc@4',
      'call Foo Svc.Run@6',
      'call Bar Svc.Run@7',
      'call Baz Svc.Run@8',
      'call Widget Svc.Run@9',
      'call Opt Svc.Run@10',
      'call Deep Nested.Go@12',
    ]);
  });

  it('handles file-scoped namespaces, interfaces and top-level statements', async () => {
    const src = `namespace N;\ninterface I { int P { get; } }\nclass C { void M() { X(); } }\n`;
    expect(await edges('a.cs', 'csharp', src)).toEqual(['call X C.M@3']);
    expect(await edges('b.cs', 'csharp', `Console.WriteLine(1);`)).toEqual(['call WriteLine -@1']);
  });

  it('does not throw on broken syntax', async () => {
    const result = await extractGraph('a.cs', 'csharp', `using ;\nclass { void ( { Foo(`);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('extractGraph', () => {
  it('returns no edges for unsupported or unknown languages', async () => {
    expect(await extractGraph('a.go', 'go', 'package main\nfunc f() { g() }')).toEqual([]);
    expect(await extractGraph('a.txt', undefined, 'foo()')).toEqual([]);
  });
});

describe('edgesHash', () => {
  it('is stable for equal edges and sensitive to every field', async () => {
    const src = `import { a } from './x.js';\nfunction f() { a(); }`;
    const first = await extractGraph('a.ts', 'typescript', src);
    const second = await extractGraph('a.ts', 'typescript', src);
    const hash = edgesHash(first);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(edgesHash(second)).toBe(hash);
    expect(edgesHash([])).not.toBe(hash);

    const base = first[1]!;
    for (const change of [
      { target: 'z' },
      { line: base.line + 1 },
      { from: 'g' },
      { fromParent: 'K' },
      { path: 'b.ts' },
      { kind: 'import' as const },
    ]) {
      expect(edgesHash([first[0]!, { ...base, ...change }])).not.toBe(hash);
    }
    expect(edgesHash([first[0]!, { ...base, module: 'm' }])).not.toBe(hash);
  });
});
