import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, main } from './cli.js';

let dir: string;
let out: string;
let err: string;
const io = {
  out: (s: string) => void (out += s),
  err: (s: string) => void (err += s),
};

function write(rel: string, content = 'x'): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

async function run(...args: string[]): Promise<void> {
  await main(['node', 'repolens', ...args], io);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'repolens-cli-'));
  out = '';
  err = '';
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('repolens index', () => {
  it('prints totals and a per-language table sorted by count', async () => {
    write('a.ts');
    write('b.ts');
    write('c.ts');
    write('d.py');
    write('e.go');
    write('e2.go');
    write('notes.xyz');
    await run('index', dir);
    expect(err).toBe('');
    expect(process.exitCode).toBeUndefined();
    expect(out).toContain('Indexed 7 files');
    expect(out).toContain('Unrecognised: 1');
    const lines = out.split('\n');
    const order = ['typescript', 'go', 'python'].map((l) =>
      lines.findIndex((x) => x.startsWith(l)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out).toMatch(/typescript\s+3/);
  });

  it('uses the shebang for files without a known extension', async () => {
    write('tool', '#!/usr/bin/env python3\nprint(1)\n');
    write('runner', '#!/bin/bash\necho hi\n');
    write('plain', 'just text\n');
    await run('index', dir);
    expect(out).toMatch(/python\s+1/);
    expect(out).toMatch(/shell\s+1/);
    expect(out).toContain('Unrecognised: 1');
  });

  it('handles an empty directory', async () => {
    await run('index', dir);
    expect(out).toContain('Indexed 0 files');
    expect(out).toContain('Unrecognised: 0');
  });

  it('honours --max-file-size', async () => {
    write('small.ts', 'a');
    write('big.ts', 'a'.repeat(1000));
    await run('index', dir, '--max-file-size', '100');
    expect(out).toContain('Indexed 1 file\n');
  });

  it('reports a missing path', async () => {
    await run('index', path.join(dir, 'missing'));
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
    expect(out).toBe('');
  });

  it.each(['0', '-5', 'abc', '1.5'])('rejects --max-file-size %s', async (value) => {
    await run('index', dir, '--max-file-size', value);
    expect(err).toMatch(/^error: .*--max-file-size/);
    expect(err).toContain('positive integer');
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing path argument', async () => {
    await run('index');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
  });
});

describe('repolens program', () => {
  it('shows help without failing', async () => {
    await run('--help');
    expect(out).toContain('Usage: repolens');
    expect(out).toContain('index');
    expect(process.exitCode).toBeUndefined();
  });

  it('shows index help with the option', async () => {
    await run('index', '--help');
    expect(out).toContain('--max-file-size <bytes>');
  });

  it('prints the package version', async () => {
    await run('--version');
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands', async () => {
    await run('nope');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
  });

  it('works through buildProgram().parseAsync', async () => {
    write('a.rs');
    await buildProgram(io).parseAsync(['node', 'repolens', 'index', dir]);
    expect(out).toMatch(/rust\s+1/);
  });
});
