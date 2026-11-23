// Вызов языковой модели. Два формата API:
// - anthropic — родной API Claude;
// - openai — «OpenAI-совместимый»: OpenAI и многие другие провайдеры,
//   а также локальные Ollama и LM Studio.
// Модель выбирает пользователь; соблюдение условий провайдера — на нём.

export class LlmError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export const PRESETS = [
  { id: 'claude-sonnet', label: 'Claude Sonnet 5.5', type: 'anthropic', baseUrl: '', model: 'claude-sonnet-5-5', priceIn: 2, priceOut: 10, note: 'Цены на 18.11.2026 — проверьте на сайте провайдера.' },
  { id: 'claude-haiku', label: 'Claude Haiku 5.5 (дешевле)', type: 'anthropic', baseUrl: '', model: 'claude-haiku-5-5', priceIn: 0.1, priceOut: 0.5, note: 'Цены на 18.11.2026 — проверьте на сайте провайдера.' },
  { id: 'openai', label: 'OpenAI или другой совместимый API', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', priceIn: 0, priceOut: 0, note: 'Укажите модель и цены вашего провайдера.' },
  { id: 'ollama', label: 'Ollama на этом компьютере (бесплатно)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:14b', priceIn: 0, priceOut: 0, note: 'Модель должна быть скачана: ollama pull <модель>. Ключ не нужен.' },
];

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

async function readError(r) {
  let t = '';
  try { t = await r.text(); } catch { /* */ }
  try { const j = JSON.parse(t); return j.error?.message || j.message || t; } catch { return t; }
}

/**
 * @param provider { type, baseUrl, model }
 * @param apiKey строка или ''
 * @param req { system, user, maxTokens }
 * @returns { text, inTok, outTok }
 */
export async function callModel(provider, apiKey, req, { fetchFn = fetch, timeoutMs = 600_000, signal } = {}) {
  if (!provider?.model) throw new LlmError('Не выбрана модель. Откройте настройки ИИ.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    let r;
    if (provider.type === 'anthropic') {
      if (!apiKey) throw new LlmError('Нет ключа API. Добавьте его в настройках ИИ.');
      r = await fetchFn(`${trimSlash(provider.baseUrl) || 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: provider.model, max_tokens: req.maxTokens || 4096, system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      });
    } else {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      r = await fetchFn(`${trimSlash(provider.baseUrl) || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST', signal: ctrl.signal, headers,
        body: JSON.stringify({
          model: provider.model, max_tokens: req.maxTokens || 4096, temperature: 0.2,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        }),
      });
    }
    if (!r.ok) {
      const msg = await readError(r);
      const hint = r.status === 401 || r.status === 403 ? 'Ключ API не принят провайдером.'
        : r.status === 404 ? 'Модель или адрес API не найдены — проверьте название модели и адрес.'
        : r.status === 429 ? 'Провайдер ограничил частоту запросов.'
        : r.status >= 500 ? 'Ошибка на стороне провайдера.' : 'Провайдер отклонил запрос.';
      throw new LlmError(`${hint} (${r.status}: ${String(msg).slice(0, 300)})`, { status: r.status, retryable: r.status === 429 || r.status >= 500 });
    }
    const j = await r.json();
    if (provider.type === 'anthropic') {
      return {
        text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
        inTok: j.usage?.input_tokens || 0,
        outTok: j.usage?.output_tokens || 0,
        truncated: j.stop_reason === 'max_tokens',
      };
    }
    const ch = j.choices?.[0];
    return {
      text: ch?.message?.content || '',
      inTok: j.usage?.prompt_tokens || 0,
      outTok: j.usage?.completion_tokens || 0,
      truncated: ch?.finish_reason === 'length',
    };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e.name === 'AbortError') throw new LlmError(signal?.aborted ? 'Остановлено.' : 'Модель не ответила вовремя.', { retryable: !signal?.aborted });
    throw new LlmError(`Не удалось связаться с моделью: ${e.message}. Проверьте адрес API и интернет${provider.baseUrl?.includes('localhost') ? ' (запущена ли Ollama?)' : ''}.`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

export function costOf(provider, inTok, outTok) {
  return (inTok * (Number(provider.priceIn) || 0) + outTok * (Number(provider.priceOut) || 0)) / 1e6;
}

/** Достаёт JSON-объект из ответа модели (модели любят обрамлять его текстом). */
export function extractJson(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('В ответе нет JSON');
  return JSON.parse(s.slice(a, b + 1));
}

// ---- Пакетный режим (Batch API): те же запросы, но ответ не сразу, а в течение
// часа (максимум 24 ч) — и вдвое дешевле. Есть у Anthropic и у OpenAI;
// у других OpenAI-совместимых провайдеров и у локальных моделей — нет.

const BATCH_PRICE = 0.5;
export const batchCostOf = (provider, inTok, outTok) => costOf(provider, inTok, outTok) * BATCH_PRICE;

/** '' — пакетный режим доступен; иначе — объяснение, почему нет. */
export function batchUnsupported(provider) {
  if (!provider?.model) return 'Не выбрана модель.';
  if (provider.type === 'anthropic' || process.env.MIMIS_BATCH_ANY === '1') return '';
  const host = (() => { try { return new URL(provider.baseUrl || 'https://api.openai.com/v1').host; } catch { return ''; } })();
  if (host === 'api.openai.com') return '';
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return 'Локальная модель отвечает сразу и бесплатно — пакетный режим ей не нужен.';
  return 'Пакетный режим есть только у Anthropic (Claude) и OpenAI. У этого провайдера его может не быть.';
}

async function http(fetchFn, url, init, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { ...init, signal: ctrl.signal });
    if (!r.ok) {
      const msg = await readError(r);
      const hint = r.status === 401 || r.status === 403 ? 'Ключ API не принят провайдером.'
        : r.status === 404 ? 'Пакет не найден у провайдера (возможно, он удалён или ключ от другого аккаунта).'
        : r.status === 429 ? 'Провайдер ограничил частоту запросов.'
        : r.status >= 500 ? 'Ошибка на стороне провайдера.' : 'Провайдер отклонил пакет.';
      throw new LlmError(`${hint} (${r.status}: ${String(msg).slice(0, 300)})`, { status: r.status, retryable: r.status === 429 || r.status >= 500 });
    }
    return r;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e.name === 'AbortError') throw new LlmError('Провайдер не ответил вовремя.', { retryable: true });
    throw new LlmError(`Не удалось связаться с провайдером: ${e.message}.`, { retryable: true });
  } finally { clearTimeout(timer); }
}

const anthropicHeaders = (apiKey) => ({ 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
const openaiHeaders = (apiKey, json = true) => ({ ...(json ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${apiKey}` });
const aBase = (p) => trimSlash(p.baseUrl) || 'https://api.anthropic.com';
const oBase = (p) => trimSlash(p.baseUrl) || 'https://api.openai.com/v1';
const jsonl = (text) => String(text || '').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/**
 * Отправить пакет. reqs: [{ id, system, user, maxTokens }], id — латиница, цифры, _ и -.
 * @returns { batchId }
 */
export async function submitBatch(provider, apiKey, reqs, { fetchFn = fetch } = {}) {
  const why = batchUnsupported(provider);
  if (why) throw new LlmError(why);
  if (!apiKey) throw new LlmError('Нет ключа API. Добавьте его в настройках ИИ.');
  if (provider.type === 'anthropic') {
    const r = await http(fetchFn, `${aBase(provider)}/v1/messages/batches`, {
      method: 'POST', headers: anthropicHeaders(apiKey),
      body: JSON.stringify({ requests: reqs.map((q) => ({ custom_id: q.id, params: { model: provider.model, max_tokens: q.maxTokens || 4096, system: q.system, messages: [{ role: 'user', content: q.user }] } })) }),
    });
    const j = await r.json();
    return { batchId: j.id };
  }
  // OpenAI: сначала файл JSONL с запросами, потом пакет из этого файла
  const lines = reqs.map((q) => JSON.stringify({ custom_id: q.id, method: 'POST', url: '/v1/chat/completions', body: { model: provider.model, max_tokens: q.maxTokens || 4096, temperature: 0.2, messages: [{ role: 'system', content: q.system }, { role: 'user', content: q.user }] } })).join('\n');
  const boundary = `mimis${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="explain.jsonl"\r\nContent-Type: application/jsonl\r\n\r\n${lines}\r\n--${boundary}--\r\n`;
  const up = await (await http(fetchFn, `${oBase(provider)}/files`, { method: 'POST', headers: { ...openaiHeaders(apiKey, false), 'content-type': `multipart/form-data; boundary=${boundary}` }, body }, 300_000)).json();
  const b = await (await http(fetchFn, `${oBase(provider)}/batches`, { method: 'POST', headers: openaiHeaders(apiKey), body: JSON.stringify({ input_file_id: up.id, endpoint: '/v1/chat/completions', completion_window: '24h' }) })).json();
  return { batchId: b.id };
}

/**
 * Состояние пакета.
 * @returns { ended, canceling, done, total, failed, ref, error }
 *   ref — откуда забирать результаты (адрес у Anthropic, файлы у OpenAI)
 */
export async function batchStatus(provider, apiKey, batchId, { fetchFn = fetch } = {}) {
  if (provider.type === 'anthropic') {
    const j = await (await http(fetchFn, `${aBase(provider)}/v1/messages/batches/${encodeURIComponent(batchId)}`, { headers: anthropicHeaders(apiKey) })).json();
    const c = j.request_counts || {};
    const total = (c.processing || 0) + (c.succeeded || 0) + (c.errored || 0) + (c.canceled || 0) + (c.expired || 0);
    return { ended: j.processing_status === 'ended', canceling: j.processing_status === 'canceling', done: total - (c.processing || 0), total, failed: (c.errored || 0) + (c.canceled || 0) + (c.expired || 0), ref: j.results_url ? { url: j.results_url } : null, error: '' };
  }
  const j = await (await http(fetchFn, `${oBase(provider)}/batches/${encodeURIComponent(batchId)}`, { headers: openaiHeaders(apiKey) })).json();
  const c = j.request_counts || {};
  const ended = ['completed', 'failed', 'expired', 'cancelled'].includes(j.status);
  const error = j.status === 'failed' ? (j.errors?.data || []).map((e) => e.message).join('; ') || 'Провайдер не принял пакет.' : '';
  return { ended, canceling: j.status === 'cancelling', done: (c.completed || 0) + (c.failed || 0), total: c.total || 0, failed: c.failed || 0, ref: ended ? { output: j.output_file_id || null, errors: j.error_file_id || null } : null, error };
}

/**
 * Результаты закончившегося пакета, в любом порядке.
 * @returns [{ id, ok, text, inTok, outTok, truncated, error }]
 */
export async function batchResults(provider, apiKey, ref, { fetchFn = fetch } = {}) {
  if (!ref) return [];
  if (provider.type === 'anthropic') {
    const t = await (await http(fetchFn, ref.url, { headers: anthropicHeaders(apiKey) }, 300_000)).text();
    return jsonl(t).map((l) => {
      const m = l.result?.message;
      if (l.result?.type !== 'succeeded' || !m) return { id: l.custom_id, ok: false, error: l.result?.error?.error?.message || l.result?.error?.message || l.result?.type || 'ошибка' };
      return { id: l.custom_id, ok: true, text: (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), inTok: m.usage?.input_tokens || 0, outTok: m.usage?.output_tokens || 0, truncated: m.stop_reason === 'max_tokens' };
    });
  }
  const out = [];
  for (const fid of [ref.output, ref.errors].filter(Boolean)) {
    const t = await (await http(fetchFn, `${oBase(provider)}/files/${encodeURIComponent(fid)}/content`, { headers: openaiHeaders(apiKey) }, 300_000)).text();
    for (const l of jsonl(t)) {
      const b = l.response?.body;
      const ch = b?.choices?.[0];
      if (!ch || (l.response?.status_code && l.response.status_code >= 400)) { out.push({ id: l.custom_id, ok: false, error: l.error?.message || b?.error?.message || 'ошибка' }); continue; }
      out.push({ id: l.custom_id, ok: true, text: ch.message?.content || '', inTok: b.usage?.prompt_tokens || 0, outTok: b.usage?.completion_tokens || 0, truncated: ch.finish_reason === 'length' });
    }
  }
  return out;
}

/** Отменить пакет. То, что модель уже успела сделать, всё равно придёт (и будет оплачено). */
export async function cancelBatch(provider, apiKey, batchId, { fetchFn = fetch } = {}) {
  if (provider.type === 'anthropic') await http(fetchFn, `${aBase(provider)}/v1/messages/batches/${encodeURIComponent(batchId)}/cancel`, { method: 'POST', headers: anthropicHeaders(apiKey) });
  else await http(fetchFn, `${oBase(provider)}/batches/${encodeURIComponent(batchId)}/cancel`, { method: 'POST', headers: openaiHeaders(apiKey) });
}
