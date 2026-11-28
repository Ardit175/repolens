#!/usr/bin/env node
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import {
  DEFAULT_TESTS_DEPTH,
  formatAffectedTests,
  getAffectedTests,
  MAX_CHANGED_FILES,
  MAX_TESTS_DEPTH,
} from './affected-tests.js';
import { formatBenchmark, parseQueries, runBenchmark } from './bench/bench.js';
import {
  DEFAULT_DEPS_DEPTH,
  formatFileDependencies,
  getFileDependencies,
  MAX_DEPS_DEPTH,
  type DependencyDirection,
} from './deps.js';
import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings/index.js';
import { formatImportCycles, getImportCycles } from './cycles.js';
import { formatDoctor, runDoctor } from './doctor.js';
import {
  DEFAULT_IMPACT_DEPTH,
  formatChangeImpact,
  getChangeImpact,
  MAX_IMPACT_DEPTH,
} from './impact.js';
import { changedFiles } from './git.js';
import { indexRepository, type IndexStats } from './indexer.js';
import { detectLanguage, hasKnownExtension } from './language.js';
import { buildMapData } from './map/build.js';
import { renderMapHtml } from './map/html.js';
import { serveStdio } from './mcp/server.js';
import {
  dropIndex,
  listIndexes,
  qdrantConnection,
  resolveIndexName,
  validateIndexName,
  type IndexInfo,
} from './indexes.js';
import { createRuntime, type Runtime } from './runtime.js';
import { formatIndexStatus, getIndexStatus, type WatchState } from './status.js';
import { InMemoryVectorStore } from './store/index.js';
import { formatHits, searchIndex, type SearchMode } from './search.js';
import { formatUnimportedFiles, getUnimportedFiles } from './orphans.js';
import { formatUnusedSymbols, getUnusedSymbols } from './unused.js';
import { loadIgnoreFilter, walkFiles } from './walker.js';
import { watchRepository, type WatchOptions, type Watcher } from './watch.js';

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

export interface Deps {
  createRuntime: (index?: string) => Runtime;
  listIndexes: () => Promise<IndexInfo[]>;
  changedFiles: (root: string, ref?: string) => Promise<string[]>;
  dropIndex: (name: string) => Promise<{ chunks: boolean; graph: boolean }>;
  createEmbeddings: () => EmbeddingProvider;
  serve: (runtime: Runtime, version: string) => Promise<void>;
  watch: (options: WatchOptions) => Watcher;
  exit: (code: number) => void;
}

const defaultDeps: Deps = {
  createRuntime: (index) => createRuntime(process.env, index === undefined ? {} : { index }),
  listIndexes: () => listIndexes(qdrantConnection()),
  changedFiles,
  dropIndex: (name) => dropIndex(qdrantConnection(), name),
  createEmbeddings: () => createEmbeddingProvider(),
  serve: serveStdio,
  watch: watchRepository,
  exit: (code) => process.exit(code),
};

const SHEBANG_PROBE_BYTES = 256;

function readVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new InvalidArgumentError('must be a positive integer.');
  }
  return Number(value);
}

const INDEX_OPTION_HELP = 'index name (default: REPOLENS_INDEX or "repolens")';

/** Adds `--index <name>` to a command that talks to the vector store. */
function withIndexOption(command: Command, help = INDEX_OPTION_HELP): Command {
  return command.option('--index <name>', help);
}

function parseSearchMode(value: string): SearchMode {
  if (value !== 'hybrid' && value !== 'semantic') {
    throw new InvalidArgumentError('must be "hybrid" or "semantic".');
  }
  return value;
}

function parseDirection(value: string): DependencyDirection {
  if (value !== 'imports' && value !== 'importers' && value !== 'both') {
    throw new InvalidArgumentError('must be "imports", "importers" or "both".');
  }
  return value;
}

function parseDepsDepth(value: string): number {
  const depth = parsePositiveInt(value);
  if (depth > MAX_DEPS_DEPTH) {
    throw new InvalidArgumentError(`must be at most ${MAX_DEPS_DEPTH}.`);
  }
  return depth;
}

function parseImpactDepth(value: string): number {
  const depth = parsePositiveInt(value);
  if (depth > MAX_IMPACT_DEPTH) {
    throw new InvalidArgumentError(`must be at most ${MAX_IMPACT_DEPTH}.`);
  }
  return depth;
}

function parseTestsDepth(value: string): number {
  const depth = parsePositiveInt(value);
  if (depth > MAX_TESTS_DEPTH) {
    throw new InvalidArgumentError(`must be at most ${MAX_TESTS_DEPTH}.`);
  }
  return depth;
}

/** Reads only the start of a file and returns its first line. */
function readFirstLine(absolutePath: string): string {
  const fd = openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(SHEBANG_PROBE_BYTES);
    const bytes = readSync(fd, buffer, 0, SHEBANG_PROBE_BYTES, 0);
    return buffer.toString('utf8', 0, bytes).split(/\r?\n/, 1)[0] ?? '';
  } finally {
    closeSync(fd);
  }
}

function formatSummary(total: number, counts: Map<string, number>, unrecognised: number): string {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const nameWidth = Math.max('Language'.length, ...rows.map(([name]) => name.length));
  const countWidth = Math.max('Files'.length, ...rows.map(([, n]) => String(n).length));
  const lines = [`Indexed ${total} file${total === 1 ? '' : 's'}`, ''];
  if (rows.length > 0) {
    lines.push(`${'Language'.padEnd(nameWidth)}  ${'Files'.padStart(countWidth)}`);
    for (const [name, n] of rows) {
      lines.push(`${name.padEnd(nameWidth)}  ${String(n).padStart(countWidth)}`);
    }
    lines.push('');
  }
  lines.push(`Unrecognised: ${unrecognised}`);
  return lines.join('\n') + '\n';
}

async function runDryRun(root: string, maxFileSize: number | undefined, io: Io): Promise<void> {
  const files = await walkFiles(root, maxFileSize === undefined ? {} : { maxFileSize });
  const counts = new Map<string, number>();
  let unrecognised = 0;
  for (const file of files) {
    let language = detectLanguage(file.path);
    if (language === undefined && !hasKnownExtension(file.path)) {
      try {
        language = detectLanguage(file.path, readFirstLine(file.absolutePath));
      } catch {
        language = undefined;
      }
    }
    if (language === undefined) unrecognised++;
    else counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  io.out(formatSummary(files.length, counts, unrecognised));
}

function formatIndexStats(stats: IndexStats, index: string): string {
  const lines = [
    `Index: ${index}`,
    `Scanned ${stats.filesScanned} file${stats.filesScanned === 1 ? '' : 's'}`,
    `Changed: ${stats.filesChanged} (${stats.chunksEmbedded} chunks embedded)`,
    `Unchanged: ${stats.filesUnchanged}`,
    `Removed: ${stats.filesRemoved}`,
    `Graph files updated: ${stats.graphFilesUpdated}`,
  ];
  if (stats.filesSkipped > 0) lines.push(`Skipped (unreadable or binary): ${stats.filesSkipped}`);
  return lines.join('\n') + '\n';
}

function formatIndexes(indexes: IndexInfo[]): string {
  if (indexes.length === 0) return 'No indexes yet. Run `repolens index <path>` to create one.\n';
  const header = ['name', 'chunks', 'files', 'dims'];
  const rows = indexes.map((i) => [i.name, i.chunks, i.graphFiles, i.dimensions].map(String));
  const widths = header.map((h, col) => Math.max(h.length, ...rows.map((r) => r[col]!.length)));
  const format = (cells: string[]) =>
    cells
      .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!)))
      .join('  ')
      .trimEnd();
  return [format(header), ...rows.map(format)].join('\n') + '\n';
}

function assertDirectory(target: string): void {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(target).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`${target} is not a directory`);
}

function formatReindexed(stats: IndexStats, paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  const more = paths.length > 3 ? `, +${paths.length - 3} more` : '';
  const detail = paths.length > 0 ? ` (${shown}${more})` : '';
  return `Re-indexed: ${stats.filesChanged} changed, ${stats.filesRemoved} removed, ${stats.chunksEmbedded} chunks embedded${detail}\n`;
}

interface WatchSession {
  target: string;
  runtime: Runtime;
  index: string;
  maxFileSize?: number;
  debounceMs?: number;
  /** Where progress and errors go. `serve` needs this to be stderr. */
  log: (s: string) => void;
  logError: (s: string) => void;
}

/**
 * Runs one index pass, then keeps the index fresh with a watcher until Ctrl+C.
 * Resolves once the watcher is started; the fs watcher keeps the process alive.
 */
async function indexAndWatch(session: WatchSession, deps: Deps): Promise<void> {
  const { target, runtime, log, logError } = session;
  const watchState: WatchState = { root: target, passes: 0 };
  runtime.watch = watchState;
  const recordPass = () => {
    watchState.passes++;
    watchState.lastPassAt = new Date();
    delete watchState.lastError;
    delete watchState.lastErrorAt;
  };
  const indexOnce = () =>
    indexRepository({
      root: target,
      store: runtime.store,
      graph: runtime.graph,
      embeddings: runtime.embeddings,
      ...(session.maxFileSize === undefined ? {} : { maxFileSize: session.maxFileSize }),
    });
  log(formatIndexStats(await indexOnce(), session.index));
  recordPass();
  log(`Watching ${target} for changes (Ctrl+C to stop)\n`);

  let isIgnored = await loadIgnoreFilter(target);
  // Reloading after each pass lets .gitignore edits take effect for later events.
  const reindex = async () => {
    const stats = await indexOnce();
    isIgnored = await loadIgnoreFilter(target);
    return stats;
  };
  const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const watcher = deps.watch({
    root: target,
    reindex,
    isIgnored: (relativePath) => isIgnored(relativePath),
    ...(session.debounceMs === undefined ? {} : { debounceMs: session.debounceMs }),
    onIndexed: (stats, paths) => {
      recordPass();
      if (stats.filesChanged + stats.filesRemoved + stats.graphFilesUpdated > 0) {
        log(formatReindexed(stats, paths));
      }
    },
    onError: (error) => {
      watchState.lastError = describeError(error);
      watchState.lastErrorAt = new Date();
      logError(`error: ${describeError(error)}\n`);
    },
    onFatal: (error) => {
      logError(`error: file watcher stopped: ${describeError(error)}\n`);
      deps.exit(1);
    },
  });
  process.once('SIGINT', () => {
    void watcher.close().finally(() => deps.exit(0));
  });
}

function fail(io: Io, error: unknown): void {
  io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

export function buildProgram(io: Io = defaultIo, deps: Deps = defaultDeps): Command {
  const program = new Command('repolens');
  program
    .description('Index a codebase and serve it to LLMs.')
    .version(readVersion())
    .configureOutput({
      writeOut: io.out,
      writeErr: io.err,
    })
    .exitOverride((error) => {
      // Help and version exit with code 0; anything else is a usage error.
      if (error.exitCode !== 0) process.exitCode = 1;
      throw error;
    });

  withIndexOption(
    program
      .command('index')
      .description('Embed a directory into the vector store, re-embedding only changed files')
      .argument('<path>', 'directory to index')
      .option('--max-file-size <bytes>', 'skip files larger than this many bytes', parsePositiveInt)
      .option('--dry-run', 'only walk the directory and summarise files by language'),
  ).action(
    async (target: string, options: { maxFileSize?: number; dryRun?: boolean; index?: string }) => {
      try {
        if (options.dryRun) {
          await runDryRun(target, options.maxFileSize, io);
          return;
        }
        const index = resolveIndexName(options.index);
        const { store, graph, embeddings } = deps.createRuntime(options.index);
        const stats = await indexRepository({
          root: target,
          store,
          graph,
          embeddings,
          ...(options.maxFileSize === undefined ? {} : { maxFileSize: options.maxFileSize }),
        });
        io.out(formatIndexStats(stats, index));
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('search')
      .description('Search the index with a natural-language query')
      .argument('<query>', 'what to look for')
      .option('-n, --limit <count>', 'number of results', parsePositiveInt, 5)
      .option('--path <prefix>', 'only files under this directory, e.g. src/')
      .option('--language <name>', 'only this language, e.g. typescript')
      .option('--semantic', 'vector similarity only, without boosting exact symbol names'),
  ).action(
    async (
      query: string,
      options: {
        limit: number;
        path?: string;
        language?: string;
        semantic?: boolean;
        index?: string;
      },
    ) => {
      try {
        const { store, embeddings } = deps.createRuntime(options.index);
        const filter = {
          ...(options.path === undefined ? {} : { pathPrefix: options.path }),
          ...(options.language === undefined ? {} : { language: options.language }),
        };
        const mode: SearchMode = options.semantic ? 'semantic' : 'hybrid';
        const hits = await searchIndex({
          store,
          embeddings,
          query,
          limit: options.limit,
          filter,
          mode,
        });
        io.out(formatHits(hits));
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('watch')
      .description('Index a directory, then re-index changed files while you edit')
      .argument('<path>', 'directory to watch')
      .option('--max-file-size <bytes>', 'skip files larger than this many bytes', parsePositiveInt)
      .option(
        '--debounce <ms>',
        'quiet period after the last change before re-indexing',
        parsePositiveInt,
        300,
      ),
  ).action(
    async (target: string, options: { maxFileSize?: number; debounce: number; index?: string }) => {
      try {
        assertDirectory(target);
        await indexAndWatch(
          {
            target,
            index: resolveIndexName(options.index),
            runtime: deps.createRuntime(options.index),
            debounceMs: options.debounce,
            log: io.out,
            logError: io.err,
            ...(options.maxFileSize === undefined ? {} : { maxFileSize: options.maxFileSize }),
          },
          deps,
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('serve')
      .description('Serve the index to an MCP client over stdio (search_code, get_symbol, ...)')
      .option(
        '--watch <path>',
        'index this directory first and keep the index fresh while serving',
      ),
  ).action(async (options: { watch?: string; index?: string }) => {
    try {
      const runtime = deps.createRuntime(options.index);
      if (options.watch !== undefined) {
        assertDirectory(options.watch);
        // stdout carries the MCP protocol, so all watch output goes to stderr.
        await indexAndWatch(
          {
            target: options.watch,
            index: resolveIndexName(options.index),
            runtime,
            log: io.err,
            logError: io.err,
          },
          deps,
        );
      }
      await deps.serve(runtime, readVersion());
    } catch (error) {
      fail(io, error);
    }
  });

  withIndexOption(
    program
      .command('map')
      .description('Write a self-contained interactive HTML map of file dependencies')
      .option('-o, --output <file>', 'where to write the HTML file', 'repolens-map.html')
      .option('--path <prefix>', 'only files under this directory, e.g. src/'),
  ).action(async (options: { output: string; path?: string; index?: string }) => {
    try {
      const { store, graph } = deps.createRuntime(options.index);
      const data = await buildMapData(store, graph, {
        ...(options.path === undefined ? {} : { pathPrefix: options.path }),
      });
      if (data.nodes.length === 0) {
        throw new Error('The index has no files to map. Run `repolens index <path>` first.');
      }
      const html = renderMapHtml(data, {
        title: options.path ? `repolens map: ${options.path}` : 'repolens map',
        generatedAt: new Date().toISOString(),
      });
      const target = path.resolve(options.output);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, html);
      io.out(
        `Wrote ${target}\n${data.nodes.length} files, ${data.links.length} links, ${data.unresolvedImports} unresolved imports\n`,
      );
    } catch (error) {
      fail(io, error);
    }
  });

  withIndexOption(
    program
      .command('bench')
      .description(
        'Measure index time, search latency and recall on a directory with a queries file',
      )
      .argument('<path>', 'directory to index')
      .requiredOption('--queries <file>', 'JSON file: [{ "query": "...", "expect": ["src/a.ts"] }]')
      .option('-n, --limit <count>', 'top results that count for recall', parsePositiveInt, 5)
      .option('--mode <mode>', 'search mode: hybrid or semantic', parseSearchMode, 'hybrid')
      .option('--label <text>', 'heading for the markdown result', 'benchmark')
      .option(
        '--qdrant',
        'use the Qdrant collection from QDRANT_URL instead of an in-memory store',
      ),
    'index name with --qdrant (default: REPOLENS_INDEX or "repolens"); ignored for the in-memory store',
  ).action(
    async (
      target: string,
      options: {
        queries: string;
        limit: number;
        mode: SearchMode;
        label: string;
        qdrant?: boolean;
        index?: string;
      },
    ) => {
      try {
        const queries = parseQueries(readFileSync(options.queries, 'utf8'));
        const { store, embeddings } = options.qdrant
          ? deps.createRuntime(options.index)
          : { store: new InMemoryVectorStore(), embeddings: deps.createEmbeddings() };
        const result = await runBenchmark({
          root: target,
          store,
          embeddings,
          queries,
          limit: options.limit,
          mode: options.mode,
        });
        io.out(formatBenchmark(result, options.label));
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('status')
      .description('Show the size, provider and health of an index')
      .option('--json', 'print the status as JSON'),
  ).action(async (options: { json?: boolean; index?: string }) => {
    try {
      const { index, store, graph, embeddings } = deps.createRuntime(options.index);
      const status = await getIndexStatus({ index, store, graph, embeddings });
      io.out((options.json ? JSON.stringify(status, null, 2) : formatIndexStatus(status)) + '\n');
    } catch (error) {
      fail(io, error);
    }
  });

  withIndexOption(
    program
      .command('deps')
      .description('Show which files a file imports and which files import it')
      .argument('<file>', 'indexed path relative to the indexed root, e.g. src/auth.ts')
      .option(
        '--direction <direction>',
        'imports, importers or both',
        parseDirection,
        'both' satisfies DependencyDirection,
      )
      .option(
        '--depth <n>',
        `levels to follow, 1 to ${MAX_DEPS_DEPTH}`,
        parseDepsDepth,
        DEFAULT_DEPS_DEPTH,
      )
      .option('--json', 'print the dependencies as JSON'),
  ).action(
    async (
      file: string,
      options: { direction: DependencyDirection; depth: number; json?: boolean; index?: string },
    ) => {
      try {
        const { store, graph } = deps.createRuntime(options.index);
        const result = await getFileDependencies(store, graph, {
          path: file,
          direction: options.direction,
          depth: options.depth,
        });
        io.out(
          (options.json ? JSON.stringify(result, null, 2) : formatFileDependencies(result)) + '\n',
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('impact')
      .description('Show what a change to a file or one of its symbols can reach')
      .argument('<file>', 'indexed path relative to the indexed root, e.g. src/auth.ts')
      .option('--symbol <name>', 'limit the call sites to one symbol of the file')
      .option(
        '--depth <n>',
        `import levels to follow, 1 to ${MAX_IMPACT_DEPTH}`,
        parseImpactDepth,
        DEFAULT_IMPACT_DEPTH,
      )
      .option('--json', 'print the impact as JSON'),
  ).action(
    async (
      file: string,
      options: { symbol?: string; depth: number; json?: boolean; index?: string },
    ) => {
      try {
        const { store, graph } = deps.createRuntime(options.index);
        const result = await getChangeImpact(store, graph, {
          path: file,
          ...(options.symbol === undefined ? {} : { symbol: options.symbol }),
          depth: options.depth,
        });
        io.out(
          (options.json ? JSON.stringify(result, null, 2) : formatChangeImpact(result)) + '\n',
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('tests')
      .description('List the test files to run after changing files')
      .argument('[files...]', 'changed paths relative to the indexed root, e.g. src/auth.ts')
      .option(
        '--changed [ref]',
        'take the changed files from git: against HEAD, or against the merge base with <ref>',
      )
      .option('--root <path>', 'indexed repository root, used with --changed', '.')
      .option(
        '--depth <n>',
        `import levels to follow, 1 to ${MAX_TESTS_DEPTH}`,
        parseTestsDepth,
        DEFAULT_TESTS_DEPTH,
      )
      .option('--json', 'print the affected tests as JSON'),
  ).action(
    async (
      files: string[],
      options: {
        changed?: string | true;
        root: string;
        depth: number;
        json?: boolean;
        index?: string;
      },
    ) => {
      try {
        const gitMode = options.changed !== undefined;
        if (gitMode && files.length > 0) {
          throw new Error('pass files or --changed, not both.');
        }
        if (!gitMode && files.length === 0) {
          throw new Error('pass the changed files or use --changed to take them from git.');
        }
        let paths = files;
        if (gitMode) {
          const ref = options.changed === true ? undefined : options.changed;
          paths = await deps.changedFiles(options.root, ref);
          if (paths.length === 0) {
            io.out(
              options.json
                ? JSON.stringify(
                    { changed: [], tests: [], total: 0, truncated: false, skipped: [] },
                    null,
                    2,
                  ) + '\n'
                : `No changed files compared to ${ref ?? 'HEAD'}.\n`,
            );
            return;
          }
          if (paths.length > MAX_CHANGED_FILES) {
            throw new Error(
              `git reports ${paths.length} changed files; at most ${MAX_CHANGED_FILES} are allowed. Pass a closer ref or list the files.`,
            );
          }
        }
        const { store, graph } = deps.createRuntime(options.index);
        const result = await getAffectedTests(store, graph, {
          paths,
          depth: options.depth,
          ...(gitMode ? { skipUnknown: true } : {}),
        });
        io.out(
          (options.json ? JSON.stringify(result, null, 2) : formatAffectedTests(result)) + '\n',
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('unused')
      .description('List functions and methods nothing in the index calls or imports by name')
      .option('--path <prefix>', 'only report files under this directory prefix, e.g. src/')
      .option('--language <lang>', 'only report this language, e.g. typescript')
      .option('--include-tests', 'also report symbols in test files')
      .option('--json', 'print the unused symbols as JSON'),
  ).action(
    async (options: {
      path?: string;
      language?: string;
      includeTests?: boolean;
      json?: boolean;
      index?: string;
    }) => {
      try {
        const { store, graph } = deps.createRuntime(options.index);
        const result = await getUnusedSymbols(store, graph, {
          ...(options.path === undefined ? {} : { pathPrefix: options.path }),
          ...(options.language === undefined ? {} : { language: options.language }),
          ...(options.includeTests === true ? { includeTests: true } : {}),
        });
        io.out(
          (options.json ? JSON.stringify(result, null, 2) : formatUnusedSymbols(result)) + '\n',
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('orphans')
      .description('List source files that no other indexed file imports')
      .option('--path <prefix>', 'only report files under this directory prefix, e.g. src/')
      .option('--language <lang>', 'only report this language, e.g. typescript')
      .option('--include-tests', 'also report test files')
      .option('--json', 'print the unimported files as JSON'),
  ).action(
    async (options: {
      path?: string;
      language?: string;
      includeTests?: boolean;
      json?: boolean;
      index?: string;
    }) => {
      try {
        const { store, graph } = deps.createRuntime(options.index);
        const result = await getUnimportedFiles(store, graph, {
          ...(options.path === undefined ? {} : { pathPrefix: options.path }),
          ...(options.language === undefined ? {} : { language: options.language }),
          ...(options.includeTests === true ? { includeTests: true } : {}),
        });
        io.out(
          (options.json ? JSON.stringify(result, null, 2) : formatUnimportedFiles(result)) + '\n',
        );
      } catch (error) {
        fail(io, error);
      }
    },
  );

  withIndexOption(
    program
      .command('cycles')
      .description('List groups of files that import each other in a ring')
      .option('--path <prefix>', 'only report cycles touching this directory prefix, e.g. src/')
      .option('--json', 'print the import cycles as JSON'),
  ).action(async (options: { path?: string; json?: boolean; index?: string }) => {
    try {
      const { store, graph } = deps.createRuntime(options.index);
      const result = await getImportCycles(store, graph, {
        ...(options.path === undefined ? {} : { pathPrefix: options.path }),
      });
      io.out((options.json ? JSON.stringify(result, null, 2) : formatImportCycles(result)) + '\n');
    } catch (error) {
      fail(io, error);
    }
  });

  program
    .command('indexes')
    .description('List the indexes in Qdrant')
    .action(async () => {
      try {
        io.out(formatIndexes(await deps.listIndexes()));
      } catch (error) {
        fail(io, error);
      }
    });

  program
    .command('drop')
    .description('Delete an index (its chunks and its graph)')
    .argument('<name>', 'index to delete')
    .option('--yes', 'confirm the deletion')
    .action(async (name: string, options: { yes?: boolean }) => {
      try {
        validateIndexName(name);
        if (!options.yes) {
          io.err(`This deletes index "${name}" and its graph. Run again with --yes to confirm.\n`);
          process.exitCode = 1;
          return;
        }
        const dropped = await deps.dropIndex(name);
        if (!dropped.chunks && !dropped.graph) {
          io.err(`No index named "${name}".\n`);
          process.exitCode = 1;
          return;
        }
        io.out(`Dropped index "${name}".\n`);
      } catch (error) {
        fail(io, error);
      }
    });

  program
    .command('doctor')
    .description('Check Node, Qdrant and the embedding provider configuration')
    .action(async () => {
      const results = await runDoctor();
      io.out(formatDoctor(results));
      if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
    });

  // Subcommands inherit output config and exit override from the parent.
  program.commands.forEach((cmd) => cmd.copyInheritedSettings(program));
  return program;
}

export async function main(argv: string[], io: Io = defaultIo): Promise<void> {
  const program = buildProgram(io);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already printed the message and set the exit code.
      return;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main(process.argv);
}
