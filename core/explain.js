// Конвейер пояснений: код сам режет репозиторий на функции и пачками по
// файлам отдаёт модели вместе со связями из графа. Модель пишет только
// текст; структуру (функции, строки, связи) она не придумывает.
import { callModel, costOf, extractJson, LlmError, batchCostOf, batchUnsupported, submitBatch, batchStatus, batchResults, cancelBatch } from './llm.js';
import { walkPlanAll, parseWalk } from './walk.js';
import { handbookFor, handbookPrompt } from './handbook.js';

const KIND_RU = { function: 'функция', method: 'метод', class: 'класс', component: 'React-компонент', hook: 'React-хук', route: 'маршрут', entity: 'сущность' };
const ORM_RU = { sequelize: 'Sequelize', mongoose: 'Mongoose', typeorm: 'TypeORM', prisma: 'Prisma', sqlalchemy: 'SQLAlchemy', sqlmodel: 'SQLModel', pydantic: 'Pydantic (схема данных)', dataclass: 'dataclass', django: 'Django', dto: 'DTO с проверками' };
const REL_RU = { belongsTo: 'принадлежит', hasMany: 'имеет много', hasOne: 'имеет одну', belongsToMany: 'многие-ко-многим с' };

/** Сущность в одну-две строки для подсказки модели. */
export function entityBrief(e, nameOf) {
  const f = e.fields.slice(0, 30).map((x) => `${x.name}${x.type ? ` ${x.type}` : ''}${x.pk ? ' ключ' : ''}${x.required ? ' обязательное' : ''}${x.unique ? ' уникальное' : ''}${x.default ? ` по умолчанию ${x.default}` : ''}${x.ref ? ` ссылка на ${x.ref.model || x.ref.table}` : ''}${x.validate?.length ? ` проверки: ${x.validate.join(', ')}` : ''}`).join('; ');
  const r = e.relations.map((x) => `${REL_RU[x.kind] || x.kind} ${nameOf(x.to)}${x.as ? ` (как ${x.as})` : ''}${x.through ? ` через ${nameOf(x.throughId || x.through)}` : ''}`).join('; ');
  return `${ORM_RU[e.orm] || e.orm}${e.table ? `, таблица ${e.table}` : ''}. Поля: ${f || 'нет'}.${r ? ` Связи: ${r}.` : ''}${e.hooks?.length ? ` Хуки и проверки: ${e.hooks.join('; ')}.` : ''}`;
}
const MAX_PER_BATCH = 10;
const WHOLE_FILE_LIMIT = 60_000; // символов: больше — отправляем только нужные функции
const CHARS_PER_TOKEN = 3; // грубая оценка для смеси кода и русского текста
const OUT_TOKENS_PER_ITEM = 480;

export const SYSTEM_PROMPT = `Ты — наставник, который объясняет чужой код ученику. Ученик знает основы программирования, но многое для него ново.
Правила:
- Сначала идея, потом детали. Простыми словами, без жаргона.
- Каждый термин при первом появлении расшифруй простыми словами (например: декоратор, dataclass, хук, промис, middleware, транзакция).
- Аналогии — только привязанные к этому проекту, а не абстрактные.
- Пиши только по коду, который видишь. Если чего-то не видно (например, что делает функция из другого файла) — так и скажи, не выдумывай.
- Пиши по-русски. Имена из кода оставляй как в коде.
- Отвечай только JSON указанного вида, без текста вокруг.`;

function numbered(code, from = 1, to = Infinity) {
  return code.split('\n').slice(from - 1, to === Infinity ? undefined : to)
    .map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n');
}

/**
 * План: какие функции объяснять, пачки, оценка токенов и стоимости.
 * scope: { kind: 'all' | 'file' | 'item', file?, id?, force? }
 */
export function plan(view, getCode, scope, provider) {
  const itemsAll = view.items;
  let targets = itemsAll.filter((i) => scope.force || i.status !== 'fresh');
  if (scope.kind === 'file') targets = itemsAll.filter((i) => i.file === scope.file && (scope.force || i.status !== 'fresh'));
  if (scope.kind === 'item') targets = itemsAll.filter((i) => i.id === scope.id);

  const byFile = {};
  for (const t of targets) (byFile[t.file] ||= []).push(t);
  const batches = [];
  let estIn = 0, estOut = 0;
  for (const [file, list] of Object.entries(byFile)) {
    const code = getCode(file) || '';
    for (let i = 0; i < list.length; i += MAX_PER_BATCH) {
      const ids = list.slice(i, i + MAX_PER_BATCH).map((t) => t.id);
      const codeChars = code.length <= WHOLE_FILE_LIMIT ? code.length
        : list.slice(i, i + MAX_PER_BATCH).reduce((a, t) => a + code.split('\n').slice(t.line - 1, t.end).join('\n').length, 0);
      estIn += (SYSTEM_PROMPT.length + codeChars * 1.1 + ids.length * 200 + 900) / CHARS_PER_TOKEN;
      estOut += ids.length * OUT_TOKENS_PER_ITEM + 200;
      batches.push({ file, ids });
    }
  }
  const overview = scope.kind === 'all' && view.layersSource !== 'ai' && view.files.length > 3;
  // обзор проекта в пакет не идёт (ему нужны назначения файлов из пакета) — он всегда по обычной цене
  const ovIn = overview ? (view.files.length * 160 + 1200) / CHARS_PER_TOKEN * 1.15 : 0;
  const ovOut = overview ? (250 + view.files.length * 25) * 1.15 : 0;
  const bIn = estIn * 1.15, bOut = estOut * 1.15;
  estIn = Math.round(bIn + ovIn);
  estOut = Math.round(bOut + ovOut);
  return {
    batches, overview,
    count: targets.length,
    estIn, estOut,
    estCost: costOf(provider, estIn, estOut),
    estBatchCost: batchCostOf(provider, bIn, bOut) + costOf(provider, ovIn, ovOut),
    priced: Number(provider.priceIn) > 0 || Number(provider.priceOut) > 0,
  };
}

function batchPrompt(view, file, items, code, callers, callees, purpose) {
  const lang = view.files.find((f) => f.path === file)?.lang || '';
  const name = (id) => String(id).split('::').pop();
  const ents = Object.fromEntries((view.entities || []).map((e) => [e.id, e]));
  const list = items.map((it) => {
    const inn = (callers[it.id] || []).slice(0, 8).map(name).join(', ') || 'нет в проекте';
    const out = (callees[it.id] || []).slice(0, 8).map(name).join(', ') || 'нет';
    if (it.kind === 'entity' && ents[it.id]) return `- ${it.name} (сущность, строки ${it.line}–${it.end}). ${entityBrief(ents[it.id], name)} Используют: ${inn}.`;
    return `- ${it.name} (${KIND_RU[it.kind] || it.kind}, строки ${it.line}–${it.end}). Вызывают: ${inn}. Вызывает: ${out}.`;
  }).join('\n');
  const body = code.length <= WHOLE_FILE_LIMIT
    ? numbered(code)
    : items.map((it) => `… строки ${it.line}–${it.end}:\n${numbered(code, it.line, it.end)}`).join('\n\n');
  const lines = code.split('\n');
  const own = items.map((it) => lines.slice(it.line - 1, it.end).join('\n')).join('\n');
  const hb = handbookPrompt(handbookFor(own, { fileCode: code, lang, limit: 8 }));
  return `Проект: ${view.title}. Файл: ${file} (${lang}).
${purpose ? `Назначение файла (из прошлого разбора): ${purpose}\n` : ''}
Код (слева — номера строк):
<code>
${body}
</code>
${hb}${knownTerms(view)}
Объясни эти функции и классы:
${list}

Верни JSON такого вида:
{
  "file_purpose": "1–2 предложения: зачем этот файл нужен проекту",
  "items": [
    {
      "name": "имя ровно как в списке выше",
      "phrase": "одна короткая фраза о назначении",
      "what": "что делает: 2–4 предложения, сначала идея, потом детали",
      "io": "что на входе и что на выходе (для класса — его поля)",
      "example": "маленький пример с конкретными значениями",
      "watch": "на что обратить внимание: подводные камни, неочевидное поведение, возможные ошибки"
    }
  ],
  "terms": [ { "term": "термин", "definition": "объяснение простыми словами" } ]
}
В "terms" — только термины, которые встретились в этом коде и которые новичок может не знать (0–5 штук).
Для сущностей (моделей данных): в "what" — что она хранит и зачем проекту, в "io" — поля простыми словами (что значит каждое, какие ограничения), в "example" — пример одной записи с конкретными значениями, в "watch" — связи с другими сущностями (что значит «многие-ко-многим», какие методы появляются из связи, например setAuthors) и подводные камни.`;
}

/** Термины, которые уже есть в словаре проекта: второй раз в «terms» их не нужно. */
function knownTerms(view) {
  const t = (view.terms || []).map((x) => x.term).slice(0, 60);
  return t.length ? `\nУже есть в словаре проекта (в "terms" их не повторяй): ${t.join(', ')}.\n` : '';
}

function overviewPrompt(view) {
  const count = {};
  for (const it of view.items) count[it.file] = (count[it.file] || 0) + 1;
  const lines = view.files.map((f) => `- ${f.path} (${f.lang}, функций: ${count[f.path] || 0})${f.purpose ? `: ${f.purpose}` : f.doc ? ` — комментарий в начале файла: «${f.doc}»` : ''}`).join('\n');
  return `Проект: ${view.title}. Вот все файлы с кратким назначением:
${lines}

Разложи файлы по смысловым слоям (частям системы): например «интерфейс», «маршруты API», «хранение данных», «бизнес-логика», «настройки». От 3 до 10 слоёв. Каждый файл — ровно в одном слое.
Верни JSON:
{
  "summary": "3–5 предложений: что это за проект и как он устроен, простыми словами",
  "layers": [ { "name": "короткое название", "description": "1–2 предложения: за что отвечает слой", "files": ["путь", "..."] } ],
  "file_purposes": { "путь": "1 предложение: зачем нужен файл" }
}
В "file_purposes" — только файлы без описания в списке выше (у которых нет текста после двоеточия).`;
}

function matchItems(items, answer) {
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  const byShort = {};
  for (const i of items) { const s = i.name.split('.').pop(); byShort[s] = byShort[s] === undefined ? i : null; }
  const out = [];
  for (const a of answer?.items || []) {
    const n = String(a?.name || '').replace(/[`'"]/g, '').trim();
    const it = byName[n] || byShort[n.split('.').pop()] || null;
    if (it && a.what) out.push([it, a]);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// функции, которые передаются (onClick={f}, аргументом), помечаем — модель не спутает с прямым вызовом
const NOTE = { ref: ['передаётся', 'передаёт'], dispatch: ['одна из, по значению', 'одна из, по значению'], guess: ['предположительно', 'предположительно'] };
function linksOf(view) {
  const callers = {}, callees = {};
  for (const [a, b, k] of view.edges) { (callees[a] ||= []).push(NOTE[k] ? `${b} (${NOTE[k][0]})` : b); (callers[b] ||= []).push(NOTE[k] ? `${a} (${NOTE[k][1]})` : a); }
  return { callers, callees };
}
const maxTokensFor = (n) => Math.min(16000, n * 900 + 800);

/** Записать ответ модели по пачке. hashes — версии кода на момент отправки (для пакета, который шёл долго). */
function applyAnswer(session, file, items, ans, model, hashes = null) {
  const now = Object.fromEntries(session.items().map((i) => [i.id, i.hash]));
  const matched = matchItems(items, ans);
  for (const [it, a] of matched) {
    const h = hashes?.[it.id];
    if (!h || now[it.id] === h) session.saveExplanation(it.id, a, { model });
    else session.saveExplanationVersion(it.id, h, a, { model }); // код с тех пор сменился (другая ветка) — пояснение ждёт свою версию
  }
  if (ans.file_purpose) session.setPurpose(file, String(ans.file_purpose).slice(0, 600));
  session.addTerms(ans.terms);
  return matched.length;
}

async function runOverview(session, ask) {
  const fresh = session.view();
  const r = await ask(overviewPrompt(fresh), 6000, 'обзор проекта');
  const ans = extractJson(r.text);
  const known = new Set(fresh.files.map((f) => f.path));
  const used = new Set();
  const layers = (ans.layers || []).slice(0, 12).map((l, i) => {
    const files = (l.files || []).filter((f) => known.has(f) && !used.has(f));
    files.forEach((f) => used.add(f));
    return { id: `A${i + 1}`, name: String(l.name || `Слой ${i + 1}`).slice(0, 60), description: String(l.description || '').slice(0, 400), files };
  }).filter((l) => l.files.length);
  const rest = [...known].filter((f) => !used.has(f));
  if (rest.length) layers.push({ id: 'A99', name: 'Прочее', description: 'Файлы, которые модель не отнесла ни к одному слою', files: rest });
  if (layers.length) session.setLayers(layers);
  if (ans.summary) session.setMeta('summary', String(ans.summary).slice(0, 2000));
  for (const [f, text] of Object.entries(ans.file_purposes || {})) {
    if (known.has(f) && !fresh.files.find((x) => x.path === f)?.purpose) session.setPurpose(f, String(text).slice(0, 600));
  }
  session.save();
}

function asker(ctx, st, log) {
  const { session, provider, apiKey, signal } = ctx;
  return async function ask(user, maxTokens, note) {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw new LlmError('Остановлено.');
      try {
        const r = await callModel(provider, apiKey, { system: SYSTEM_PROMPT, user, maxTokens }, { fetchFn: ctx.fetchFn, signal });
        const cost = costOf(provider, r.inTok, r.outTok);
        st.spent += cost; st.inTok += r.inTok; st.outTok += r.outTok;
        session.logUsage(provider.model, r.inTok, r.outTok, cost, note);
        ctx.settings.addSpend(cost);
        return r;
      } catch (e) {
        if (!(e instanceof LlmError) || !e.retryable || attempt >= 3 || signal?.aborted) throw e;
        attempt += 1;
        log(`Повтор через ${[3, 8, 20][attempt - 1]} с: ${e.message}`);
        await sleep([3000, 8000, 20000][attempt - 1]);
      }
    }
  };
}

/**
 * Запуск. ctx: { session, settings, provider, apiKey, fetchFn, signal, onProgress }
 * Сохраняет результат после каждой пачки: остановка ничего не теряет.
 */
export async function runExplain(ctx, scope) {
  const { session, provider, apiKey, onProgress = () => {}, signal } = ctx;
  const view = session.view();
  const getCode = (f) => session.code(f);
  const p = plan(view, getCode, scope, provider);
  const budget = Number(scope.budgetUsd ?? ctx.settings.data.budgetUsd) || 0;
  const { callers, callees } = linksOf(view);
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));

  const st = { done: 0, total: p.count, spent: 0, inTok: 0, outTok: 0, file: '', log: [], status: 'running', errors: 0 };
  const note = (m) => { if (m) st.log.push(m); if (st.log.length > 200) st.log.shift(); };
  const log = (m) => { note(m); onProgress({ ...st }); };
  const estPerBatch = p.batches.length ? p.estCost / p.batches.length : 0;
  const ask = asker(ctx, st, log);

  async function doBatch(file, ids, depth = 0) {
    const items = ids.map((id) => itemById[id]);
    const purpose = view.files.find((f) => f.path === file)?.purpose || '';
    const user = batchPrompt(view, file, items, getCode(file) || '', callers, callees, purpose);
    const maxTokens = maxTokensFor(items.length);
    let r = await ask(user, maxTokens, `${file}: ${items.length}`);
    let ans;
    try { ans = extractJson(r.text); } catch {
      if (r.truncated && items.length > 1 && depth < 2) {
        log('Ответ обрезан — делю пачку пополам.');
        const h = Math.ceil(ids.length / 2);
        await doBatch(file, ids.slice(0, h), depth + 1);
        await doBatch(file, ids.slice(h), depth + 1);
        return;
      }
      r = await ask(`${user}\n\nВажно: ответ должен быть только JSON, без какого-либо текста вокруг.`, maxTokens, `${file}: повтор`);
      ans = extractJson(r.text);
    }
    const matched = applyAnswer(session, file, items, ans, provider.model);
    session.save();
    st.done += matched;
    if (matched < items.length) {
      st.errors += items.length - matched;
      log(`${file}: модель не вернула пояснения для ${items.length - matched} из ${items.length}.`);
    }
  }

  log(`План: ${p.count} функций, ${p.batches.length} запросов${p.overview ? ' + обзор проекта' : ''}.`);
  try {
    for (const b of p.batches) {
      if (signal?.aborted) { st.status = 'stopped'; break; }
      if (p.priced && budget > 0 && st.spent + estPerBatch > budget) {
        st.status = 'budget';
        note(`Остановлено по бюджету: потрачено $${st.spent.toFixed(3)} из $${budget}. Можно продолжить позже — готовое сохранено.`);
        break;
      }
      st.file = b.file;
      onProgress({ ...st });
      try {
        await doBatch(b.file, b.ids);
      } catch (e) {
        if (e instanceof LlmError && (e.status === 401 || e.status === 403 || e.status === 404 || !e.retryable)) throw e;
        st.errors += b.ids.length;
        log(`${b.file}: не получилось (${e.message}). Иду дальше.`);
      }
    }
    if (st.status === 'running' && p.overview && !signal?.aborted) {
      st.file = 'обзор проекта';
      log('Раскладываю файлы по слоям и пишу обзор проекта…');
      await runOverview(session, ask);
    }
    if (st.status === 'running') st.status = signal?.aborted ? 'stopped' : 'done';
  } catch (e) {
    st.status = e.message === 'Остановлено.' ? 'stopped' : 'error';
    if (st.status === 'error') note(`Ошибка: ${e.message}`);
  }
  session.save();
  st.file = '';
  log(st.status === 'done' ? `Готово: объяснено ${st.done} из ${st.total}.` : st.status === 'stopped' ? 'Остановлено. Готовое сохранено.' : '');
  return st;
}

// ---- Пакетный режим: все пачки уходят одним пакетом, ответ — в течение часа
// (максимум 24 ч), цена вдвое ниже. Пакет записан в разборе, поэтому приложение
// можно закрыть: результаты заберутся при следующем открытии.

const pub = (job) => job && { id: job.id, created: job.created, count: job.count, requests: job.requests, estCost: job.estCost, model: job.provider.model, overview: job.overview, canceling: Boolean(job.canceling), last: job.last || null, scope: job.scope, what: job.what || 'expl' };
export const batchInfo = (session) => pub(session.meta('batch_job', null));

/** Отправить пакет. ctx: { session, settings, provider, apiKey, fetchFn } */
export async function startBatch(ctx, scope) {
  const { session, provider, apiKey } = ctx;
  if (session.meta('batch_job', null)) throw new Error('Пакет уже отправлен — дождитесь результатов или отмените его.');
  const why = batchUnsupported(provider);
  if (why) throw new Error(why);
  const view = session.view();
  const getCode = (f) => session.code(f);
  if (scope.what === 'walk') return startWalkBatch(ctx, scope, view, getCode);
  const p = plan(view, getCode, scope, provider);
  if (!p.batches.length) throw new Error('Здесь всё уже объяснено — пакет не нужен.');
  const budget = Number(scope.budgetUsd ?? ctx.settings.data.budgetUsd) || 0;
  if (p.priced && budget > 0 && p.estBatchCost > budget) throw new Error(`Оценка ~$${p.estBatchCost.toFixed(3)} больше лимита на запуск ($${budget}). Поднимите лимит или объясните часть — файл или функцию.`);
  const { callers, callees } = linksOf(view);
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));
  const map = {};
  const reqs = p.batches.map((b, k) => {
    const items = b.ids.map((id) => itemById[id]);
    const purpose = view.files.find((f) => f.path === b.file)?.purpose || '';
    map[`b${k}`] = { file: b.file, ids: b.ids, hashes: Object.fromEntries(items.map((i) => [i.id, i.hash])) };
    return { id: `b${k}`, system: SYSTEM_PROMPT, user: batchPrompt(view, b.file, items, getCode(b.file) || '', callers, callees, purpose), maxTokens: maxTokensFor(items.length) };
  });
  const { batchId } = await submitBatch(provider, apiKey, reqs, { fetchFn: ctx.fetchFn });
  const job = {
    id: batchId, created: new Date().toISOString(), count: p.count, requests: reqs.length, estCost: p.estBatchCost,
    provider: { type: provider.type, baseUrl: provider.baseUrl || '', model: provider.model, priceIn: provider.priceIn, priceOut: provider.priceOut },
    overview: p.overview, map, scope: { kind: scope.kind, file: scope.file, id: scope.id },
  };
  session.setMeta('batch_job', job);
  session.save();
  return pub(job);
}

async function startWalkBatch(ctx, scope, view, getCode) {
  const { session, provider, apiKey } = ctx;
  const p = walkPlanAll(view, getCode, (x) => session.flow(x), scope, provider);
  if (!p.count) throw new Error('Здесь всё уже разобрано по шагам — пакет не нужен.');
  const budget = Number(scope.budgetUsd ?? ctx.settings.data.budgetUsd) || 0;
  if (p.priced && budget > 0 && p.estBatchCost > budget) throw new Error(`Оценка ~$${p.estBatchCost.toFixed(3)} больше лимита на запуск ($${budget}). Поднимите лимит или разберите один файл.`);
  const map = {};
  const reqs = p.reqs.map(({ it, user }, k) => {
    map[`w${k}`] = { walk: it.id, name: it.name, file: it.file, line: it.line, end: it.end, hash: it.hash };
    return { id: `w${k}`, system: SYSTEM_PROMPT, user, maxTokens: 4000 };
  });
  const { batchId } = await submitBatch(provider, apiKey, reqs, { fetchFn: ctx.fetchFn });
  const job = {
    id: batchId, created: new Date().toISOString(), count: p.count, requests: reqs.length, estCost: p.estBatchCost, what: 'walk',
    provider: { type: provider.type, baseUrl: provider.baseUrl || '', model: provider.model, priceIn: provider.priceIn, priceOut: provider.priceOut },
    overview: false, map, scope: { kind: scope.kind, file: scope.file, id: scope.id, what: 'walk' },
  };
  session.setMeta('batch_job', job);
  session.save();
  return pub(job);
}

/**
 * Проверить пакет; если готов — записать пояснения и убрать пакет.
 * @returns { state: 'none'|'waiting'|'applied'|'lost', info, result? }
 */
export async function checkBatch(ctx) {
  const { session, apiKey } = ctx;
  const job = session.meta('batch_job', null);
  if (!job) return { state: 'none', info: null };
  const provider = job.provider;
  let s;
  try { s = await batchStatus(provider, apiKey, job.id, { fetchFn: ctx.fetchFn }); } catch (e) {
    job.last = { checked: new Date().toISOString(), error: e.message };
    session.setMeta('batch_job', job); session.save();
    return { state: e.status === 404 ? 'lost' : 'waiting', info: pub(job) };
  }
  job.last = { checked: new Date().toISOString(), done: s.done, total: s.total, failed: s.failed, canceling: s.canceling, error: s.error };
  if (!s.ended) { session.setMeta('batch_job', job); session.save(); return { state: 'waiting', info: pub(job) }; }

  const results = await batchResults(provider, apiKey, s.ref, { fetchFn: ctx.fetchFn });
  const view = session.view();
  const items = Object.fromEntries(view.items.map((i) => [i.id, i]));
  const st = { done: 0, total: job.count, spent: 0, inTok: 0, outTok: 0, errors: 0, log: [], status: 'done', file: '' };
  const seen = new Set();
  for (const r of results) {
    const b = job.map[r.id];
    if (!b || seen.has(r.id)) continue;
    seen.add(r.id);
    if (!r.ok) { st.errors += b.walk ? 1 : b.ids.length; st.log.push(`${b.walk ? b.name : b.file}: модель не ответила (${r.error}).`); continue; }
    const cost = batchCostOf(provider, r.inTok, r.outTok);
    st.spent += cost; st.inTok += r.inTok; st.outTok += r.outTok;
    session.logUsage(provider.model, r.inTok, r.outTok, cost, b.walk ? `пакет · по шагам: ${b.name}` : `пакет · ${b.file}: ${b.ids.length}`);
    ctx.settings.addSpend(cost);
    if (b.walk) {
      try { session.saveWalk(b.walk, parseWalk(b, r.text), provider.model, b.hash); st.done += 1; } catch (e) { st.errors += 1; st.log.push(`${b.name}: ${e.message}`); }
      continue;
    }
    let ans;
    try { ans = extractJson(r.text); } catch { st.errors += b.ids.length; st.log.push(`${b.file}: ${r.truncated ? 'ответ обрезан' : 'ответ не в том формате'} — объясните этот файл ещё раз обычным способом.`); continue; }
    // функция могла исчезнуть из кода, пока пакет шёл: берём её имя из ответа по сохранённому id
    const list = b.ids.map((id) => items[id] || { id, name: id.split('::').pop(), file: b.file });
    const n = applyAnswer(session, b.file, list, ans, provider.model, b.hashes);
    st.done += n;
    if (n < b.ids.length) st.errors += b.ids.length - n;
  }
  for (const [k, b] of Object.entries(job.map)) if (!seen.has(k)) st.errors += b.walk ? 1 : b.ids.length; // отменённые и просроченные
  session.save();
  if (job.overview && st.done > 0 && !s.canceling && !job.canceling) {
    try {
      const cur = { ...ctx, provider: ctx.provider?.model ? ctx.provider : provider };
      await runOverview(session, asker(cur, st, (m) => st.log.push(m)));
    } catch (e) { st.log.push(`Обзор проекта не получился: ${e.message}`); }
  }
  if (job.canceling) st.status = 'stopped';
  st.what = job.what || 'expl';
  st.log.push(`Пакет: ${st.what === 'walk' ? 'разобрано по шагам' : 'объяснено'} ${st.done} из ${st.total}${st.errors ? `, не получилось ${st.errors}` : ''}.`);
  session.setMeta('batch_job', null);
  session.setMeta('batch_last', { at: new Date().toISOString(), done: st.done, total: st.total, errors: st.errors, spent: st.spent, what: st.what, log: st.log.slice(-20) });
  session.save();
  return { state: 'applied', info: null, result: st };
}

/** Отменить пакет. Готовое к этому моменту придёт при следующей проверке. */
export async function stopBatch(ctx, forget = false) {
  const { session, apiKey } = ctx;
  const job = session.meta('batch_job', null);
  if (!job) return null;
  if (forget) { session.setMeta('batch_job', null); session.save(); return null; }
  await cancelBatch(job.provider, apiKey, job.id, { fetchFn: ctx.fetchFn });
  job.canceling = true;
  session.setMeta('batch_job', job); session.save();
  return pub(job);
}
