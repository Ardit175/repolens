import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../graph/types.js';
import type { Language } from '../language.js';
import type { ImportResolver } from './paths.js';
import {
  resolveInclude,
  resolvePhp,
  resolvePython,
  resolveRuby,
  resolveScript,
} from './resolve.js';

function edge(
  language: Language,
  from: string,
  module: string | undefined,
  target = '*',
): GraphEdge {
  return { path: from, language, kind: 'import', target, module, line: 1 };
}

function run(resolver: ImportResolver, e: GraphEdge, files: string[]): string[] {
  return resolver(e, { indexed: new Set(files), goModules: new Map() });
}

describe('resolveScript', () => {
  it('maps .js to .ts and tries extensions and index files', () => {
    const files = ['src/a.ts', 'src/util.ts', 'src/lib/index.ts', 'src/x.tsx'];
    expect(run(resolveScript, edge('typescript', 'src/a.ts', './util.js'), files)).toEqual([
      'src/util.ts',
    ]);
    expect(run(resolveScript, edge('typescript', 'src/a.ts', './lib'), files)).toEqual([
      'src/lib/index.ts',
    ]);
    expect(run(resolveScript, edge('typescript', 'src/a.ts', './x'), files)).toEqual(['src/x.tsx']);
  });

  it('skips packages, escapes and missing files', () => {
    const files = ['a.ts', 'b.ts'];
    expect(run(resolveScript, edge('typescript', 'a.ts', 'react'), files)).toEqual([]);
    expect(run(resolveScript, edge('typescript', 'a.ts', '../b'), files)).toEqual([]);
    expect(run(resolveScript, edge('typescript', 'a.ts', './nope'), files)).toEqual([]);
    expect(run(resolveScript, edge('typescript', 'a.ts', undefined), files)).toEqual([]);
  });
});

describe('resolvePython', () => {
  const files = ['pkg/__init__.py', 'pkg/util.py', 'pkg/sub/mod.py', 'app/core/db.py'];

  it('resolves relative modules and sibling imports', () => {
    expect(run(resolvePython, edge('python', 'pkg/a.py', '.util', 'x'), files)).toEqual([
      'pkg/util.py',
    ]);
    expect(run(resolvePython, edge('python', 'pkg/sub/a.py', '..util', 'x'), files)).toEqual([
      'pkg/util.py',
    ]);
    expect(run(resolvePython, edge('python', 'pkg/a.py', '.', 'util'), files)).toEqual([
      'pkg/util.py',
    ]);
    expect(run(resolvePython, edge('python', 'pkg/a.py', '.', '*'), files)).toEqual([
      'pkg/__init__.py',
    ]);
  });

  it('does not climb above the root', () => {
    expect(run(resolvePython, edge('python', 'a.py', '..x', 'y'), files)).toEqual([]);
  });

  it('resolves absolute modules exactly, by unique suffix, and not when ambiguous', () => {
    expect(run(resolvePython, edge('python', 'm.py', 'pkg.util'), files)).toEqual(['pkg/util.py']);
    expect(run(resolvePython, edge('python', 'm.py', 'core.db'), files)).toEqual([
      'app/core/db.py',
    ]);
    const ambiguous = [...files, 'other/core/db.py'];
    expect(run(resolvePython, edge('python', 'm.py', 'core.db'), ambiguous)).toEqual([]);
    expect(run(resolvePython, edge('python', 'm.py', 'os.path'), files)).toEqual([]);
    expect(run(resolvePython, edge('python', 'm.py', undefined), files)).toEqual([]);
  });
});

describe('resolveInclude', () => {
  it('prefers the including directory over the root', () => {
    const files = ['src/main.c', 'src/util.h', 'util.h'];
    expect(run(resolveInclude, edge('c', 'src/main.c', 'util.h'), files)).toEqual(['src/util.h']);
  });

  it('falls back to the root path, then a unique suffix', () => {
    const files = ['src/main.cpp', 'include/app/core.h', 'third/deep/x.h'];
    expect(run(resolveInclude, edge('cpp', 'src/main.cpp', 'include/app/core.h'), files)).toEqual([
      'include/app/core.h',
    ]);
    expect(run(resolveInclude, edge('cpp', 'src/main.cpp', 'app/core.h'), files)).toEqual([
      'include/app/core.h',
    ]);
    expect(run(resolveInclude, edge('cpp', 'src/main.cpp', 'x.h'), files)).toEqual([
      'third/deep/x.h',
    ]);
  });

  it('resolves .. includes and skips an escaping one', () => {
    const files = ['src/a/main.c', 'src/common.h'];
    expect(run(resolveInclude, edge('c', 'src/a/main.c', '../common.h'), files)).toEqual([
      'src/common.h',
    ]);
    expect(run(resolveInclude, edge('c', 'main.c', '../common.h'), files)).toEqual([]);
  });

  it('leaves std headers, ambiguous names and missing modules unresolved', () => {
    const files = ['a/x.h', 'b/x.h', 'main.c'];
    expect(run(resolveInclude, edge('c', 'main.c', 'stdio.h'), files)).toEqual([]);
    expect(run(resolveInclude, edge('c', 'main.c', 'x.h'), files)).toEqual([]);
    expect(run(resolveInclude, edge('c', 'main.c', undefined), files)).toEqual([]);
  });
});

describe('resolveRuby', () => {
  it('resolves relative to the file and appends .rb', () => {
    const files = ['app/main.rb', 'app/helper.rb', 'lib/helper.rb'];
    expect(run(resolveRuby, edge('ruby', 'app/main.rb', 'helper'), files)).toEqual([
      'app/helper.rb',
    ]);
    expect(run(resolveRuby, edge('ruby', 'app/main.rb', './helper.rb'), files)).toEqual([
      'app/helper.rb',
    ]);
  });

  it('stops after the directory step for ./ and ../ modules', () => {
    const files = ['app/main.rb', 'lib/helper.rb', 'other/helper.rb'];
    expect(run(resolveRuby, edge('ruby', 'app/main.rb', './helper'), files)).toEqual([]);
    expect(run(resolveRuby, edge('ruby', 'app/main.rb', '../lib/helper'), files)).toEqual([
      'lib/helper.rb',
    ]);
    expect(run(resolveRuby, edge('ruby', 'main.rb', '../helper'), files)).toEqual([]);
  });

  it('tries lib/ and the root, then a unique suffix', () => {
    const files = ['main.rb', 'lib/tool.rb', 'tool.rb', 'vendor/deep/thing.rb'];
    expect(run(resolveRuby, edge('ruby', 'src/x.rb', 'tool'), files)).toEqual(['lib/tool.rb']);
    expect(run(resolveRuby, edge('ruby', 'src/x.rb', 'tool'), ['tool.rb'])).toEqual(['tool.rb']);
    expect(run(resolveRuby, edge('ruby', 'src/x.rb', 'thing'), files)).toEqual([
      'vendor/deep/thing.rb',
    ]);
  });

  it('leaves gems and ambiguous names unresolved', () => {
    const files = ['a/z.rb', 'b/z.rb'];
    expect(run(resolveRuby, edge('ruby', 'x.rb', 'json'), files)).toEqual([]);
    expect(run(resolveRuby, edge('ruby', 'x.rb', 'z'), files)).toEqual([]);
    expect(run(resolveRuby, edge('ruby', 'x.rb', undefined), files)).toEqual([]);
  });
});

describe('resolvePhp', () => {
  it('resolves require paths by directory, then from the root', () => {
    const files = ['src/a.php', 'src/b.php', 'config/c.php'];
    expect(run(resolvePhp, edge('php', 'src/a.php', 'b.php'), files)).toEqual(['src/b.php']);
    expect(run(resolvePhp, edge('php', 'src/a.php', 'config/c.php'), files)).toEqual([
      'config/c.php',
    ]);
    expect(run(resolvePhp, edge('php', 'src/a.php', '../config/c.php'), files)).toEqual([
      'config/c.php',
    ]);
    expect(run(resolvePhp, edge('php', 'a.php', '../config/c.php'), files)).toEqual([]);
    expect(run(resolvePhp, edge('php', 'src/a.php', 'missing.php'), files)).toEqual([]);
  });

  it('resolves use imports with the longest suffix first', () => {
    const files = ['src/App/Models/User.php', 'lib/User.php'];
    expect(run(resolvePhp, edge('php', 'x.php', 'App\\Models\\User', 'User'), files)).toEqual([
      'src/App/Models/User.php',
    ]);
    expect(
      run(resolvePhp, edge('php', 'x.php', 'Vendor\\Pkg\\Models\\User', 'User'), [
        'src/Models/User.php',
        'lib/User.php',
      ]),
    ).toEqual(['src/Models/User.php']);
  });

  it('drops the vendor prefix and falls back to the class name when unique', () => {
    const files = ['src/Models/User.php', 'lib/Other.php'];
    expect(run(resolvePhp, edge('php', 'x.php', 'App\\Models\\User', 'User'), files)).toEqual([
      'src/Models/User.php',
    ]);
    expect(run(resolvePhp, edge('php', 'x.php', 'App\\Other', 'Other'), files)).toEqual([
      'lib/Other.php',
    ]);
  });

  it('leaves unknown and ambiguous classes unresolved', () => {
    const files = ['a/Thing.php', 'b/Thing.php'];
    expect(run(resolvePhp, edge('php', 'x.php', 'App\\Thing', 'Thing'), files)).toEqual([]);
    expect(run(resolvePhp, edge('php', 'x.php', 'Psr\\Log\\Logger', 'Logger'), files)).toEqual([]);
    expect(run(resolvePhp, edge('php', 'x.php', undefined), files)).toEqual([]);
  });
});
