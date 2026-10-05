#!/usr/bin/env node
import { closeSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { detectLanguage, hasKnownExtension } from './language.js';
import { walkFiles } from './walker.js';

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
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

async function runIndex(root: string, maxFileSize: number | undefined, io: Io): Promise<void> {
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

export function buildProgram(io: Io = defaultIo): Command {
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

  program
    .command('index')
    .description('Walk a directory and summarise the files by language')
    .argument('<path>', 'directory to index')
    .option('--max-file-size <bytes>', 'skip files larger than this many bytes', parsePositiveInt)
    .action(async (target: string, options: { maxFileSize?: number }) => {
      try {
        await runIndex(target, options.maxFileSize, io);
      } catch (error) {
        io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
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
