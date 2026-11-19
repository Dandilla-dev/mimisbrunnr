// Разбор функции по шагам от ИИ: что происходит в каждом куске кода, с номерами строк.
// Структуру (переменные, откуда и куда) находит разбор кода; модель пишет только текст.
import { callModel, costOf, extractJson, LlmError } from './llm.js';
import { SYSTEM_PROMPT } from './explain.js';

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
  const body = numbered(code.split('\n').slice(it.line - 1, end), it.line);
  return `Проект: ${view.title}. Файл: ${it.file}. Разбери функцию ${it.name} по шагам — так, чтобы ученик понял, что происходит в каждой строке: какие данные откуда приходят, что с ними делается и куда они уходят.

Код (слева — номера строк):
<code>
${body}${end < it.end ? `\n… (ещё ${it.end - end} строк)` : ''}
</code>

Что нашёл разбор кода (это точно, опирайся на это):
${flowBrief(flow) || 'нет данных'}
${callees.length ? `Вызывает функции проекта: ${callees.join(', ')}.` : ''}

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
  let ans;
  try { ans = extractJson(r.text); } catch { session.save(); throw new Error('Модель ответила не в том формате. Попробуйте ещё раз.'); }
  const steps = (ans.steps || []).map((s) => ({
    from: Math.max(p.it.line, Math.min(p.it.end, Number(s.from) || p.it.line)),
    to: Math.max(p.it.line, Math.min(p.it.end, Number(s.to) || Number(s.from) || p.it.line)),
    title: String(s.title || '').slice(0, 80), text: String(s.text || '').slice(0, 1500),
  })).filter((s) => s.text).sort((a, b) => a.from - b.from);
  if (!steps.length) { session.save(); throw new Error('Модель не вернула шагов.'); }
  session.saveWalk(id, steps, provider.model);
  session.save();
  return { cost, steps: steps.length };
}
