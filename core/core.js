// Ядро Mímisbrunnr без Electron: настройки, сессии, разбор, пояснения.
// Electron (electron/main.js) только пробрасывает эти методы в окно.
import { Settings, Sessions } from './store.js';
import { fetchTarget, parseTarget, listGithubBranches, githubHead, localGitInfo } from './fetchRepo.js';
import { Worker } from 'node:worker_threads';
import { analyzeSources, layersByFolder } from './analyze.js';

// Разбор кода — в отдельном потоке, чтобы окно не замирало на больших репозиториях.
// Если поток запустить не удалось (необычная сборка), разбираем здесь же.
function analyzeOffThread(sources) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./analyzeWorker.js', import.meta.url), { workerData: { sources } }); } catch (e) { reject(Object.assign(e, { noWorker: true })); return; }
    w.once('message', (m) => { w.terminate(); if (m.ok) resolve(m.r); else reject(new Error(m.error)); });
    w.once('error', (e) => reject(Object.assign(e, { noWorker: true })));
  });
}
import { plan, runExplain, startBatch, checkBatch, stopBatch } from './explain.js';
import { callModel, PRESETS, costOf, batchUnsupported } from './llm.js';
import { storyPlan, runStory } from './story.js';
import { walkPlan, runWalk } from './walk.js';

export class MimisCore {
  constructor(dataDir, { crypt = null, fetchFn = fetch, log = () => {} } = {}) {
    this.log = log;
    this.settings = new Settings(dataDir, crypt);
    this.sessions = new Sessions(dataDir);
    this.fetchFn = fetchFn;
    this.jobs = new Map(); // sessionId → { ctrl, state }
  }

  state() { return { settings: this.settings.public(), presets: PRESETS }; }
  updateSettings(patch) { return this.settings.update(patch); }
  listSessions() { return this.sessions.list(); }

  // s — разбор, у которого есть сохранённые ветки: если эта версия ветки уже скачана, качать заново не нужно,
  // а без интернета можно открыть сохранённую копию
  async _load(target0, onProgress, s = null) {
    let target = typeof target0 === 'string' ? parseTarget(target0) : target0;
    const opts = { fetchFn: this.fetchFn, token: this.settings.githubToken() };
    let fetched = null;
    if (target.type === 'github' && s) {
      let head = null;
      try { head = await githubHead(target, opts); } catch (e) {
        const c = target.branch && s.cachedBranch(target.branch);
        if (!c) throw e;
        onProgress('GitHub сейчас недоступен — открываю сохранённую копию ветки.');
        fetched = { source: { ...s.meta('source'), branch: target.branch }, commit: c.commit, files: c.files, offline: true };
      }
      if (head) {
        const c = s.cachedBranch(head.branch);
        if (c && c.commit.hash === head.sha) {
          onProgress('Эта версия ветки уже скачана — беру сохранённую копию.');
          fetched = { source: { ...s.meta('source'), branch: head.branch }, commit: c.commit, files: c.files };
        } else target = { ...target, branch: head.branch };
      }
    }
    if (!fetched) fetched = await fetchTarget(target, { ...opts, onProgress });
    if (s && fetched.source.type === 'github' && fetched.source.branch && !fetched.offline) s.cacheBranch(fetched.source.branch, fetched);
    if (!fetched.files.length) throw new Error('Не нашёл в репозитории файлов Python или JavaScript/TypeScript.');
    onProgress(`Разбираю ${fetched.files.length} файлов…`);
    const t0 = Date.now();
    let analysis;
    try { analysis = process.env.MIMIS_NO_WORKER === '1' ? await analyzeSources(fetched.files) : await analyzeOffThread(fetched.files); } catch (e) {
      if (!e.noWorker) throw e;
      this.log('analyze: отдельный поток не запустился, разбираю в основном', e);
      analysis = await analyzeSources(fetched.files);
    }
    this.log(`analyze: ${fetched.files.length} файлов за ${Date.now() - t0} мс`);
    return { fetched, analysis };
  }

  async createSession(input, onProgress = () => {}, branch = null) {
    const target = parseTarget(input); // понятная ошибка раньше, чем сеть
    if (branch && target.type === 'github') target.branch = branch;
    const { fetched, analysis } = await this._load(target, onProgress);
    const s = await this.sessions.create(fetched.source.label);
    s.writeAnalysis(fetched, analysis, layersByFolder(Object.keys(analysis.files)), 'folders');
    if (fetched.source.type === 'github' && fetched.source.branch) s.cacheBranch(fetched.source.branch, fetched);
    s.save();
    onProgress('Готово.');
    return s.view();
  }

  async updateSession(id, onProgress = () => {}, branch = undefined) {
    if (this.jobs.has(id)) throw new Error('Сейчас идёт объяснение — дождитесь окончания или остановите его.');
    const s = await this.sessions.get(id);
    const src = s.meta('source');
    const switching = branch !== undefined && branch !== src.branch;
    if (switching && src.type !== 'github') throw new Error('Ветку папки на компьютере переключают в git. После этого нажми «Обновить код».');
    const target = src.type === 'local' ? { type: 'local', path: src.path } : { type: 'github', owner: src.owner, repo: src.repo, branch: (switching ? branch : src.branch) || null };
    const before = Object.fromEntries(s.items().map((i) => [i.id, i.hash]));
    const oldCommit = s.meta('commit');
    const { fetched, analysis } = await this._load(target, onProgress, s);
    const byFolder = s.meta('layers_source', 'folders') === 'folders';
    s.writeAnalysis(fetched, analysis, byFolder ? layersByFolder(Object.keys(analysis.files)) : null, null);
    const after = Object.fromEntries(analysis.items.map((i) => [i.id, i.hash]));
    const diff = {
      at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      from: oldCommit?.short, to: fetched.commit.short,
      fromBranch: src.branch || '', toBranch: fetched.source.branch || '', offline: Boolean(fetched.offline),
      restored: 0,
      changed: Object.keys(after).filter((k) => before[k] && before[k] !== after[k]).length,
      added: Object.keys(after).filter((k) => !before[k]).length,
      removed: Object.keys(before).filter((k) => !after[k]).length,
    };
    // сколько пояснений нашлось для кода этой ветки (написанных раньше — в этой или другой ветке)
    const fresh = s.view().items.filter((i) => i.status === 'fresh').length;
    diff.restored = fresh;
    s.setMeta('last_update', diff);
    s.save();
    return s.view();
  }

  // ---- ветки ----
  /** Ветки репозитория разбора. refresh — спросить GitHub заново. */
  async branches(id, refresh = false) {
    const s = await this.sessions.get(id);
    const src = s.meta('source');
    const cached = Object.fromEntries(s.cachedBranches().map((b) => [b.name, b]));
    if (src.type === 'local') {
      const g = localGitInfo(src.path);
      return { type: 'local', current: g?.current || src.branch || '', list: (g?.branches || []).map((name) => ({ name })), remote: g?.remote || null, git: Boolean(g) };
    }
    let meta = s.meta('branches', null);
    let error = '';
    if (refresh || !meta || Date.now() - (meta.fetched || 0) > 10 * 60_000) {
      try {
        const r = await listGithubBranches(src, { fetchFn: this.fetchFn, token: this.settings.githubToken() });
        meta = { default: r.default, list: r.branches, fetched: Date.now() };
        s.setMeta('branches', meta); s.save();
      } catch (e) { error = e.message; }
    }
    const list = (meta?.list || [{ name: src.branch, sha: '' }]).map((b) => ({ ...b, cached: Boolean(cached[b.name]), cachedCommit: cached[b.name]?.commit || null, stale: Boolean(cached[b.name] && b.sha && cached[b.name].commit.hash !== b.sha) }));
    for (const name of Object.keys(cached)) if (!list.some((b) => b.name === name)) list.push({ name, sha: '', cached: true, cachedCommit: cached[name].commit, gone: Boolean(meta) });
    return { type: 'github', current: src.branch || meta?.default || '', default: meta?.default || '', list, fetched: meta?.fetched || 0, error };
  }
  /** Переключить разбор на другую ветку. Пояснения к одинаковому коду сохраняются. */
  async switchBranch(id, branch, onProgress = () => {}) { return this.updateSession(id, onProgress, branch); }
  /** Ветки до создания разбора — для выбора при загрузке. */
  async peekBranches(input) {
    const t = parseTarget(input);
    if (t.type === 'local') { const g = localGitInfo(t.path); return { type: 'local', current: g?.current || '', list: (g?.branches || []).map((name) => ({ name })), remote: g?.remote || null }; }
    const r = await listGithubBranches(t, { fetchFn: this.fetchFn, token: this.settings.githubToken() });
    return { type: 'github', default: r.default, current: t.branch || r.default, list: r.branches };
  }

  async view(id) { return (await this.sessions.get(id)).view(); }
  async code(id, file) { return (await this.sessions.get(id)).code(file); }
  deleteSession(id) {
    this.jobs.get(id)?.ctrl.abort();
    this.sessions.remove(id);
  }

  async estimate(id, scope) {
    const s = await this.sessions.get(id);
    const p = plan(s.view(), (f) => s.code(f), scope, this.settings.data.provider);
    const job = s.meta('batch_job', null);
    return {
      count: p.count, requests: p.batches.length + (p.overview ? 1 : 0), estIn: p.estIn, estOut: p.estOut, estCost: p.estCost, priced: p.priced, overview: p.overview,
      batch: { why: job ? 'Пакет уже отправлен — дождитесь результатов.' : batchUnsupported(this.settings.data.provider), estCost: p.estBatchCost },
    };
  }

  async startExplain(id, scope, onProgress = () => {}) {
    if (this.jobs.has(id)) throw new Error('Объяснение уже идёт.');
    const s = await this.sessions.get(id);
    const ctrl = new AbortController();
    const job = { ctrl, state: { status: 'running', log: [], done: 0, total: 0, spent: 0 } };
    this.jobs.set(id, job);
    const promise = runExplain({
      session: s, settings: this.settings, provider: this.settings.data.provider, apiKey: this.settings.apiKey(),
      fetchFn: this.fetchFn, signal: ctrl.signal,
      onProgress: (st) => { job.state = st; onProgress(st); },
    }, scope).then((st) => { job.state = st; return st; })
      .finally(() => this.jobs.delete(id));
    return { promise };
  }
  // ---- пакетный режим (вдвое дешевле, ответ в течение часа, максимум 24 ч) ----
  _ctx(s) { return { session: s, settings: this.settings, provider: this.settings.data.provider, apiKey: this.settings.apiKey(), fetchFn: this.fetchFn }; }
  async startBatch(id, scope) {
    if (this.jobs.has(id)) throw new Error('Сейчас идёт объяснение — дождитесь окончания или остановите его.');
    const s = await this.sessions.get(id);
    await startBatch(this._ctx(s), scope);
    return s.view();
  }
  /** Проверить пакет. Если готов — пояснения записываются; вернётся новый вид разбора. */
  async checkBatch(id) {
    if (this.jobs.has(id)) return { state: 'busy' };
    const s = await this.sessions.get(id);
    if (!s.meta('batch_job', null)) return { state: 'none' };
    const ctrl = new AbortController();
    this.jobs.set(id, { ctrl, state: { status: 'running', log: ['Забираю результаты пакета…'], done: 0, total: 0, spent: 0 } });
    try {
      const r = await checkBatch(this._ctx(s));
      if (r.state === 'applied') this.log(`batch: ${r.result.done}/${r.result.total}, $${r.result.spent.toFixed(4)}`);
      return { state: r.state, result: r.result || null, view: s.view() };
    } finally { this.jobs.delete(id); }
  }
  async cancelBatch(id, forget = false) {
    const s = await this.sessions.get(id);
    await stopBatch(this._ctx(s), forget);
    return s.view();
  }

  stopExplain(id) { this.jobs.get(id)?.ctrl.abort(); }
  jobState(id) { return this.jobs.get(id)?.state || null; }

  async saveExplanation(id, itemId, entry) {
    const s = await this.sessions.get(id);
    if (!String(entry.what || '').trim()) throw new Error('Поле «Что делает» не может быть пустым.');
    s.saveExplanation(itemId, entry, { model: 'правка вручную', edited: true });
    s.save();
    return s.view();
  }
  async confirmExplanation(id, itemId) { const s = await this.sessions.get(id); s.confirmExplanation(itemId); s.save(); return s.view(); }
  async deleteExplanation(id, itemId) { const s = await this.sessions.get(id); s.deleteExplanation(itemId); s.save(); return s.view(); }

  // ---- сценарии: рассказ от ИИ ----
  async estimateStory(id, entry, depth) {
    const s = await this.sessions.get(id);
    const p = storyPlan(s.view(), (f) => s.code(f), entry, depth, this.settings.data.provider);
    return { steps: p.steps, estIn: p.estIn, estOut: p.estOut, estCost: p.estCost, priced: p.priced };
  }
  async runStory(id, entry, depth) {
    if (this.jobs.has(id)) throw new Error('Сейчас идёт объяснение — дождитесь окончания или остановите его.');
    const s = await this.sessions.get(id);
    const ctrl = new AbortController();
    this.jobs.set(id, { ctrl, state: { status: 'running', log: ['Рассказ сценария…'], done: 0, total: 1, spent: 0 } });
    try {
      const r = await runStory({ session: s, settings: this.settings, provider: this.settings.data.provider, apiKey: this.settings.apiKey(), fetchFn: this.fetchFn, signal: ctrl.signal }, entry, depth);
      return { result: r, view: s.view() };
    } finally { this.jobs.delete(id); }
  }

  // ---- «что внутри функции»: поток данных из разбора и разбор по шагам от ИИ ----
  async flow(id, itemId) { return (await this.sessions.get(id)).flow(itemId); }
  async estimateWalk(id, itemId) {
    const s = await this.sessions.get(id);
    const p = walkPlan(s.view(), (f) => s.code(f), (x) => s.flow(x), itemId, this.settings.data.provider);
    return { estIn: p.estIn, estOut: p.estOut, estCost: p.estCost, priced: p.priced };
  }
  async runWalk(id, itemId) {
    if (this.jobs.has(id)) throw new Error('Сейчас идёт объяснение — дождитесь окончания или остановите его.');
    const s = await this.sessions.get(id);
    const ctrl = new AbortController();
    this.jobs.set(id, { ctrl, state: { status: 'running', log: ['Разбор по шагам…'], done: 0, total: 1, spent: 0 } });
    try {
      const r = await runWalk({ session: s, settings: this.settings, provider: this.settings.data.provider, apiKey: this.settings.apiKey(), fetchFn: this.fetchFn, signal: ctrl.signal }, itemId);
      return { result: r, view: s.view() };
    } finally { this.jobs.delete(id); }
  }

  async testConnection() {
    const p = this.settings.data.provider;
    const t = Date.now();
    const r = await callModel(p, this.settings.apiKey(), { system: 'Отвечай кратко.', user: 'Ответь одним словом по-русски: готов?', maxTokens: 20 }, { fetchFn: this.fetchFn, timeoutMs: 120_000 });
    return { reply: r.text.trim().slice(0, 100), ms: Date.now() - t, cost: costOf(p, r.inTok, r.outTok) };
  }
}
