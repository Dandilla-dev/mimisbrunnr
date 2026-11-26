// Настройки (settings.json) и сессии разбора (*.mimis — база SQLite).
// sql.js — SQLite, собранный в WebAssembly: никаких нативных модулей,
// одинаково работает на Windows, macOS и Linux.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
let SQL = null;
async function sql() {
  if (!SQL) {
    const wasm = unpacked(require.resolve('sql.js/dist/sql-wasm.wasm'));
    SQL = await initSqlJs({ locateFile: () => wasm });
  }
  return SQL;
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// ---------------------------------------------------------------- настройки

export const DEFAULT_SETTINGS = {
  name: '',
  provider: { type: 'anthropic', baseUrl: '', model: '', priceIn: 0, priceOut: 0 },
  budgetUsd: 1,
  spend: {}, // 'YYYY-MM' → потрачено, $
};

/**
 * crypt: { available: bool, encrypt(str)→base64, decrypt(base64)→str } — в
 * Electron это safeStorage (ключ шифруется средствами ОС). Без него ключ
 * хранится открытым текстом, и интерфейс об этом предупреждает.
 */
export class Settings {
  constructor(dir, crypt) {
    this.file = path.join(dir, 'settings.json');
    this.crypt = crypt;
    fs.mkdirSync(dir, { recursive: true });
    try { this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
    catch { this.data = structuredClone(DEFAULT_SETTINGS); }
  }
  _secret(field) {
    const v = this.data[field];
    if (!v) return '';
    if (v.enc) { try { return this.crypt.decrypt(v.enc); } catch { return ''; } }
    return v.plain || '';
  }
  _setSecret(field, value) {
    if (value === undefined) return;
    if (!value) { delete this.data[field]; return; }
    this.data[field] = this.crypt?.available ? { enc: this.crypt.encrypt(value) } : { plain: value };
  }
  apiKey() { return this._secret('apiKey'); }
  githubToken() { return this._secret('githubToken'); }
  /** То, что видит интерфейс: без самих секретов. */
  public() {
    const { apiKey, githubToken, ...rest } = this.data;
    return {
      ...rest,
      hasApiKey: Boolean(this.apiKey()),
      hasGithubToken: Boolean(this.githubToken()),
      keyEncrypted: Boolean(this.crypt?.available),
      monthSpend: this.data.spend[new Date().toISOString().slice(0, 7)] || 0,
    };
  }
  update(patch) {
    const { apiKey, githubToken, ...rest } = patch;
    if (rest.provider) rest.provider = { ...this.data.provider, ...rest.provider };
    Object.assign(this.data, rest);
    this._setSecret('apiKey', apiKey);
    this._setSecret('githubToken', githubToken);
    this.save();
    return this.public();
  }
  addSpend(usd) {
    const m = new Date().toISOString().slice(0, 7);
    this.data.spend[m] = Math.round(((this.data.spend[m] || 0) + usd) * 1e6) / 1e6;
    this.save();
  }
  save() { atomicWrite(this.file, JSON.stringify(this.data, null, 2)); }
}

// ---------------------------------------------------------------- сессии

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, lang TEXT, lines INT, doc TEXT, purpose TEXT, layer TEXT, error TEXT, code TEXT);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, file TEXT, name TEXT, kind TEXT, line INT, end_line INT, sig TEXT, route TEXT, doc TEXT, hash TEXT, ord INT);
CREATE TABLE IF NOT EXISTS edges(src TEXT, dst TEXT, kind TEXT DEFAULT 'call');
CREATE TABLE IF NOT EXISTS sites(src TEXT, dst TEXT, line INT, kind TEXT, ctx TEXT, label TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS flows(id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS walks(id TEXT PRIMARY KEY, hash TEXT, steps TEXT, model TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS stories(entry TEXT, depth INT, hash TEXT, title TEXT, summary TEXT, texts TEXT, model TEXT, updated TEXT, PRIMARY KEY(entry, depth));
CREATE TABLE IF NOT EXISTS expl(id TEXT PRIMARY KEY, phrase TEXT, what TEXT, io TEXT, example TEXT, watch TEXT, hash TEXT, model TEXT, commit_short TEXT, updated TEXT, edited INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS expl_versions(id TEXT, hash TEXT, json TEXT, PRIMARY KEY(id, hash));
CREATE TABLE IF NOT EXISTS walk_versions(id TEXT, hash TEXT, json TEXT, PRIMARY KEY(id, hash));
CREATE TABLE IF NOT EXISTS branch_cache(branch TEXT PRIMARY KEY, commit_json TEXT, files TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS layers(id TEXT PRIMARY KEY, name TEXT, description TEXT, ord INT);
CREATE TABLE IF NOT EXISTS terms(term TEXT PRIMARY KEY, definition TEXT);
CREATE TABLE IF NOT EXISTS orphan_code(id TEXT PRIMARY KEY, kind TEXT, body TEXT);
CREATE TABLE IF NOT EXISTS usage(ts TEXT, model TEXT, input_tokens INT, output_tokens INT, cost REAL, note TEXT);
`;

/** Тело функции без имени, пустых строк и отступов — для сравнения «та же функция, другое имя». */
function bodyOf(code, it) {
  const short = String(it.name).split('.').pop();
  const re = /^[\w$]+$/.test(short) ? new RegExp(`\\b${short.replace(/[$]/g, '\\$&')}\\b`, 'g') : null;
  return String(code).split('\n').slice(it.line - 1, it.end)
    .map((l) => l.trim()).filter((l) => l && !/^(\/\/|#)/.test(l))
    .map((l) => (re ? l.replace(re, '§') : l)).join('\n');
}
/** Насколько похожи два тела функций: доля совпадающих строк (0…1). */
function similarity(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const count = {};
  for (const l of A) count[l] = (count[l] || 0) + 1;
  let same = 0;
  for (const l of B) if (count[l] > 0) { same += 1; count[l] -= 1; }
  return (2 * same) / (A.length + B.length || 1);
}
/** Есть ли в тексте файла функция/метод/класс с таким именем. */
function definedIn(text, name) {
  if (!text) return false;
  const parts = String(name).split('.');
  if (!parts.every((x) => /^[\w$]+$/.test(x))) return false; // маршруты и анонимные обработчики (app.use@19) — не функции с именем
  const esc = (x) => x.replace(/[$]/g, '\\$&');
  const def = (x) => new RegExp(`(?:\\bdef|\\bfunction\\*?|\\bclass)\\s+${esc(x)}\\b|\\b${esc(x)}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function\\b|\\w+\\s*=>)|^\\s*(?:(?:public|private|protected|static|async|get|set)\\s+)*${esc(x)}\\s*\\([^)]*\\)\\s*[:{]`, 'm').test(text);
  return parts.every(def);
}

function rows(db, q, params = []) {
  const st = db.prepare(q);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

// пояснения из прошлых версий: колонка «ветка» и копия в таблицу версий
function migrateExpl(db) {
  if (!rows(db, 'PRAGMA table_info(expl)').some((c) => c.name === 'branch')) db.run("ALTER TABLE expl ADD COLUMN branch TEXT DEFAULT ''");
  for (const r of rows(db, 'SELECT * FROM expl')) db.run('INSERT OR IGNORE INTO expl_versions VALUES (?,?,?)', [r.id, r.hash, JSON.stringify(r)]);
}

export class Session {
  constructor(file, db) { this.file = file; this.db = db; this.id = path.basename(file, '.mimis'); }

  meta(key, fallback = null) {
    const r = rows(this.db, 'SELECT value FROM meta WHERE key=?', [key])[0];
    return r ? JSON.parse(r.value) : fallback;
  }
  setMeta(key, value) { this.db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', [key, JSON.stringify(value)]); }

  /** Записать результат разбора кода. Пояснения, термины и журнал расходов не трогаем. */
  writeAnalysis(fetched, analysis, layers, layersSource) {
    const db = this.db;
    const oldFiles = Object.fromEntries(rows(db, 'SELECT path, purpose, layer FROM files').map((r) => [r.path, r]));
    // код объяснённых функций, которых в новой версии нет, — чтобы узнать их, если их просто переименовали
    {
      const newIds = new Set(analysis.items.map((i) => i.id));
      const explIds = new Set(rows(db, 'SELECT id FROM expl').map((r) => r.id));
      const oldCode = {};
      for (const it of rows(db, 'SELECT id, file, name, kind, line, end_line AS "end" FROM items')) {
        if (!explIds.has(it.id) || newIds.has(it.id)) continue;
        oldCode[it.file] ??= rows(db, 'SELECT code FROM files WHERE path=?', [it.file])[0]?.code || '';
        if (oldCode[it.file]) db.run('INSERT OR REPLACE INTO orphan_code VALUES (?,?,?)', [it.id, it.kind, bodyOf(oldCode[it.file], it)]);
      }
    }
    db.run('BEGIN');
    try {
      db.run('DELETE FROM files'); db.run('DELETE FROM items'); db.run('DELETE FROM edges'); db.run('DELETE FROM sites'); db.run('DELETE FROM entities'); db.run('DELETE FROM flows');
      if (layers) {
        db.run('DELETE FROM layers');
        layers.forEach((l, i) => db.run('INSERT INTO layers VALUES (?,?,?,?)', [l.id, l.name, l.description || '', i]));
      }
      const layerOf = {};
      for (const l of layers || []) for (const f of l.files || []) layerOf[f] = l.id;
      const known = new Set(rows(db, 'SELECT id FROM layers').map((r) => r.id));
      let needNew = false;
      for (const [p, f] of Object.entries(analysis.files)) {
        let layer = layerOf[p] || oldFiles[p]?.layer;
        if (!layer || !known.has(layer)) { layer = 'new'; needNew = true; }
        db.run('INSERT INTO files VALUES (?,?,?,?,?,?,?,?)', [p, f.lang, f.lines, f.doc || '', oldFiles[p]?.purpose || '', layer, f.error, analysis.code[p]]);
      }
      if (needNew && !known.has('new')) db.run('INSERT INTO layers VALUES (?,?,?,?)', ['new', 'Новые файлы', 'Появились после последней раскладки по слоям', 999]);
      analysis.items.forEach((it, i) => db.run('INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [it.id, it.file, it.name, it.kind, it.line, it.end, it.sig, it.route, it.doc, it.hash, i]));
      for (const [a, b, k] of analysis.edges) db.run('INSERT INTO edges VALUES (?,?,?)', [a, b, k || 'call']);
      for (const x of analysis.sites || []) db.run('INSERT INTO sites VALUES (?,?,?,?,?,?)', [x.src, x.tgt, x.line, x.kind, x.ctx || '', x.label || '']);
      for (const e of analysis.entities || []) db.run('INSERT OR REPLACE INTO entities VALUES (?,?)', [e.id, JSON.stringify(e)]);
      for (const [id, f] of Object.entries(analysis.flows || {})) db.run('INSERT OR REPLACE INTO flows VALUES (?,?)', [id, JSON.stringify(f)]);
      db.run("DELETE FROM layers WHERE id NOT IN (SELECT DISTINCT layer FROM files) AND id='new'");
      db.run('COMMIT');
    } catch (e) { db.run('ROLLBACK'); throw e; }
    this.restoreVersions();
    this.setMeta('web', analysis.web || { routes: [] });
    this.setMeta('entries', analysis.entries || []);
    this.setMeta('roles', analysis.roles || {});
    this.setMeta('source', fetched.source);
    this.setMeta('commit', fetched.commit);
    if (layersSource) this.setMeta('layers_source', layersSource);
    this.setMeta('updated', now());
    return this.settleOrphans(analysis.code);
  }

  /**
   * Пояснения функций, которых в коде больше нет:
   *  — функция есть в другой скачанной ветке → пояснение убирается из списка (его версия сохранена и вернётся при переключении);
   *  — у новой функции тот же код, только имя или место другое → пояснение переходит к ней;
   *  — код похож → подсказка «похоже, переименована» (перенести можно одной кнопкой).
   * @returns { moved: [{from, to}], inBranches: число }
   */
  settleOrphans(code) {
    const db = this.db;
    const items = this.items();
    const ids = new Set(items.map((i) => i.id));
    let expl = this.explMap();
    const orphans = Object.keys(expl).filter((id) => !ids.has(id));
    db.run(`DELETE FROM orphan_code WHERE id NOT IN (SELECT id FROM expl)`);
    for (const id of ids) db.run('DELETE FROM orphan_code WHERE id=?', [id]);
    const result = { moved: [], inBranches: 0 };
    const keptBefore = this.meta('orphan_branches', {});
    for (const id of Object.keys(keptBefore)) if (ids.has(id)) delete keptBefore[id]; // функция снова есть в коде
    this.setMeta('orphan_branches', keptBefore);
    if (!orphans.length) { this.setMeta('rename_hints', []); return result; }
    // 1. есть в другой ветке
    const cur = this.meta('source')?.branch || '';
    const kept = { ...this.meta('orphan_branches', {}) };
    const other = rows(db, 'SELECT branch, files FROM branch_cache WHERE branch<>?', [cur]);
    const filesOf = {};
    const left = [];
    for (const id of orphans) {
      const [file, name] = [id.slice(0, id.indexOf('::')), id.slice(id.indexOf('::') + 2)];
      const found = [];
      for (const b of other) {
        filesOf[b.branch] ??= Object.fromEntries(JSON.parse(b.files || '[]').map((f) => [f.path, f.text]));
        if (definedIn(filesOf[b.branch][file], name)) found.push(b.branch);
      }
      if (found.length) {
        // версия пояснения уже лежит в expl_versions — при переключении на ту ветку оно вернётся
        db.run('INSERT OR IGNORE INTO expl_versions VALUES (?,?,?)', [id, expl[id].hash, JSON.stringify(expl[id])]);
        db.run('DELETE FROM expl WHERE id=?', [id]);
        kept[id] = found;
        result.inBranches += 1;
      } else left.push(id);
    }
    for (const id of Object.keys(kept)) if (ids.has(id)) delete kept[id];
    this.setMeta('orphan_branches', kept);
    // 2. переименованные и перенесённые
    expl = this.explMap();
    const bodies = Object.fromEntries(rows(db, 'SELECT id, kind, body FROM orphan_code').map((r) => [r.id, r]));
    const candidates = items.filter((i) => !expl[i.id] && code?.[i.file]).map((i) => ({ it: i, body: bodyOf(code[i.file], i) }));
    const dismissed = new Set(this.meta('rename_dismissed', []));
    const taken = new Set();
    const hints = [];
    for (const id of left) {
      const ob = bodies[id];
      if (!ob) continue;
      let best = null;
      for (const c of candidates) {
        if (taken.has(c.it.id) || c.it.kind !== ob.kind || dismissed.has(`${id}>${c.it.id}`)) continue;
        const score = c.body === ob.body ? 1 : similarity(ob.body, c.body);
        if (!best || score > best.score) best = { to: c.it.id, score };
      }
      if (!best || best.score < 0.6) continue;
      if (best.score === 1) { this.moveExplanation(id, best.to, true); taken.add(best.to); result.moved.push({ from: id, to: best.to }); } else hints.push({ from: id, to: best.to, score: Math.round(best.score * 100) });
    }
    this.setMeta('rename_hints', hints);
    return result;
  }

  /** Перенести пояснение (и разбор по шагам) с удалённой функции на другую. same — код тот же, пояснение актуально. */
  moveExplanation(from, to, same = false) {
    const db = this.db;
    const r = rows(db, 'SELECT * FROM expl WHERE id=?', [from])[0];
    const it = rows(db, 'SELECT hash FROM items WHERE id=?', [to])[0];
    if (!r || !it) throw new Error('Нечего переносить.');
    db.run('DELETE FROM expl WHERE id=?', [to]);
    db.run('UPDATE expl SET id=?, hash=?, updated=? WHERE id=?', [to, same ? it.hash : r.hash, now(), from]);
    const w = rows(db, 'SELECT * FROM walks WHERE id=?', [from])[0];
    if (w) { db.run('DELETE FROM walks WHERE id=?', [to]); db.run('UPDATE walks SET id=?, hash=? WHERE id=?', [to, same ? it.hash : w.hash, from]); }
    db.run('DELETE FROM orphan_code WHERE id=?', [from]);
    this.setMeta('rename_hints', this.meta('rename_hints', []).filter((h) => h.from !== from && h.to !== to));
    this.snapshot(to);
  }
  dismissRename(from, to) {
    this.setMeta('rename_dismissed', [...new Set([...this.meta('rename_dismissed', []), `${from}>${to}`])].slice(-500));
    this.setMeta('rename_hints', this.meta('rename_hints', []).filter((h) => !(h.from === from && h.to === to)));
  }
  /** Удалить пояснения всех функций, которых нет ни в этой версии кода, ни в скачанных ветках. */
  deleteOrphans() {
    const ids = new Set(this.items().map((i) => i.id));
    const gone = Object.keys(this.explMap()).filter((id) => !ids.has(id));
    for (const id of gone) {
      for (const t of ['expl', 'expl_versions', 'walks', 'walk_versions', 'orphan_code']) this.db.run(`DELETE FROM ${t} WHERE id=?`, [id]);
    }
    this.setMeta('rename_hints', []);
    return gone.length;
  }

  items() {
    return rows(this.db, 'SELECT id, file, name, kind, line, end_line AS "end", sig, route, doc, hash FROM items ORDER BY ord');
  }
  explMap() {
    return Object.fromEntries(rows(this.db, 'SELECT * FROM expl').map((r) => [r.id, r]));
  }
  edges() { return rows(this.db, 'SELECT src, dst, kind FROM edges').map((r) => [r.src, r.dst, r.kind || 'call']); }
  /** Места связей по порядку в коде: [откуда, куда, строка, 'call'|'ref', условие]. В разборах до 0.2 их нет. */
  sites() { return rows(this.db, 'SELECT src, dst, line, kind, ctx, label FROM sites ORDER BY src, line').map((r) => [r.src, r.dst, r.line, r.kind, r.ctx, r.label || '']); }
  entities() { return rows(this.db, 'SELECT json FROM entities').map((r) => JSON.parse(r.json)); }
  flow(id) { const r = rows(this.db, 'SELECT json FROM flows WHERE id=?', [id])[0]; return r ? JSON.parse(r.json) : null; }
  walks() {
    // разбор по шагам для нынешней версии кода, если он есть; иначе — последний (с пометкой «код изменился»)
    const cur = Object.fromEntries(rows(this.db, 'SELECT id, hash FROM items').map((r) => [r.id, r.hash]));
    const out = Object.fromEntries(rows(this.db, 'SELECT * FROM walks').map((r) => [r.id, { hash: r.hash, steps: JSON.parse(r.steps || '[]'), model: r.model, updated: r.updated }]));
    for (const v of rows(this.db, 'SELECT id, hash, json FROM walk_versions')) if (cur[v.id] === v.hash) out[v.id] = JSON.parse(v.json);
    return out;
  }
  /** hash — версия кода, для которой писали разбор (пакет мог прийти, когда в разборе уже другая ветка). */
  saveWalk(id, steps, model, hash = null) {
    const it = rows(this.db, 'SELECT hash FROM items WHERE id=?', [id])[0];
    if (hash && it?.hash !== hash) {
      this.db.run('INSERT OR REPLACE INTO walk_versions VALUES (?,?,?)', [id, hash, JSON.stringify({ hash, steps, model, updated: now() })]);
      return;
    }
    this.db.run('INSERT OR REPLACE INTO walks VALUES (?,?,?,?,?)', [id, it?.hash || '', JSON.stringify(steps), model, now()]);
    this.db.run('INSERT OR REPLACE INTO walk_versions VALUES (?,?,?)', [id, it?.hash || '', JSON.stringify({ hash: it?.hash || '', steps, model, updated: now() })]);
  }
  stories() {
    return rows(this.db, 'SELECT * FROM stories').map((r) => ({ ...r, texts: JSON.parse(r.texts || '{}') }));
  }
  saveStory(st) {
    this.db.run('INSERT OR REPLACE INTO stories VALUES (?,?,?,?,?,?,?,?)', [st.entry, st.depth, st.hash, st.title || '', st.summary || '', JSON.stringify(st.texts || {}), st.model || '', now()]);
  }
  code(file) { return rows(this.db, 'SELECT code FROM files WHERE path=?', [file])[0]?.code ?? null; }

  status(item, expl) {
    const e = expl[item.id];
    return !e ? 'none' : e.hash === item.hash ? 'fresh' : 'stale';
  }

  /** Всё для интерфейса, кроме исходного кода (его отдаём по файлу). */
  view() {
    const expl = this.explMap();
    const items = this.items().map((it) => ({ ...it, status: this.status(it, expl), phrase: expl[it.id]?.phrase || it.doc || '' }));
    const counts = { fresh: 0, stale: 0, none: 0 };
    items.forEach((i) => counts[i.status]++);
    const ids = new Set(items.map((i) => i.id));
    return {
      id: this.id,
      title: this.meta('title'),
      source: this.meta('source'),
      commit: this.meta('commit'),
      created: this.meta('created'),
      updated: this.meta('updated'),
      summary: this.meta('summary', ''),
      layersSource: this.meta('layers_source', 'folders'),
      lastUpdate: this.meta('last_update', null),
      batch: (({ map, provider, ...j } = {}) => (j.id ? { ...j, model: provider?.model || '' } : null))(this.meta('batch_job', null) || undefined),
      batchLast: this.meta('batch_last', null),
      files: rows(this.db, 'SELECT path, lang, lines, doc, purpose, layer, error FROM files ORDER BY path'),
      layers: rows(this.db, 'SELECT id, name, description FROM layers ORDER BY ord'),
      items,
      edges: this.edges(),
      sites: this.sites(),
      entities: this.entities(),
      web: this.meta('web', { routes: [] }),
      entries: this.meta('entries', null), // null — разбор старой версии, точки запуска ещё не искали
      roles: this.meta('roles', {}),
      walks: this.walks(),
      stories: this.stories(),
      expl: Object.fromEntries(Object.entries(expl).filter(([k]) => ids.has(k))),
      orphans: Object.keys(expl).filter((k) => !ids.has(k)),
      renameHints: this.meta('rename_hints', []).filter((h) => expl[h.from] && ids.has(h.to) && !expl[h.to]),
      orphanBranches: this.meta('orphan_branches', {}),
      terms: rows(this.db, 'SELECT term, definition FROM terms ORDER BY term'),
      usage: rows(this.db, 'SELECT COALESCE(SUM(input_tokens),0) AS inTok, COALESCE(SUM(output_tokens),0) AS outTok, COALESCE(SUM(cost),0) AS cost FROM usage')[0],
      counts: { ...counts, total: items.length },
    };
  }

  summaryRow() {
    const total = rows(this.db, 'SELECT COUNT(*) AS n FROM items')[0].n;
    const fresh = rows(this.db, 'SELECT COUNT(*) AS n FROM items i JOIN expl e ON e.id=i.id AND e.hash=i.hash')[0].n;
    const files = rows(this.db, 'SELECT COUNT(*) AS n FROM files')[0].n;
    return { id: this.id, title: this.meta('title'), source: this.meta('source'), commit: this.meta('commit'), updated: this.meta('updated'), total, fresh, files };
  }

  saveExplanation(id, entry, { model = '', edited = false } = {}) {
    const it = rows(this.db, 'SELECT hash FROM items WHERE id=?', [id])[0];
    if (!it) throw new Error('Такой функции нет в текущем коде');
    const c = this.meta('commit') || {};
    this.db.run('INSERT OR REPLACE INTO expl VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      id, entry.phrase || '', entry.what || '', entry.io || '', entry.example || '', entry.watch || '',
      it.hash, model, c.short || '', now(), edited ? 1 : 0, this.meta('source')?.branch || '',
    ]);
    this.snapshot(id);
  }
  confirmExplanation(id) {
    const it = rows(this.db, 'SELECT hash FROM items WHERE id=?', [id])[0];
    if (!it) throw new Error('Такой функции нет в текущем коде');
    this.db.run('UPDATE expl SET hash=?, commit_short=?, updated=?, branch=? WHERE id=?', [it.hash, this.meta('commit')?.short || '', now(), this.meta('source')?.branch || '', id]);
    this.snapshot(id);
  }
  /** Пояснение для другой версии кода функции (пришло из пакета, когда в разборе уже другая ветка). */
  saveExplanationVersion(id, hash, entry, { model = '' } = {}) {
    const r = { id, phrase: entry.phrase || '', what: entry.what || '', io: entry.io || '', example: entry.example || '', watch: entry.watch || '', hash, model, commit_short: '', updated: now(), edited: 0, branch: '' };
    this.db.run('INSERT OR REPLACE INTO expl_versions VALUES (?,?,?)', [id, hash, JSON.stringify(r)]);
  }
  deleteExplanation(id) { for (const t of ['expl', 'expl_versions', 'orphan_code']) this.db.run(`DELETE FROM ${t} WHERE id=?`, [id]); }

  // ---- версии пояснений: у каждой версии кода функции (ветки) — своё пояснение ----
  snapshot(id) {
    const r = rows(this.db, 'SELECT * FROM expl WHERE id=?', [id])[0];
    if (r) this.db.run('INSERT OR REPLACE INTO expl_versions VALUES (?,?,?)', [id, r.hash, JSON.stringify(r)]);
  }
  /** После загрузки другой ветки: если для нынешнего кода функции пояснение уже писали — вернуть его. */
  restoreVersions() {
    const items = rows(this.db, 'SELECT i.id, i.hash FROM items i LEFT JOIN expl e ON e.id=i.id WHERE e.id IS NULL OR e.hash<>i.hash');
    for (const it of items) {
      const v = rows(this.db, 'SELECT json FROM expl_versions WHERE id=? AND hash=?', [it.id, it.hash])[0];
      if (v) {
        const r = JSON.parse(v.json);
        this.db.run('INSERT OR REPLACE INTO expl VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [r.id, r.phrase, r.what, r.io, r.example, r.watch, r.hash, r.model, r.commit_short, r.updated, r.edited || 0, r.branch || '']);
      }
    }
  }

  // ---- скачанные ветки: исходники хранятся, чтобы переключаться без интернета ----
  cacheBranch(branch, fetched) {
    this.db.run('INSERT OR REPLACE INTO branch_cache VALUES (?,?,?,?)', [branch, JSON.stringify(fetched.commit), JSON.stringify(fetched.files), now()]);
    const keep = rows(this.db, 'SELECT branch FROM branch_cache ORDER BY updated DESC').slice(8).map((r) => r.branch); // не больше 8 веток
    for (const b of keep) this.db.run('DELETE FROM branch_cache WHERE branch=?', [b]);
  }
  cachedBranch(branch) {
    const r = rows(this.db, 'SELECT * FROM branch_cache WHERE branch=?', [branch])[0];
    return r ? { commit: JSON.parse(r.commit_json), files: JSON.parse(r.files), updated: r.updated } : null;
  }
  cachedBranches() { return rows(this.db, 'SELECT branch, commit_json, updated FROM branch_cache').map((r) => ({ name: r.branch, commit: JSON.parse(r.commit_json), updated: r.updated })); }
  setPurpose(file, purpose) { this.db.run('UPDATE files SET purpose=? WHERE path=?', [purpose, file]); }
  addTerms(terms) {
    for (const t of terms || []) {
      if (t?.term && t?.definition) this.db.run('INSERT OR IGNORE INTO terms VALUES (?,?)', [String(t.term).slice(0, 80), String(t.definition).slice(0, 600)]);
    }
  }
  setLayers(layers) {
    const db = this.db;
    db.run('BEGIN');
    try {
      db.run('DELETE FROM layers');
      layers.forEach((l, i) => db.run('INSERT INTO layers VALUES (?,?,?,?)', [l.id, l.name, l.description || '', i]));
      for (const l of layers) for (const f of l.files) db.run('UPDATE files SET layer=? WHERE path=?', [l.id, f]);
      db.run('COMMIT');
    } catch (e) { db.run('ROLLBACK'); throw e; }
    this.setMeta('layers_source', 'ai');
  }
  logUsage(model, inTok, outTok, cost, note) {
    this.db.run('INSERT INTO usage VALUES (?,?,?,?,?,?)', [now(), model, inTok, outTok, cost, note]);
  }

  save() {
    atomicWrite(this.file, Buffer.from(this.db.export()));
  }
}

export class Sessions {
  constructor(dir) {
    this.dir = path.join(dir, 'sessions');
    fs.mkdirSync(this.dir, { recursive: true });
    // файлы первой версии (*.magistr) — переименовываем
    for (const f of fs.readdirSync(this.dir).filter((n) => n.endsWith('.magistr'))) {
      try { fs.renameSync(path.join(this.dir, f), path.join(this.dir, f.replace(/\.magistr$/, '.mimis'))); } catch { /* */ }
    }
    this.open = new Map();
  }
  fileOf(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Некорректный идентификатор сессии');
    return path.join(this.dir, `${id}.mimis`);
  }
  async create(title) {
    const SQLc = await sql();
    const slug = (title || 'repo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'repo';
    const id = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    const db = new SQLc.Database();
    db.run(SCHEMA);
    migrateExpl(db);
    const s = new Session(this.fileOf(id), db);
    s.setMeta('version', 1);
    s.setMeta('title', title);
    s.setMeta('created', now());
    this.open.set(id, s);
    return s;
  }
  async get(id) {
    if (this.open.has(id)) return this.open.get(id);
    const file = this.fileOf(id);
    if (!fs.existsSync(file)) throw new Error('Сессия не найдена');
    const SQLc = await sql();
    const db = new SQLc.Database(fs.readFileSync(file));
    db.run(SCHEMA);
    // разборы до 0.2: у связей не было вида (вызов / передача)
    if (!rows(db, 'PRAGMA table_info(edges)').some((c) => c.name === 'kind')) db.run("ALTER TABLE edges ADD COLUMN kind TEXT DEFAULT 'call'");
    if (!rows(db, 'PRAGMA table_info(sites)').some((c) => c.name === 'label')) db.run("ALTER TABLE sites ADD COLUMN label TEXT DEFAULT ''");
    migrateExpl(db);
    const s = new Session(file, db);
    this.open.set(id, s);
    return s;
  }
  async list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir).filter((n) => n.endsWith('.mimis'))) {
      try { out.push((await this.get(path.basename(f, '.mimis'))).summaryRow()); } catch { /* битый файл — пропускаем */ }
    }
    return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  remove(id) {
    const s = this.open.get(id);
    if (s) { s.db.close(); this.open.delete(id); }
    fs.rmSync(this.fileOf(id), { force: true });
  }
}
