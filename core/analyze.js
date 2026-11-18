// Разбор всего репозитория: файлы → функции/классы → граф вызовов → слои по папкам.
import { initParsers, grammarFor } from './parse/treesitter.js';
import { parsePython, pythonSites } from './parse/python.js';
import { parseJs, jsSites } from './parse/js.js';

/**
 * @param {{path: string, text: string}[]} sources
 * @returns {{files: object, items: object[], edges: string[][], sites: object[], code: object}}
 * edges: [откуда, куда, 'call'|'ref'] — по одному на пару; sites — каждое место в коде.
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

  const kinds = new Map(items.map((i) => [i.id, i.kind]));
  const raw = [...pythonSites(pyFacts, kinds), ...jsSites(jsFacts, itemsByFile, kinds)];
  // одно место — одна запись (вызов в аргументах другого вызова не дублируем)
  const seen = new Set();
  const sites = raw.filter((s) => { const k = `${s.src}\u0000${s.tgt}\u0000${s.line}\u0000${s.kind}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : a.line - b.line));
  const pair = new Map();
  for (const s of sites) {
    const k = `${s.src}\u0000${s.tgt}`;
    if (!pair.has(k) || s.kind === 'call') pair.set(k, s.kind);
  }
  const edges = [...pair].map(([k, kind]) => [...k.split('\u0000'), kind]);
  return { files, items, edges, sites, code };
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
