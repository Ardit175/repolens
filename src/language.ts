import path from 'node:path';

export type Language =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'python'
  | 'csharp'
  | 'java'
  | 'go'
  | 'rust'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'shell';

const BY_EXTENSION: Record<string, Language> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.pyi': 'python',
  '.cs': 'csharp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.json': 'json',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'shell',
  '.bash': 'shell',
};

const BY_INTERPRETER: Record<string, Language> = {
  python: 'python',
  python2: 'python',
  python3: 'python',
  node: 'javascript',
  nodejs: 'javascript',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
};

/** True when the file's extension alone identifies its language. */
export function hasKnownExtension(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in BY_EXTENSION;
}

function fromShebang(line: string): Language | undefined {
  const match = /^#!\s*(\S+)(?:\s+(.*))?$/.exec(line.trim());
  if (!match) return undefined;
  const program = path.posix.basename(match[1] ?? '');
  let interpreter = program;
  if (program === 'env') {
    // Skip env flags such as -S and variable assignments.
    const args = (match[2] ?? '').split(/\s+/);
    interpreter = args.find((a) => a !== '' && !a.startsWith('-') && !a.includes('=')) ?? '';
  }
  // Strip version suffixes such as python3.12.
  const normalised = interpreter.replace(/^(python\d?)\.\d+$/, '$1');
  return Object.hasOwn(BY_INTERPRETER, normalised) ? BY_INTERPRETER[normalised] : undefined;
}

/** Detects a language from the extension first, then from a shebang line. */
export function detectLanguage(filePath: string, firstLine?: string): Language | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (Object.hasOwn(BY_EXTENSION, ext)) return BY_EXTENSION[ext];
  return firstLine === undefined ? undefined : fromShebang(firstLine);
}
