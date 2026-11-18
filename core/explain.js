// Конвейер пояснений: код сам режет репозиторий на функции и пачками по
// файлам отдаёт модели вместе со связями из графа. Модель пишет только
// текст; структуру (функции, строки, связи) она не придумывает.
import { callModel, costOf, extractJson, LlmError } from './llm.js';

const KIND_RU = { function: 'функция', method: 'метод', class: 'класс', component: 'React-компонент', hook: 'React-хук', route: 'маршрут' };
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
  if (overview) {
    estIn += (view.files.length * 160 + 1200) / CHARS_PER_TOKEN;
    estOut += 250 + view.files.length * 25;
  }
  estIn = Math.round(estIn * 1.15);
  estOut = Math.round(estOut * 1.15);
  return {
    batches, overview,
    count: targets.length,
    estIn, estOut,
    estCost: costOf(provider, estIn, estOut),
    priced: Number(provider.priceIn) > 0 || Number(provider.priceOut) > 0,
  };
}

function batchPrompt(view, file, items, code, callers, callees, purpose) {
  const lang = view.files.find((f) => f.path === file)?.lang || '';
  const name = (id) => id.split('::')[1];
  const list = items.map((it) => {
    const inn = (callers[it.id] || []).slice(0, 8).map(name).join(', ') || 'нет в проекте';
    const out = (callees[it.id] || []).slice(0, 8).map(name).join(', ') || 'нет';
    return `- ${it.name} (${KIND_RU[it.kind] || it.kind}, строки ${it.line}–${it.end}). Вызывают: ${inn}. Вызывает: ${out}.`;
  }).join('\n');
  const body = code.length <= WHOLE_FILE_LIMIT
    ? numbered(code)
    : items.map((it) => `… строки ${it.line}–${it.end}:\n${numbered(code, it.line, it.end)}`).join('\n\n');
  return `Проект: ${view.title}. Файл: ${file} (${lang}).
${purpose ? `Назначение файла (из прошлого разбора): ${purpose}\n` : ''}
Код (слева — номера строк):
<code>
${body}
</code>

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
В "terms" — только термины, которые встретились в этом коде и которые новичок может не знать (0–5 штук).`;
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
  const callers = {}, callees = {};
  // функции, которые передаются (onClick={f}, аргументом), помечаем — модель не спутает с прямым вызовом
  for (const [a, b, k] of view.edges) { (callees[a] ||= []).push(k === 'ref' ? `${b} (передаётся)` : b); (callers[b] ||= []).push(k === 'ref' ? `${a} (передаёт)` : a); }
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));

  const st = { done: 0, total: p.count, spent: 0, inTok: 0, outTok: 0, file: '', log: [], status: 'running', errors: 0 };
  const note = (m) => { if (m) st.log.push(m); if (st.log.length > 200) st.log.shift(); };
  const log = (m) => { note(m); onProgress({ ...st }); };
  const estPerBatch = p.batches.length ? p.estCost / p.batches.length : 0;

  async function ask(user, maxTokens, note) {
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
  }

  async function doBatch(file, ids, depth = 0) {
    const items = ids.map((id) => itemById[id]);
    const purpose = view.files.find((f) => f.path === file)?.purpose || '';
    const user = batchPrompt(view, file, items, getCode(file) || '', callers, callees, purpose);
    const maxTokens = Math.min(16000, items.length * 900 + 800);
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
    const matched = matchItems(items, ans);
    for (const [it, a] of matched) session.saveExplanation(it.id, a, { model: provider.model });
    if (ans.file_purpose) session.setPurpose(file, String(ans.file_purpose).slice(0, 600));
    session.addTerms(ans.terms);
    session.save();
    st.done += matched.length;
    if (matched.length < items.length) {
      st.errors += items.length - matched.length;
      log(`${file}: модель не вернула пояснения для ${items.length - matched.length} из ${items.length}.`);
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
