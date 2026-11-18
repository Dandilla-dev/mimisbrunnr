// Загрузка tree-sitter (WebAssembly) и грамматик. Один раз на процесс.
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import { Parser, Language } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

// В собранном приложении node_modules лежат внутри app.asar, а .wasm —
// рядом, в app.asar.unpacked (см. build.asarUnpack в package.json).
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const GRAMMARS = {
  python: 'tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
};

let ready = null;
const parsers = {};

export function grammarFor(file) {
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/.test(file)) return 'javascript';
  return null;
}

export async function initParsers() {
  if (ready) return ready;
  ready = (async () => {
    const coreWasm = unpacked(require.resolve('web-tree-sitter/tree-sitter.wasm'));
    await Parser.init({ locateFile: () => coreWasm });
    const outDir = unpacked(path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out'));
    for (const [name, file] of Object.entries(GRAMMARS)) {
      const lang = await Language.load(path.join(outDir, file));
      const p = new Parser();
      p.setLanguage(lang);
      parsers[name] = p;
    }
  })();
  return ready;
}

export function parse(grammar, text) {
  const p = parsers[grammar];
  if (!p) throw new Error(`Грамматика не загружена: ${grammar}`);
  return p.parse(text);
}

// ---- помощники для обхода дерева ----

export function field(node, name) {
  return node ? node.childForFieldName(name) : null;
}

export function* walk(node) {
  // обход в глубину без рекурсии (большие файлы не переполнят стек)
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    yield n;
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i));
  }
}

// Отпечаток кода: последовательность лексем без комментариев и пробелов.
// Сдвиг строк и правка комментариев отпечаток не меняют, правка кода — меняет.
export function codeHash(node, skip = () => false) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === 'comment' || (n !== node && skip(n))) continue;
    if (n.childCount === 0) { out.push(n.text); continue; }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
  }
  return crypto.createHash('sha1').update(out.join('\u0001')).digest('hex').slice(0, 12);
}

export function collapse(text, max = 240) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Текст узла от начала до начала тела — это и есть «подпись».
export function headText(node, body, source) {
  if (!body) return collapse(node.text);
  return collapse(source.slice(node.startIndex, body.startIndex).replace(/[:{]\s*$/, ''));
}
