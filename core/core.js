// Ядро Mímisbrunnr без Electron: настройки, сессии, разбор, пояснения.
// Electron (electron/main.js) только пробрасывает эти методы в окно.
import { Settings, Sessions } from './store.js';
import { fetchTarget, parseTarget } from './fetchRepo.js';
import { analyzeSources, layersByFolder } from './analyze.js';
import { plan, runExplain } from './explain.js';
import { callModel, PRESETS, costOf } from './llm.js';
import { storyPlan, runStory } from './story.js';

export class MimisCore {
  constructor(dataDir, { crypt = null, fetchFn = fetch } = {}) {
    this.settings = new Settings(dataDir, crypt);
    this.sessions = new Sessions(dataDir);
    this.fetchFn = fetchFn;
    this.jobs = new Map(); // sessionId → { ctrl, state }
  }

  state() { return { settings: this.settings.public(), presets: PRESETS }; }
  updateSettings(patch) { return this.settings.update(patch); }
  listSessions() { return this.sessions.list(); }

  async _load(target, onProgress) {
    const fetched = await fetchTarget(target, { fetchFn: this.fetchFn, token: this.settings.githubToken(), onProgress });
    if (!fetched.files.length) throw new Error('Не нашёл в репозитории файлов Python или JavaScript/TypeScript.');
    onProgress(`Разбираю ${fetched.files.length} файлов…`);
    const analysis = await analyzeSources(fetched.files);
    return { fetched, analysis };
  }

  async createSession(input, onProgress = () => {}) {
    parseTarget(input); // понятная ошибка раньше, чем сеть
    const { fetched, analysis } = await this._load(input, onProgress);
    const s = await this.sessions.create(fetched.source.label);
    s.writeAnalysis(fetched, analysis, layersByFolder(Object.keys(analysis.files)), 'folders');
    s.save();
    onProgress('Готово.');
    return s.view();
  }

  async updateSession(id, onProgress = () => {}) {
    if (this.jobs.has(id)) throw new Error('Сейчас идёт объяснение — дождитесь окончания или остановите его.');
    const s = await this.sessions.get(id);
    const src = s.meta('source');
    const target = src.type === 'local' ? { type: 'local', path: src.path } : { type: 'github', owner: src.owner, repo: src.repo, branch: src.branch || null };
    const before = Object.fromEntries(s.items().map((i) => [i.id, i.hash]));
    const oldCommit = s.meta('commit');
    const { fetched, analysis } = await this._load(target, onProgress);
    const byFolder = s.meta('layers_source', 'folders') === 'folders';
    s.writeAnalysis(fetched, analysis, byFolder ? layersByFolder(Object.keys(analysis.files)) : null, null);
    const after = Object.fromEntries(analysis.items.map((i) => [i.id, i.hash]));
    const diff = {
      at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      from: oldCommit?.short, to: fetched.commit.short,
      changed: Object.keys(after).filter((k) => before[k] && before[k] !== after[k]).length,
      added: Object.keys(after).filter((k) => !before[k]).length,
      removed: Object.keys(before).filter((k) => !after[k]).length,
    };
    s.setMeta('last_update', diff);
    s.save();
    return s.view();
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
    return { count: p.count, requests: p.batches.length + (p.overview ? 1 : 0), estIn: p.estIn, estOut: p.estOut, estCost: p.estCost, priced: p.priced, overview: p.overview };
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

  async testConnection() {
    const p = this.settings.data.provider;
    const t = Date.now();
    const r = await callModel(p, this.settings.apiKey(), { system: 'Отвечай кратко.', user: 'Ответь одним словом по-русски: готов?', maxTokens: 20 }, { fetchFn: this.fetchFn, timeoutMs: 120_000 });
    return { reply: r.text.trim().slice(0, 100), ms: Date.now() - t, cost: costOf(p, r.inTok, r.outTok) };
  }
}
