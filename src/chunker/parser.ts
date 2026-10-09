import { createRequire } from 'node:module';
import { Language as TsLanguage, Parser, type Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

/** Names of the grammars shipped by the tree-sitter-wasms package. */
export type Grammar = 'typescript' | 'tsx' | 'javascript' | 'python' | 'c_sharp';

let initialised: Promise<void> | undefined;
const languages = new Map<Grammar, Promise<TsLanguage>>();
const parsers = new Map<Grammar, Parser>();

async function loadGrammar(grammar: Grammar): Promise<TsLanguage> {
  initialised ??= Parser.init();
  await initialised;
  const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`);
  return TsLanguage.load(wasmPath);
}

/** Parses `source` with the given grammar. Grammars are loaded once and reused. */
export async function parse(grammar: Grammar, source: string): Promise<Tree> {
  let language = languages.get(grammar);
  if (!language) {
    language = loadGrammar(grammar);
    languages.set(grammar, language);
  }
  const loaded = await language;
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(loaded);
    parsers.set(grammar, parser);
  }
  const tree = parser.parse(source);
  if (!tree) throw new Error(`failed to parse source with the ${grammar} grammar`);
  return tree;
}
