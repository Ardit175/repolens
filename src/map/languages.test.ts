import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from '../graph/store.js';
import { indexRepository } from '../indexer.js';
import { InMemoryVectorStore } from '../store/index.js';
import { FakeEmbeddingProvider } from '../testing.js';
import { buildMapData } from './build.js';
import type { MapData } from './types.js';

/**
 * End to end: a small repository in several languages is indexed with the real walker, chunkers
 * and graph extractors, then mapped. Every import below must become a link.
 */
const FILES: Record<string, string> = {
  'go.mod': 'module example.com/shop\n\ngo 1.22\n',
  'cmd/main.go': [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"example.com/shop/cart"',
    ')',
    '',
    'func main() { fmt.Println(cart.Total()) }',
    '',
  ].join('\n'),
  'cart/cart.go': 'package cart\n\nfunc Total() int { return price() }\n',
  'cart/price.go': 'package cart\n\nfunc price() int { return 1 }\n',
  'cart/cart_test.go': 'package cart\n\nfunc helper() {}\n',
  'jvm/src/main/java/com/acme/Shape.java': 'package com.acme;\n\npublic class Shape {}\n',
  'jvm/src/main/kotlin/com/acme/app/App.kt': [
    'package com.acme.app',
    '',
    'import com.acme.Shape',
    '',
    'fun main() { println(Shape()) }',
    '',
  ].join('\n'),
  'rs/src/lib.rs': 'pub mod shapes;\n\npub struct Config;\n',
  'rs/src/shapes.rs': 'use crate::Config;\n\npub fn area(c: &Config) -> u32 { 0 }\n',
  'native/shapes.h': 'int area(int w, int h);\n',
  'native/shapes.c':
    '#include "shapes.h"\n#include <stdio.h>\n\nint area(int w, int h) { return w * h; }\n',
  'rb/lib/shop/cart.rb': 'class Cart\nend\n',
  'rb/app.rb': "require_relative 'lib/shop/cart'\nrequire 'json'\n",
  'php/src/Models/User.php': '<?php\nnamespace App\\Models;\n\nclass User {}\n',
  'php/src/index.php': "<?php\nuse App\\Models\\User;\nrequire 'Models/User.php';\n",
};

let dir: string;
let data: MapData;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'repolens-map-'));
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  const store = new InMemoryVectorStore();
  const graph = new InMemoryGraphStore();
  await indexRepository({ root: dir, store, embeddings: new FakeEmbeddingProvider(), graph });
  data = await buildMapData(store, graph);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('buildMapData across languages', () => {
  it('links imports in Go, JVM, Rust, C, Ruby and PHP to the files they name', () => {
    expect(data.links.map((l) => `${l.from} > ${l.to} (${l.weight})`)).toEqual([
      'cmd/main.go > cart/cart.go (1)',
      'cmd/main.go > cart/price.go (1)',
      'jvm/src/main/kotlin/com/acme/app/App.kt > jvm/src/main/java/com/acme/Shape.java (1)',
      'native/shapes.c > native/shapes.h (1)',
      'php/src/index.php > php/src/Models/User.php (2)',
      'rb/app.rb > rb/lib/shop/cart.rb (1)',
      'rs/src/shapes.rs > rs/src/lib.rs (1)',
    ]);
  });

  it('counts standard library and package imports as unresolved', () => {
    // `fmt` (Go), `stdio.h` (C) and `json` (Ruby).
    expect(data.unresolvedImports).toBe(3);
  });
});
