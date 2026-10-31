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

describe('Java edges', () => {
  it('extracts plain, wildcard and static imports', async () => {
    const src = [
      `package p;`,
      `import a.b.C;`,
      `import a.b.*;`,
      `import static a.b.C.m;`,
      `import static a.b.C.*;`,
      `import Single;`,
    ].join('\n');
    expect(await extractGraph('A.java', 'java', src)).toEqual([
      { path: 'A.java', language: 'java', kind: 'import', target: 'C', module: 'a.b.C', line: 2 },
      { path: 'A.java', language: 'java', kind: 'import', target: '*', module: 'a.b', line: 3 },
      { path: 'A.java', language: 'java', kind: 'import', target: 'm', module: 'a.b.C.m', line: 4 },
      { path: 'A.java', language: 'java', kind: 'import', target: '*', module: 'a.b.C', line: 5 },
      {
        path: 'A.java',
        language: 'java',
        kind: 'import',
        target: 'Single',
        module: 'Single',
        line: 6,
      },
    ]);
  });

  it('records the exact fields of a call edge', async () => {
    const src = `class K { void run() { a.b.foo(); } }`;
    expect(await extractGraph('K.java', 'java', src)).toEqual([
      {
        path: 'K.java',
        language: 'java',
        kind: 'call',
        target: 'foo',
        from: 'run',
        fromParent: 'K',
        line: 1,
      },
    ]);
  });

  it('attributes calls to methods, constructors, field initialisers and nested types', async () => {
    const src = [
      `package p;`, // 1
      `public class Svc<T> extends Base {`, // 2
      `  private Repo r = make();`, // 3
      `  public Svc() { init(); }`, // 4
      `  public void run() {`, // 5
      `    foo();`, // 6
      `    a.bar();`, // 7
      `    a.foo().baz();`, // 8
      `    var x = new Widget<T>();`, // 9
      `    var y = new a.b.Gadget();`, // 10
      `  }`,
      `  class Nested { void go() { deep(); } }`, // 12
      `}`,
    ].join('\n');
    expect(await edges('Svc.java', 'java', src)).toEqual([
      'call make Svc@3',
      'call init Svc.Svc@4',
      'call foo Svc.run@6',
      'call bar Svc.run@7',
      'call baz Svc.run@8',
      'call foo Svc.run@8',
      'call Widget Svc.run@9',
      'call Gadget Svc.run@10',
      'call deep Nested.go@12',
    ]);
  });

  it('handles enums, records, interfaces and annotation types', async () => {
    const src = [
      `enum E { A, B; void f() { g(); } }`, // 1
      `record R(int a) { void z() { y(); } }`, // 2
      `interface I { default void d() { x(); } }`, // 3
      `@interface Ann { int v() default 1; }`, // 4
    ].join('\n');
    expect(await edges('T.java', 'java', src)).toEqual([
      'call g E.f@1',
      'call y R.z@2',
      'call x I.d@3',
    ]);
  });

  it('gives no edges for a file with only a package line', async () => {
    expect(await extractGraph('p.java', 'java', 'package p;\n')).toEqual([]);
  });

  it('does not throw on broken syntax', async () => {
    const result = await extractGraph('A.java', 'java', `import ;\nclass { void ( { foo(`);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('extractGraph', () => {
  it('returns no edges for unsupported or unknown languages', async () => {
    expect(await extractGraph('a.sh', 'shell', 'foo')).toEqual([]);
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

describe('Go edges', () => {
  it('extracts single, grouped, aliased, dot and blank imports', async () => {
    const src = [
      `package main`, // 1
      `import "fmt"`, // 2
      `import (`, // 3
      `  "net/http"`, // 4
      `  str "strings"`, // 5
      `  . "math"`, // 6
      `  _ "embed"`, // 7
      `)`,
    ].join('\n');
    expect(await edges('a.go', 'go', src)).toEqual([
      'import fmt fmt@2',
      'import http net/http@4',
      'import str strings@5',
      'import * math@6',
      'import * embed@7',
    ]);
  });

  it('attributes calls to functions and to methods with their receiver type', async () => {
    const src = [
      `package main`, // 1
      `func run() {`, // 2
      `  foo()`, // 3
      `  http.Get("x")`, // 4
      `  s.Close()`, // 5
      `  c := Circle{}`, // 6
      `}`,
      `func (c *Circle) Area() float64 { return helper() }`, // 8
      `func (b Box[T]) Get() T { return b.load() }`, // 9
      `func (*Plain) Name() string { return name() }`, // 10
    ].join('\n');
    expect(await edges('a.go', 'go', src)).toEqual([
      'call foo run@3',
      'call Get run@4',
      'call Close run@5',
      'call helper Circle.Area@8',
      'call load Box.Get@9',
      'call name Plain.Name@10',
    ]);
  });

  it('handles goroutines, defer, func literals and package-level initialisers', async () => {
    const src = [
      `package main`, // 1
      `var cfg = load()`, // 2
      `func main() {`, // 3
      `  go serve()`, // 4
      `  defer s.Close()`, // 5
      `  func() { inner() }()`, // 6
      `}`,
    ].join('\n');
    expect(await edges('a.go', 'go', src)).toEqual([
      'call load -@2',
      'call serve main@4',
      'call Close main@5',
      'call inner main@6',
    ]);
  });

  it('does not throw on broken syntax', async () => {
    const result = await extractGraph('a.go', 'go', `package\nimport (\nfunc ( { foo(`);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Rust edges', () => {
  it('extracts plain, aliased, grouped, self and glob imports', async () => {
    const src = [
      `use std::collections::HashMap;`, // 1
      `use std::io::Result as IoResult;`, // 2
      `use std::fmt::{self, Display, Write as W};`, // 3
      `use crate::util::*;`, // 4
      `use serde;`, // 5
    ].join('\n');
    expect(await edges('a.rs', 'rust', src)).toEqual([
      'import HashMap std::collections::HashMap@1',
      'import IoResult std::io::Result@2',
      'import fmt std::fmt@3',
      'import Display std::fmt::Display@3',
      'import W std::fmt::Write@3',
      'import * crate::util@4',
      'import serde serde@5',
    ]);
  });

  it('attributes calls to functions and to impl methods with the implemented type', async () => {
    const src = [
      `fn run() {`, // 1
      `  foo();`, // 2
      `  Circle::new(1.0);`, // 3
      `  s.close();`, // 4
      `  parse::<u8>("1");`, // 5
      `  println!("x");`, // 6
      `}`,
      `impl Circle {`, // 8
      `  fn area(&self) -> f64 { helper() }`, // 9
      `}`,
      `impl<T> Shape for Wrapper<T> {`, // 11
      `  fn show(&self) { self.load() }`, // 12
      `}`,
    ].join('\n');
    expect(await edges('a.rs', 'rust', src)).toEqual([
      'call foo run@2',
      'call new run@3',
      'call close run@4',
      'call parse run@5',
      'call helper Circle.area@9',
      'call load Wrapper.show@12',
    ]);
  });

  it('handles inline modules, statics and broken syntax', async () => {
    const src = [
      `static CFG: Lazy<Cfg> = Lazy::new(load);`, // 1
      `mod inner {`, // 2
      `  fn go() { deep(); }`, // 3
      `}`,
    ].join('\n');
    expect(await edges('a.rs', 'rust', src)).toEqual(['call new -@1', 'call deep go@3']);
    const broken = await extractGraph('a.rs', 'rust', `use a::{;\nfn ( { foo(`);
    expect(Array.isArray(broken)).toBe(true);
  });
});
