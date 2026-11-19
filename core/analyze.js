// Разбор всего репозитория: файлы → функции/классы → граф вызовов → слои по папкам.
import { initParsers, grammarFor } from './parse/treesitter.js';
import { parsePython, pythonSites } from './parse/python.js';
import { parseJs, jsSites } from './parse/js.js';
import { parsePrisma } from './parse/prisma.js';

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

  const prisma = [];
  for (const { path: file, text } of sources) {
    if (file.endsWith('.prisma')) {
      code[file] = text;
      const r = parsePrisma(file, text);
      files[file] = { lang: 'prisma', lines: text.split('\n').length, doc: '', error: null };
      items.push(...r.items); itemsByFile[file] = r.items; prisma.push(...r.entities);
      continue;
    }
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
  const js = jsSites(jsFacts, itemsByFile, kinds, prisma);
  const py = pythonSites(pyFacts, kinds);
  // классы-наследники моделей из других файлов (class UserOut(UserBase)) — тоже сущности
  for (const id of py.promote || []) { const it = items.find((i) => i.id === id); if (it) it.kind = 'entity'; kinds.set(id, 'entity'); }
  const pySites = Array.isArray(py) ? py : py.sites;
  const raw = [...pySites, ...js.sites];
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
  // сущности, путь запроса, роли и «что внутри функций»
  const entities = [...js.entities, ...prisma, ...(py.entities || [])].map(({ needsInit, schemaVar, ...e }) => e); // eslint-disable-line no-unused-vars
  const web = { routes: [...js.web.routes, ...(py.web?.routes || [])] };
  const roles = { ...(py.web?.roles || {}), ...js.web.roles };
  const flows = {};
  for (const f of [...Object.values(jsFacts), ...Object.values(pyFacts)]) Object.assign(flows, f.flows || {});
  // что отвечает обработчик: res.json / return / throw / next(err) — из «что внутри»
  for (const r of web.routes) {
    const h = r.chain.find((s) => s.role === 'handler')?.id || r.id;
    const f = flows[h];
    r.handlerFile = h.split('::')[0];
    r.out = (f?.outputs || []).filter((o) => ['response', 'return', 'throw', 'next'].includes(o.kind)).slice(0, 12);
    // обработчик ошибок: какими кодами он отвечает
    for (const e of r.errors) {
      const eo = e.id && flows[e.id]?.outputs?.filter((o) => o.kind === 'response' || o.kind === 'return');
      if (eo?.length && !e.about) e.about = `отвечает: ${[...new Set(eo.map((o) => o.status).filter(Boolean))].join(', ') || eo.map((o) => o.text).join('; ')}`;
    }
  }
  return { files, items, edges, sites, code, entities, web, roles, flows };
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
