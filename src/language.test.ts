import { describe, expect, it } from 'vitest';
import { detectLanguage, hasKnownExtension } from './language.js';

describe('detectLanguage by extension', () => {
  it.each([
    ['a.ts', 'typescript'],
    ['a.mts', 'typescript'],
    ['a.cts', 'typescript'],
    ['a.tsx', 'tsx'],
    ['a.js', 'javascript'],
    ['a.mjs', 'javascript'],
    ['a.cjs', 'javascript'],
    ['a.jsx', 'jsx'],
    ['a.py', 'python'],
    ['a.pyi', 'python'],
    ['A.cs', 'csharp'],
    ['A.java', 'java'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['ci.yaml', 'yaml'],
    ['ci.yml', 'yaml'],
    ['run.sh', 'shell'],
    ['run.bash', 'shell'],
  ])('%s -> %s', (file, expected) => {
    expect(detectLanguage(file)).toBe(expected);
  });

  it('is case-insensitive and handles nested paths', () => {
    expect(detectLanguage('src/Foo.TS')).toBe('typescript');
  });

  it('prefers the extension over a shebang', () => {
    expect(detectLanguage('a.py', '#!/bin/bash')).toBe('python');
  });

  it('returns undefined for unknown files', () => {
    expect(detectLanguage('Makefile')).toBeUndefined();
    expect(detectLanguage('image.png')).toBeUndefined();
    expect(detectLanguage('constructor')).toBeUndefined();
  });
});

describe('detectLanguage by shebang', () => {
  it.each([
    ['#!/usr/bin/env python3', 'python'],
    ['#!/usr/bin/python', 'python'],
    ['#!/usr/bin/env python3.12', 'python'],
    ['#!/bin/bash', 'shell'],
    ['#!/bin/sh', 'shell'],
    ['#!/usr/bin/env node', 'javascript'],
    ['#!/usr/bin/env -S node --flag', 'javascript'],
    ['#! /usr/bin/env bash', 'shell'],
  ])('%s -> %s', (line, expected) => {
    expect(detectLanguage('script', line)).toBe(expected);
  });

  it('returns undefined for unknown interpreters or non-shebang lines', () => {
    expect(detectLanguage('script', '#!/usr/bin/perl')).toBeUndefined();
    expect(detectLanguage('script', '#!/usr/bin/env')).toBeUndefined();
    expect(detectLanguage('script', 'hello world')).toBeUndefined();
    expect(detectLanguage('script', '#!/usr/bin/env constructor')).toBeUndefined();
  });
});

describe('hasKnownExtension', () => {
  it('reports whether the extension is recognised', () => {
    expect(hasKnownExtension('a.go')).toBe(true);
    expect(hasKnownExtension('Makefile')).toBe(false);
  });
});
