import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../graph/types.js';
import type { Language } from '../language.js';
import type { ResolveContext } from './paths.js';
import { resolveGo, resolveJvm, resolveRust } from './resolve-modules.js';

function edge(
  language: Language,
  from: string,
  module: string | undefined,
  target = 'X',
): GraphEdge {
  return { path: from, language, kind: 'import', target, module, line: 1 };
}

function context(files: string[], goModules: [string, string][] = []): ResolveContext {
  return { indexed: new Set(files), goModules: new Map(goModules) };
}

describe('resolveJvm', () => {
  const files = [
    'src/main/java/com/acme/shapes/Circle.java',
    'src/main/java/com/acme/shapes/Square.java',
    'src/main/java/com/acme/shapes/Util.java',
    'src/main/kotlin/com/acme/app/Main.kt',
    'src/main/scala/com/acme/scala/Tools.scala',
    'src/main/java/com/acme/util/Helpers.kt',
    'a/com/acme/dup/Same.java',
    'b/com/acme/dup/Same.java',
  ];
  const ctx = context(files);

  it('resolves a class under a source root', () => {
    const e = edge('java', 'src/main/java/Main.java', 'com.acme.shapes.Circle', 'Circle');
    expect(resolveJvm(e, ctx)).toEqual(['src/main/java/com/acme/shapes/Circle.java']);
  });

  it('falls back to the enclosing class for static imports', () => {
    const e = edge('java', 'Main.java', 'com.acme.shapes.Util.max', 'max');
    expect(resolveJvm(e, ctx)).toEqual(['src/main/java/com/acme/shapes/Util.java']);
  });

  it('resolves Kotlin importing a Java class', () => {
    const e = edge('kotlin', 'src/main/kotlin/com/acme/app/Main.kt', 'com.acme.shapes.Square');
    expect(resolveJvm(e, ctx)).toEqual(['src/main/java/com/acme/shapes/Square.java']);
  });

  it('resolves a Java import of a Scala class', () => {
    const e = edge('java', 'Main.java', 'com.acme.scala.Tools');
    expect(resolveJvm(e, ctx)).toEqual(['src/main/scala/com/acme/scala/Tools.scala']);
  });

  it('resolves a wildcard that names a class', () => {
    const e = edge('java', 'Main.java', 'com.acme.shapes.Util', '*');
    expect(resolveJvm(e, ctx)).toEqual(['src/main/java/com/acme/shapes/Util.java']);
  });

  it('resolves a wildcard package in one directory to all files, sorted', () => {
    const e = edge('java', 'Main.java', 'com.acme.shapes', '*');
    expect(resolveJvm(e, ctx)).toEqual([
      'src/main/java/com/acme/shapes/Circle.java',
      'src/main/java/com/acme/shapes/Square.java',
      'src/main/java/com/acme/shapes/Util.java',
    ]);
  });

  it('leaves a wildcard package spread over several directories unresolved', () => {
    const e = edge('java', 'Main.java', 'com.acme.dup', '*');
    expect(resolveJvm(e, ctx)).toEqual([]);
  });

  it('leaves an ambiguous class name unresolved', () => {
    expect(resolveJvm(edge('java', 'Main.java', 'com.acme.dup.Same'), ctx)).toEqual([]);
  });

  it('leaves Kotlin top-level functions and external packages unresolved', () => {
    expect(resolveJvm(edge('kotlin', 'M.kt', 'com.acme.util.helper', 'helper'), ctx)).toEqual([]);
    expect(resolveJvm(edge('java', 'M.java', 'java.util.List', 'List'), ctx)).toEqual([]);
    expect(resolveJvm(edge('java', 'M.java', 'java.util', '*'), ctx)).toEqual([]);
    expect(resolveJvm(edge('java', 'M.java', 'Single'), ctx)).toEqual([]);
  });

  it('returns nothing without a module', () => {
    expect(resolveJvm(edge('java', 'M.java', undefined), ctx)).toEqual([]);
  });
});

describe('resolveGo', () => {
  const files = [
    'main.go',
    'util/a.go',
    'util/b.go',
    'util/b_test.go',
    'util/deep/c.go',
    'svc/api/go.mod',
    'svc/api/handler.go',
    'svc/api/store/s.go',
    'app/internal/x.go',
  ];
  const ctx = context(files, [
    ['example.com/app', ''],
    ['example.com/app/svc/api', 'svc/api'],
  ]);

  it('resolves a package in the root module, excluding tests and subdirectories', () => {
    const e = edge('go', 'main.go', 'example.com/app/util');
    expect(resolveGo(e, ctx)).toEqual(['util/a.go', 'util/b.go']);
  });

  it('prefers the longest module path', () => {
    const e = edge('go', 'main.go', 'example.com/app/svc/api/store');
    expect(resolveGo(e, ctx)).toEqual(['svc/api/store/s.go']);
  });

  it('resolves an import equal to a nested module path', () => {
    const e = edge('go', 'main.go', 'example.com/app/svc/api');
    expect(resolveGo(e, ctx)).toEqual(['svc/api/handler.go']);
  });

  it('resolves an import equal to the root module path to the root package', () => {
    expect(resolveGo(edge('go', 'util/a.go', 'example.com/app'), ctx)).toEqual(['main.go']);
  });

  it('does not match a module path that is only a string prefix', () => {
    expect(resolveGo(edge('go', 'main.go', 'example.com/application/util'), ctx)).toEqual([]);
  });

  it('leaves standard library and third-party imports unresolved', () => {
    expect(resolveGo(edge('go', 'main.go', 'fmt'), ctx)).toEqual([]);
    expect(resolveGo(edge('go', 'main.go', 'github.com/other/lib'), ctx)).toEqual([]);
  });

  it('returns nothing without a module', () => {
    expect(resolveGo(edge('go', 'main.go', undefined), ctx)).toEqual([]);
  });
});

describe('resolveRust', () => {
  const files = [
    'src/lib.rs',
    'src/shapes.rs',
    'src/util/mod.rs',
    'src/util/inner.rs',
    'src/a/mod.rs',
    'src/a/b.rs',
    'src/a/sibling.rs',
    'src/a/b/deep.rs',
    'crates/foo/src/lib.rs',
    'crates/foo/src/bar.rs',
  ];
  const ctx = context(files);
  const use = (from: string, module: string) => resolveRust(edge('rust', from, module), ctx);

  it('resolves crate:: paths and drops item segments', () => {
    expect(use('src/a/b.rs', 'crate::shapes::Circle')).toEqual(['src/shapes.rs']);
    expect(use('src/a/b.rs', 'crate::shapes::Circle::new')).toEqual(['src/shapes.rs']);
  });

  it('prefers the longest module prefix and finds mod.rs modules', () => {
    expect(use('src/lib.rs', 'crate::util::inner::Helper')).toEqual(['src/util/inner.rs']);
    expect(use('src/lib.rs', 'crate::util::Helper')).toEqual(['src/util/mod.rs']);
  });

  it('resolves self:: from x.rs and from mod.rs', () => {
    expect(use('src/a/b.rs', 'self::deep::f')).toEqual(['src/a/b/deep.rs']);
    expect(use('src/a/mod.rs', 'self::sibling::f')).toEqual(['src/a/sibling.rs']);
    expect(use('src/lib.rs', 'self::shapes::Circle')).toEqual(['src/shapes.rs']);
  });

  it('resolves super:: from x.rs and from mod.rs', () => {
    expect(use('src/a/b.rs', 'super::sibling::f')).toEqual(['src/a/sibling.rs']);
    expect(use('src/a/mod.rs', 'super::shapes::Circle')).toEqual(['src/shapes.rs']);
    expect(use('src/a/b/deep.rs', 'super::super::sibling::f')).toEqual(['src/a/sibling.rs']);
  });

  it('resolves a single item to the file of the module the path starts from', () => {
    expect(use('src/a/b.rs', 'super::Shape')).toEqual(['src/a/mod.rs']);
    expect(use('src/a/mod.rs', 'super::Config')).toEqual(['src/lib.rs']);
    expect(use('src/shapes.rs', 'crate::Config')).toEqual(['src/lib.rs']);
    expect(use('src/a/b/deep.rs', 'super::Thing')).toEqual(['src/a/b.rs']);
    expect(use('src/lib.rs', 'crate::Config')).toEqual([]);
    expect(use('src/a/b.rs', 'crate::missing::Thing')).toEqual([]);
    expect(resolveRust(edge('rust', 'src/x.rs', 'crate::Config'), context(['src/x.rs']))).toEqual(
      [],
    );
  });

  it('returns nothing when super would leave the crate', () => {
    expect(use('src/a/mod.rs', 'super::super::x')).toEqual([]);
    expect(use('src/lib.rs', 'super::x')).toEqual([]);
  });

  it('resolves inside a workspace crate', () => {
    expect(use('crates/foo/src/lib.rs', 'crate::bar::Bar')).toEqual(['crates/foo/src/bar.rs']);
    expect(use('crates/foo/src/bar.rs', 'crate::shapes::Circle')).toEqual([]);
  });

  it('uses the file directory as crate root when there is no src segment', () => {
    const flat = context(['tool/main.rs', 'tool/cli.rs']);
    expect(resolveRust(edge('rust', 'tool/main.rs', 'crate::cli::Args'), flat)).toEqual([
      'tool/cli.rs',
    ]);
    const top = context(['main.rs', 'cli.rs']);
    expect(resolveRust(edge('rust', 'main.rs', 'crate::cli'), top)).toEqual(['cli.rs']);
  });

  it('leaves std, external crates and unknown modules unresolved', () => {
    expect(use('src/lib.rs', 'std::fmt')).toEqual([]);
    expect(use('src/lib.rs', 'serde::Serialize')).toEqual([]);
    expect(use('src/lib.rs', 'crate::missing::Thing')).toEqual([]);
    expect(use('src/lib.rs', 'crate')).toEqual([]);
  });

  it('returns nothing without a module', () => {
    expect(resolveRust(edge('rust', 'src/lib.rs', undefined), ctx)).toEqual([]);
  });
});
