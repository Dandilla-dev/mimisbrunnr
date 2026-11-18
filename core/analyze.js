// Разбор всего репозитория: файлы → функции/классы → граф вызовов → слои по папкам.
import { initParsers, grammarFor } from './parse/treesitter.js';
import { parsePython, pythonEdges } from './parse/python.js';
import { parseJs, jsEdges } from './parse/js.js';

/**
 * @param {{path: string, text: string}[]} sources
 * @returns {{files: object, items: object[], edges: string[][], code: object}}
 */
export async function analyzeSources(sources) {
  await initParsers();
  const files = {};
  const items = [];
  const code = {};
  const pyFacts = {};
  const jsFacts = {};
  const itemsByFile = {};

  for (const { path: file, text } of sources) {
    const grammar = grammarFor(file);
    if (!grammar) continue;
    code[file] = text;
    const lang = grammar === 'python' ? 'python' : grammar === 'javascript' ? 'javascript' : 'typescript';
    const entry = { lang, lines: text.split('\n').length, doc: '', error: null };
    try {
      const res = grammar === 'python' ? parsePython(file, text) : parseJs(file, text, grammar);
      entry.doc = res.doc;
      items.push(...res.items);
      itemsByFile[file] = res.items;
      if (grammar === 'python') pyFacts[file] = res.facts; else jsFacts[file] = res.facts;
    } catch (e) {
      entry.error = `Не удалось разобрать файл: ${e.message}`;
      itemsByFile[file] = [];
    }
    files[file] = entry;
  }

  const ids = new Set(items.map((i) => i.id));
  const edges = [...pythonEdges(pyFacts, ids), ...jsEdges(jsFacts, itemsByFile, ids)];
  return { files, items, edges, code };
}

/**
 * Слои «по папкам» — без ИИ. Если почти всё лежит в одной папке (src/),
 * группируем на уровень глубже.
 */
export function layersByFolder(filePaths) {
  const groupKey = (p, depth) => {
    const parts = p.split('/');
    return parts.length - 1 > depth - 1 ? parts.slice(0, depth).join('/') : '';
  };
  let depth = 1;
  for (; depth < 4; depth++) {
    const keys = new Set(filePaths.map((p) => groupKey(p, depth)));
    const biggest = Math.max(...[...keys].map((k) => filePaths.filter((p) => groupKey(p, depth) === k).length));
    if (keys.size > 1 && biggest / filePaths.length < 0.8) break;
  }
  const groups = {};
  for (const p of filePaths) (groups[groupKey(p, depth)] ||= []).push(p);
  return Object.entries(groups)
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([k, fs], i) => ({
      id: `L${i + 1}`,
      name: k ? `${k}/` : 'Корень проекта',
      description: k ? `Файлы из папки ${k}/` : 'Файлы в корне репозитория',
      files: fs.sort(),
    }));
}
