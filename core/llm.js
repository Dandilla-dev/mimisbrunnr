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
