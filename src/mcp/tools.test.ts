import { beforeAll, describe, expect, it } from 'vitest';
import type { Runtime } from '../runtime.js';
import { seededRuntime } from './fixtures.js';
import { fileContext, getSymbol, listFiles, searchCode, ToolError } from './tools.js';

let runtime: Runtime;
beforeAll(async () => {
  runtime = await seededRuntime();
});

describe('searchCode', () => {
  it('returns the best match first with its code', async () => {
    const text = await searchCode(runtime, { query: 'openDatabase url connected', limit: 2 });
    expect(text.split('\n')[0]).toContain('src/db.ts');
    expect(text).toContain('openDatabase');
    expect(text).toContain('```typescript');
  });

  it('applies the language filter', async () => {
    const text = await searchCode(runtime, { query: 'database', language: 'python' });
    expect(text).toContain('scripts/seed.py');
    expect(text).not.toContain('src/db.ts');
  });

  it('says so when nothing matches the filters', async () => {
    expect(await searchCode(runtime, { query: 'database', path: 'nope/' })).toBe('No results.');
  });

  it('rejects an empty query', async () => {
    await expect(searchCode(runtime, { query: '  ' })).rejects.toThrow('must not be empty');
  });
});

describe('getSymbol', () => {
  it('finds a method by bare name', async () => {
    const text = await getSymbol(runtime, { name: 'login' });
    expect(text).toContain('src/auth.ts:2-4  AuthService.login (method, typescript)');
    expect(text).toContain('password.length > 0');
  });

  it('accepts Class.method and restricts to the parent', async () => {
    expect(await getSymbol(runtime, { name: 'AuthService.logout' })).toContain('logout');
    await expect(getSymbol(runtime, { name: 'Other.logout' })).rejects.toBeInstanceOf(ToolError);
  });

  it('restricts to a path', async () => {
    await expect(getSymbol(runtime, { name: 'login', path: 'src/db.ts' })).rejects.toThrow(
      'in src/db.ts',
    );
  });

  it('explains an unknown symbol and rejects a blank one', async () => {
    await expect(getSymbol(runtime, { name: 'missing' })).rejects.toThrow('search_code');
    await expect(getSymbol(runtime, { name: ' ' })).rejects.toThrow('must not be empty');
  });
});

describe('listFiles', () => {
  it('lists every indexed file sorted', async () => {
    expect(await listFiles(runtime, {})).toBe('3 files\nscripts/seed.py\nsrc/auth.ts\nsrc/db.ts');
  });

  it('filters by prefix and truncates at the limit', async () => {
    expect(await listFiles(runtime, { path: 'src/', limit: 1 })).toBe(
      '2 files\nsrc/auth.ts\n... 1 more',
    );
    expect(await listFiles(runtime, { path: 'zzz/' })).toBe('No files.');
  });

  it('tells the user to index when the store is empty', async () => {
    const { InMemoryVectorStore } = await import('../store/index.js');
    const empty: Runtime = { ...runtime, store: new InMemoryVectorStore() };
    expect(await listFiles(empty, {})).toContain('repolens index');
  });
});

describe('fileContext', () => {
  it('shows an outline followed by each chunk in line order', async () => {
    const text = await fileContext(runtime, { path: 'src/auth.ts' });
    expect(text).toContain('Outline:\n- AuthService (class) lines');
    expect(text).toContain('- AuthService.login (method)');
    expect(text.indexOf('AuthService.login')).toBeLessThan(text.indexOf('AuthService.logout'));
    expect(text).toContain('```typescript');
  });

  it('rejects a path that is not indexed', async () => {
    await expect(fileContext(runtime, { path: 'src/none.ts' })).rejects.toThrow('list_files');
  });
});
