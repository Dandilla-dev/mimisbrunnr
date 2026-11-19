// Рассказ сценария от ИИ: модель получает готовую цепочку шагов (её строит код,
// не модель) и код этих функций и пишет связный текст — по фразе на шаг.
import { callModel, costOf, extractJson, LlmError } from './llm.js';
import { buildScenario, ROLE_RU } from './scenario.js';
import { SYSTEM_PROMPT } from './explain.js';

const CHARS_PER_TOKEN = 3;
const MAX_FN_LINES = 150;
const MAX_CODE_CHARS = 60_000;
const OUT_PER_STEP = 110;

function numbered(lines, from) {
  return lines.map((l, i) => `${String(from + i).padStart(4)}| ${l}`).join('\n');
}

export function storyPrompt(view, getCode, sc) {
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));
  const entry = itemById[sc.entry];
  const stepLines = sc.steps.map((s) => {
    const pad = '  '.repeat(s.depth);
    const role = s.role ? `[${ROLE_RU[s.role] || s.role}] ` : '';
    if (!s.id) return `${pad}${s.n}. ${role}${s.ctx ? `(только ${s.ctx}) ` : ''}${s.label}${s.about ? ` — ${s.about.replace(/\n/g, '; ')}` : ''}`;
    const it = itemById[s.id];
    const how = s.depth === 0 || !s.line ? '' : `${s.kind === 'ref' ? 'передаётся (вызовется позже)' : 'вызывается'} в строке ${s.line}${s.ctx ? `, внутри «${s.ctx}»` : ''}; `;
    const note = s.repeat ? ' (уже было выше)' : s.cut ? ' (дальше не раскрыто)' : '';
    return `${pad}${s.n}. ${role}${how}${s.label ? `${s.label} → ` : ''}${it.name} — ${it.file}:${it.line}${note}${s.about ? ` (${s.about})` : ''}`;
  }).join('\n');
  let budget = MAX_CODE_CHARS;
  const blocks = [];
  const done = new Set();
  for (const s of sc.steps) {
    if (!s.id || done.has(s.id) || budget <= 0) continue;
    done.add(s.id);
    const it = itemById[s.id];
    const code = (getCode(it.file) || '').split('\n');
    const end = Math.min(it.end, it.line + MAX_FN_LINES - 1);
    let text = numbered(code.slice(it.line - 1, end), it.line);
    if (end < it.end) text += `\n… (ещё ${it.end - end} строк)`;
    if (text.length > budget) text = `${text.slice(0, budget)}\n…`;
    budget -= text.length;
    blocks.push(`<code name="${it.name}" file="${it.file}">\n${text}\n</code>`);
  }
  const start = sc.route ? `запроса ${sc.route.method} ${sc.route.path} (обработчик ${entry.name}, ${entry.file}:${entry.line})` : `${entry.name} (${entry.file}:${entry.line}${entry.route ? `, ${entry.route}` : ''})`;
  const gap = sc.route?.incomplete || sc.route?.guess
    ? `\nВажно: путь неполный. ${sc.route.reason} Обязательно скажи об этом ученику и не утверждай, что перед обработчиком нет других проверок.`
    : '';
  return `Проект: ${view.title}. Разбираем сценарий — путь выполнения ${start}.${sc.route ? ' Это веб-приложение: расскажи, как запрос проходит по шагам — промежуточные обработчики, проверки, обработчик, работа с базой, ответ клиенту и что будет при ошибке.' : ''}${gap}

Шаги сценария. Их нашёл разбор кода, а не ты: порядок — как в коде, отступ — вложенность вызовов.
${stepLines}

Код функций из сценария (слева — номера строк):
${blocks.join('\n\n')}

Расскажи этот сценарий ученику: что происходит, в каком порядке и зачем.
Верни JSON:
{
  "title": "короткое название сценария: что в нём происходит (например «Оформление заказа»)",
  "summary": "3–6 предложений: весь путь целиком, простыми словами",
  "steps": [ { "n": 1, "text": "1–3 предложения: что происходит на этом шаге и зачем; если шаг под условием — когда он случается" } ]
}
В "steps" — по одному элементу на каждый номер из списка выше. Для повторов и нераскрытых шагов достаточно одной фразы.`;
}

export function storyPlan(view, getCode, entry, depth, provider) {
  const sc = buildScenario(view, entry, { depth });
  const user = storyPrompt(view, getCode, sc);
  const estIn = Math.round(((SYSTEM_PROMPT.length + user.length) / CHARS_PER_TOKEN) * 1.15);
  const estOut = Math.round((sc.steps.length * OUT_PER_STEP + 400) * 1.15);
  return {
    sc, user, estIn, estOut,
    estCost: costOf(provider, estIn, estOut),
    priced: Number(provider.priceIn) > 0 || Number(provider.priceOut) > 0,
    steps: sc.steps.length,
  };
}

export async function runStory(ctx, entry, depth) {
  const { session, provider, apiKey, signal } = ctx;
  const view = session.view();
  if (!view.items.some((i) => i.id === entry)) throw new Error('Такой функции нет в текущем коде.');
  const p = storyPlan(view, (f) => session.code(f), entry, depth, provider);
  const budget = Number(ctx.settings.data.budgetUsd) || 0;
  if (p.priced && budget > 0 && p.estCost > budget) {
    throw new Error(`Оценка ~$${p.estCost.toFixed(3)} больше лимита на запуск ($${budget}). Уменьшите глубину или поднимите лимит в настройках.`);
  }
  const maxTokens = Math.min(16000, p.steps * 220 + 1200);
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await callModel(provider, apiKey, { system: SYSTEM_PROMPT, user: p.user, maxTokens }, { fetchFn: ctx.fetchFn, signal }); break; } catch (e) {
      if (!(e instanceof LlmError) || !e.retryable || attempt >= 2 || signal?.aborted) throw e;
      await new Promise((res) => setTimeout(res, [3000, 8000][attempt]));
    }
  }
  const cost = costOf(provider, r.inTok, r.outTok);
  session.logUsage(provider.model, r.inTok, r.outTok, cost, `сценарий: ${entry.split('::')[1]}`);
  ctx.settings.addSpend(cost);
  let ans;
  try { ans = extractJson(r.text); } catch {
    session.save();
    throw new Error(r.truncated ? 'Ответ модели обрезан — уменьшите глубину сценария.' : 'Модель ответила не в том формате. Попробуйте ещё раз.');
  }
  const texts = {};
  const valid = new Set(p.sc.steps.map((s) => s.n));
  for (const s of ans.steps || []) {
    const n = Number(s?.n);
    if (valid.has(n) && s.text) texts[n] = String(s.text).slice(0, 1200);
  }
  session.saveStory({
    entry, depth, hash: p.sc.hash,
    title: String(ans.title || '').slice(0, 120), summary: String(ans.summary || '').slice(0, 2500),
    texts, model: provider.model,
  });
  session.save();
  return { cost, inTok: r.inTok, outTok: r.outTok, steps: Object.keys(texts).length, total: p.steps };
}
