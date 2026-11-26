// Разбор функции по шагам от ИИ: что происходит в каждом куске кода, с номерами строк.
// Структуру (переменные, откуда и куда) находит разбор кода; модель пишет только текст.
import { callModel, costOf, batchCostOf, extractJson, LlmError } from './llm.js';
import { SYSTEM_PROMPT } from './explain.js';
import { handbookFor, handbookPrompt } from './handbook.js';

const CHARS_PER_TOKEN = 3;
const MAX_LINES = 400;

function numbered(lines, from) {
  return lines.map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n');
}

function flowBrief(f) {
  if (!f) return '';
  const out = [];
  if (f.params?.length) out.push(`Параметры: ${f.params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}${p.deco ? ` (${p.deco})` : ''}`).join(', ')}.`);
  if (f.inputs?.length) out.push(`Берёт из запроса и окружения: ${f.inputs.map((x) => x.text).join(', ')}.`);
  if (f.vars?.length) out.push(`Переменные: ${f.vars.map((v) => `${v.name} (стр. ${v.line}) ← ${v.from}`).join('; ')}.`);
  if (f.reassign?.length) out.push(`Перезаписываются: ${f.reassign.map((v) => `${v.name} (стр. ${v.line}) ← ${v.from}`).join('; ')}.`);
  if (f.outputs?.length) out.push(`Выход: ${f.outputs.map((o) => `${o.kind} ${o.status ? `${o.status} ` : ''}${o.text} (стр. ${o.line})`).join('; ')}.`);
  if (f.effects?.length) out.push(`Особые места: ${f.effects.map((e) => `${e.text} (стр. ${e.line})`).join('; ')}.`);
  return out.join('\n');
}

export function walkPrompt(view, it, code, flow, callees) {
  const end = Math.min(it.end, it.line + MAX_LINES - 1);
  const own = code.split('\n').slice(it.line - 1, end);
  const body = numbered(own, it.line);
  const lang = view.files?.find((f) => f.path === it.file)?.lang || (it.file.endsWith('.py') ? 'python' : 'js');
  const hb = handbookPrompt(handbookFor(own.join('\n'), { fileCode: code, lang, limit: 6 }));
  return `Проект: ${view.title}. Файл: ${it.file}. Разбери функцию ${it.name} по шагам — так, чтобы ученик понял, что происходит в каждой строке: какие данные откуда приходят, что с ними делается и куда они уходят.

Код (слева — номера строк):
<code>
${body}${end < it.end ? `\n… (ещё ${it.end - end} строк)` : ''}
</code>

Что нашёл разбор кода (это точно, опирайся на это):
${flowBrief(flow) || 'нет данных'}
${callees.length ? `Вызывает функции проекта: ${callees.join(', ')}.` : ''}
${hb}
Раздели код на 3–12 смысловых шагов подряд, без пропусков, от первой строки тела до последней.
Верни JSON:
{ "steps": [ { "from": номер первой строки шага, "to": номер последней строки шага, "title": "2–5 слов", "text": "2–4 предложения: что происходит, какие переменные появляются и откуда берутся, куда уходят данные, что будет при ошибке" } ] }`;
}

export function walkPlan(view, getCode, flowOf, id, provider) {
  const it = view.items.find((i) => i.id === id);
  if (!it) throw new Error('Такой функции нет в текущем коде.');
  const code = getCode(it.file) || '';
  const callees = view.edges.filter((e) => e[0] === id).map((e) => e[1].split('::')[1]).slice(0, 20);
  const user = walkPrompt(view, it, code, flowOf(id), callees);
  const lines = Math.min(MAX_LINES, it.end - it.line + 1);
  const estIn = Math.round(((SYSTEM_PROMPT.length + user.length) / CHARS_PER_TOKEN) * 1.15);
  const estOut = Math.round((Math.min(12, 3 + lines / 8) * 120 + 150) * 1.15);
  return { it, user, estIn, estOut, estCost: costOf(provider, estIn, estOut), priced: Number(provider.priceIn) > 0 || Number(provider.priceOut) > 0 };
}

export async function runWalk(ctx, id) {
  const { session, provider, apiKey, signal } = ctx;
  const view = session.view();
  const p = walkPlan(view, (f) => session.code(f), (x) => session.flow(x), id, provider);
  const budget = Number(ctx.settings.data.budgetUsd) || 0;
  if (p.priced && budget > 0 && p.estCost > budget) throw new Error(`Оценка ~$${p.estCost.toFixed(3)} больше лимита на запуск ($${budget}).`);
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await callModel(provider, apiKey, { system: SYSTEM_PROMPT, user: p.user, maxTokens: 4000 }, { fetchFn: ctx.fetchFn, signal }); break; } catch (e) {
      if (!(e instanceof LlmError) || !e.retryable || attempt >= 2 || signal?.aborted) throw e;
      await new Promise((res) => setTimeout(res, [3000, 8000][attempt]));
    }
  }
  const cost = costOf(provider, r.inTok, r.outTok);
  session.logUsage(provider.model, r.inTok, r.outTok, cost, `по шагам: ${p.it.name}`);
  ctx.settings.addSpend(cost);
  let steps;
  try { steps = parseWalk(p.it, r.text); } catch (e) { session.save(); throw e; }
  session.saveWalk(id, steps, provider.model);
  session.save();
  return { cost, steps: steps.length };
}

/** Шаги из ответа модели; строки — только внутри функции. */
export function parseWalk(it, text) {
  let ans;
  try { ans = extractJson(text); } catch { throw new Error('Модель ответила не в том формате. Попробуйте ещё раз.'); }
  const steps = (ans.steps || []).map((s) => ({
    from: Math.max(it.line, Math.min(it.end, Number(s.from) || it.line)),
    to: Math.max(it.line, Math.min(it.end, Number(s.to) || Number(s.from) || it.line)),
    title: String(s.title || '').slice(0, 80), text: String(s.text || '').slice(0, 1500),
  })).filter((s) => s.text).sort((a, b) => a.from - b.from);
  if (!steps.length) throw new Error('Модель не вернула шагов.');
  return steps;
}

// ---- разбор по шагам для многих функций сразу ----
export const MIN_WALK_LINES = 4; // совсем короткие функции по шагам не разбираем — там нечего делить
const WALK_KINDS = new Set(['function', 'method', 'component', 'hook', 'route']);

/** Какие функции разбирать: scope { kind: 'all'|'file'|'item', file?, id?, force? }. */
export function walkTargets(view, scope) {
  const walks = view.walks || {};
  return view.items.filter((it) => {
    if (scope.kind === 'item') return it.id === scope.id;
    if (scope.kind === 'file' && it.file !== scope.file) return false;
    if (!WALK_KINDS.has(it.kind) || it.end - it.line + 1 < MIN_WALK_LINES) return false;
    return scope.force || walks[it.id]?.hash !== it.hash;
  });
}

/** План: запросы, оценка обычной и пакетной цены. */
export function walkPlanAll(view, getCode, flowOf, scope, provider) {
  const targets = walkTargets(view, scope);
  let estIn = 0, estOut = 0;
  const reqs = targets.map((it) => {
    const p = walkPlan(view, getCode, flowOf, it.id, provider);
    estIn += p.estIn; estOut += p.estOut;
    return { it, user: p.user };
  });
  const skipped = scope.kind === 'item' ? 0 : view.items.filter((it) => (scope.kind !== 'file' || it.file === scope.file) && WALK_KINDS.has(it.kind) && it.end - it.line + 1 < MIN_WALK_LINES).length;
  return {
    reqs, count: targets.length, skipped, estIn, estOut,
    estCost: costOf(provider, estIn, estOut), estBatchCost: batchCostOf(provider, estIn, estOut),
    priced: Number(provider.priceIn) > 0 || Number(provider.priceOut) > 0,
  };
}

/**
 * Разобрать по шагам все функции из scope. ctx — как у runExplain.
 * Три запроса идут одновременно; готовое сохраняется сразу, остановка ничего не теряет.
 */
export async function runWalkAll(ctx, scope) {
  const { session, provider, apiKey, onProgress = () => {}, signal } = ctx;
  const view = session.view();
  const p = walkPlanAll(view, (f) => session.code(f), (x) => session.flow(x), scope, provider);
  const budget = Number(scope.budgetUsd ?? ctx.settings.data.budgetUsd) || 0;
  const st = { done: 0, total: p.count, spent: 0, inTok: 0, outTok: 0, file: '', log: [], status: 'running', errors: 0, what: 'walk' };
  const log = (m) => { if (m) st.log.push(m); if (st.log.length > 200) st.log.shift(); onProgress({ ...st }); };
  const perReq = p.count ? p.estCost / p.count : 0;
  log(`План: разобрать по шагам ${p.count} функций${p.skipped ? ` (совсем короткие — ${p.skipped} — пропускаю)` : ''}.`);
  let next = 0;
  let fatal = null;
  async function worker() {
    while (next < p.reqs.length && !fatal) {
      if (signal?.aborted) { st.status = 'stopped'; return; }
      if (p.priced && budget > 0 && st.spent + perReq > budget) {
        if (st.status === 'running') { st.status = 'budget'; log(`Остановлено по бюджету: потрачено $${st.spent.toFixed(3)} из $${budget}. Готовое сохранено.`); }
        return;
      }
      const { it, user } = p.reqs[next++];
      st.file = it.name;
      onProgress({ ...st });
      let r = null;
      for (let attempt = 0; ; attempt++) {
        try { r = await callModel(provider, apiKey, { system: SYSTEM_PROMPT, user, maxTokens: 4000 }, { fetchFn: ctx.fetchFn, signal }); break; } catch (e) {
          if (e instanceof LlmError && (e.status === 401 || e.status === 403 || e.status === 404)) { fatal = e; return; }
          if (!(e instanceof LlmError) || !e.retryable || attempt >= 2 || signal?.aborted) { st.errors += 1; log(`${it.name}: не получилось (${e.message}).`); break; }
          log(`Повтор через ${[3, 8][attempt]} с: ${e.message}`);
          await new Promise((res) => setTimeout(res, [3000, 8000][attempt]));
        }
      }
      if (!r) continue;
      const cost = costOf(provider, r.inTok, r.outTok);
      st.spent += cost; st.inTok += r.inTok; st.outTok += r.outTok;
      session.logUsage(provider.model, r.inTok, r.outTok, cost, `по шагам: ${it.name}`);
      ctx.settings.addSpend(cost);
      try {
        session.saveWalk(it.id, parseWalk(it, r.text), provider.model, it.hash);
        session.save();
        st.done += 1;
      } catch (e) { st.errors += 1; log(`${it.name}: ${e.message}`); }
      onProgress({ ...st });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  session.save();
  st.file = '';
  if (fatal) { st.status = 'error'; log(`Ошибка: ${fatal.message}`); return st; }
  if (st.status === 'running') st.status = signal?.aborted ? 'stopped' : 'done';
  log(st.status === 'done' ? `Готово: разобрано по шагам ${st.done} из ${st.total}.` : st.status === 'stopped' ? 'Остановлено. Готовое сохранено.' : '');
  return st;
}
