// Проверка ядра без Electron, сети и настоящего ИИ.
// Разбираются два маленьких учебных проекта из tests/fixtures:
//   py_app — магазин на Python (классы, методы, импорты, Depends);
//   js_app — корзина на React + Express (компоненты, хуки, createSlice, маршруты, require).
// GitHub и модель подделаны (форматы Anthropic и OpenAI). Запуск: npm test
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { MimisCore } from '../core/core.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PY = path.join(FIX, 'py_app');
const JS = path.join(FIX, 'js_app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimis-test-'));
let ok = 0;
const step = (m) => { ok += 1; console.log(`  ✓ ${m}`); };

// ---- поддельный GitHub: отдаёт js_app zip-архивом, как codeload ----
function zipFolder(dir, prefix) {
  const entries = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else entries[`${prefix}/${path.relative(dir, full).split(path.sep).join('/')}`] = strToU8(fs.readFileSync(full, 'utf8'));
    }
  })(dir);
  return Buffer.from(zipSync(entries));
}
const zipData = zipFolder(JS, 'example-js_app-abc1234');
const gh = http.createServer((req, res) => {
  if (req.url === '/repos/example/js_app') return res.end(JSON.stringify({ default_branch: 'main' }));
  if (req.url.startsWith('/repos/example/js_app/commits/')) return res.end(JSON.stringify({ sha: 'abc1234567890', commit: { message: 'Тестовый коммит\n\nтело', committer: { date: '2026-11-18T10:00:00Z' } } }));
  if (req.url.startsWith('/example/js_app/zip/')) return res.end(zipData);
  res.statusCode = 404; res.end('{}');
});

// ---- поддельная модель ----
let calls = 0;
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls += 1;
    const j = JSON.parse(body);
    const user = req.url.includes('/messages') ? j.messages[0].content : j.messages[1].content;
    let answer;
    if (user.includes('Разложи файлы по смысловым слоям')) {
      const files = [...user.matchAll(/^- (\S+) \(/gm)].map((m) => m[1]);
      const bare = [...user.matchAll(/^- (\S+) \([^)]*\)(?!:)/gm)].map((m) => m[1]);
      answer = { file_purposes: Object.fromEntries(bare.map((f) => [f, 'Назначение из обзора.'])), summary: 'Тестовый обзор.', layers: [{ name: 'Первая половина', description: 'Тест', files: files.slice(0, Math.ceil(files.length / 2)) }, { name: 'Вторая половина', description: 'Тест', files: files.slice(Math.ceil(files.length / 2)) }] };
    } else if (user.includes('одним словом')) {
      answer = null;
    } else {
      const names = [...user.matchAll(/^- (.+?) \((?:функция|метод|класс|React-компонент|React-хук|маршрут),/gm)].map((m) => m[1]);
      answer = {
        file_purpose: 'Тестовое назначение файла.',
        items: names.map((n) => ({ name: n, phrase: `Фраза про ${n}`, what: `Что делает ${n}.`, io: 'Вход/выход.', example: 'Пример.', watch: 'Внимание.' })),
        terms: [{ term: 'тест', definition: 'проверка' }],
      };
    }
    const text = answer ? '```json\n' + JSON.stringify(answer) + '\n```' : 'Готов';
    // отчитываемся о реалистичном расходе: ~480 токенов на одно пояснение
    const usage = { in: Math.round(user.length / 3), out: Math.round(text.length / 3) + (answer?.items?.length || 0) * 480 };
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/messages')) {
      assert.equal(req.headers['x-api-key'], 'test-key');
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: usage.in, output_tokens: usage.out }, stop_reason: 'end_turn' }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: usage.in, completion_tokens: usage.out } }));
    }
  });
});

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const ghPort = await listen(gh);
const llmPort = await listen(llm);
process.env.MIMIS_GITHUB_API = `http://127.0.0.1:${ghPort}`;
process.env.MIMIS_GITHUB_CODELOAD = `http://127.0.0.1:${ghPort}`;

try {
  console.log('Mímisbrunnr: проверка ядра');
  const core = new MimisCore(path.join(tmp, 'data'));
  core.updateSettings({ name: 'Данила' });
  assert.equal(core.state().settings.name, 'Данила');
  step('настройки сохраняются');

  const hasEdge = (sess, a, b) => sess.edges.some(([x, y]) => x === a && y === b);
  const kindOf = (sess, id) => sess.items.find((i) => i.id === id)?.kind;

  // 1. локальная папка, Python
  const back = await core.createSession(PY);
  for (const [id, kind] of [
    ['app/db.py::Database', 'class'], ['app/db.py::Database.transaction', 'method'], ['app/db.py::get_db', 'function'],
    ['app/services/orders.py::OrderService.create', 'method'], ['app/api/routes.py::create_order', 'function'],
    ['app/rules.py::classify', 'function'],
  ]) assert.equal(kindOf(back, id), kind, id);
  for (const [a, b] of [
    ['app/db.py::Database.query', 'app/db.py::Database.connect'], // self.method()
    ['app/services/pricing.py::apply_discount', 'app/services/pricing.py::_rate'], // вызов в том же файле
    ['app/services/orders.py::OrderService.create', 'app/services/pricing.py::apply_discount'], // относительный импорт
    ['app/services/orders.py::OrderService.create', 'app/services/orders.py::OrderService._validate'],
    ['app/services/orders.py::OrderService.create', 'app/db.py::Database.insert'], // self.repo: Database
    ['app/services/orders.py::OrderService.create', 'app/models.py::Order'], // создание объекта
    ['app/api/routes.py::create_order', 'app/db.py::get_db'], // Depends(get_db)
    ['app/api/routes.py::create_order', 'app/services/orders.py::OrderService'],
  ]) assert.ok(hasEdge(back, a, b), `${a} → ${b}`);
  assert.equal(back.counts.none, back.counts.total);
  step(`папка (Python): ${back.files.length} файлов, ${back.items.length} функций, ${back.edges.length} связей, слои: ${back.layers.map((l) => l.name).join(', ')}`);

  // 2. GitHub через zip, JS/React/Express
  const front = await core.createSession('https://github.com/example/js_app');
  assert.equal(front.commit.short, 'abc1234');
  for (const [id, kind] of [
    ['src/App.jsx::App', 'component'], ['src/components/Layout.jsx::Layout', 'component'], // memo(...)
    ['src/features/cart/CartItem.jsx::CartItem', 'component'], // стрелочная функция
    ['src/features/cart/useCart.js::useCart', 'hook'],
    ['src/features/cart/CartPage.jsx::CartPage.handleRemove', 'function'], // обработчик внутри компонента
    ['src/features/cart/cartSlice.js::cartSlice.removeItem', 'method'], // редьюсер createSlice
    ['src/legacy/Counter.js::Counter.increment', 'method'],
    ['src/utils/format.ts::formatPrice', 'function'], // TypeScript
    ['server/index.js::GET /api/orders/:customer', 'route'], // Express
    ['server/orders.js::countOrders', 'function'], // exports.*
  ]) assert.equal(kindOf(front, id), kind, id);
  for (const [a, b] of [
    ['src/App.jsx::App', 'src/features/cart/CartPage.jsx::CartPage'], // JSX
    ['src/features/cart/CartPage.jsx::CartPage', 'src/features/cart/CartItem.jsx::CartItem'], // JSX внутри map
    ['src/features/cart/CartPage.jsx::CartPage', 'src/features/cart/useCart.js::useCart'],
    ['src/features/cart/useCart.js::useCart', 'src/utils/format.ts::formatPrice'], // импорт .ts без расширения
    ['server/index.js::GET /api/orders/:customer', 'server/orders.js::listOrders'], // require + module.exports
  ]) assert.ok(hasEdge(front, a, b), `${a} → ${b}`);
  step(`GitHub (JS/React): ${front.files.length} файлов, ${front.items.length} позиций, коммит ${front.commit.short} «${front.commit.subject}»`);
  const code = await core.code(front.id, 'src/App.jsx');
  assert.equal(code, fs.readFileSync(path.join(JS, 'src/App.jsx'), 'utf8'));
  step('код файла хранится в сессии и отдаётся целиком');

  // 3. оценка и бюджет (OpenAI-совместимый)
  core.updateSettings({ provider: { type: 'openai', baseUrl: `http://127.0.0.1:${llmPort}/v1`, model: 'fake', priceIn: 2, priceOut: 10 }, apiKey: '' });
  const est = await core.estimate(front.id, { kind: 'all' });
  assert.ok(est.count === front.items.length && est.estCost > 0);
  step(`оценка: ${est.count} функций, ${est.requests} запросов, ~${est.estIn} + ${est.estOut} токенов, ~$${est.estCost.toFixed(3)}`);

  const budget = est.estCost * 0.4;
  core.updateSettings({ budgetUsd: budget });
  let r = await (await core.startExplain(front.id, { kind: 'all' })).promise;
  assert.equal(r.status, 'budget', r.log.join('\n'));
  let v = await core.view(front.id);
  assert.ok(v.counts.fresh > 0 && v.counts.fresh < v.counts.total);
  assert.ok(r.spent <= budget);
  step(`лимит бюджета: остановка на ${v.counts.fresh}/${v.counts.total}, потрачено $${r.spent.toFixed(4)} из $${budget.toFixed(4)}`);

  core.updateSettings({ budgetUsd: 100 });
  r = await (await core.startExplain(front.id, { kind: 'all' })).promise;
  assert.equal(r.status, 'done', r.log.join('\n'));
  v = await core.view(front.id);
  assert.equal(v.counts.fresh, v.counts.total);
  assert.equal(v.layersSource, 'ai');
  assert.ok(v.summary && v.terms.length && v.files.every((f) => f.purpose));
  step(`продолжение: объяснено ${v.counts.fresh}/${v.counts.total}, слои от ИИ: ${v.layers.map((l) => l.name).join(', ')}`);
  assert.ok(core.state().settings.monthSpend > 0);
  step(`счётчик расходов за месяц: $${core.state().settings.monthSpend.toFixed(4)}, в сессии $${v.usage.cost.toFixed(4)}`);

  // 4. формат Anthropic, одна функция
  core.updateSettings({ provider: { type: 'anthropic', baseUrl: `http://127.0.0.1:${llmPort}`, model: 'fake-claude', priceIn: 2, priceOut: 10 }, apiKey: 'test-key' });
  r = await (await core.startExplain(back.id, { kind: 'item', id: 'app/rules.py::classify' })).promise;
  v = await core.view(back.id);
  assert.equal(v.expl['app/rules.py::classify'].what, 'Что делает classify.');
  step('формат Anthropic: пояснение одной функции');
  const t = await core.testConnection();
  assert.equal(t.reply, 'Готов');
  step('проверка подключения к модели');

  // 5. ручная правка
  v = await core.saveExplanation(back.id, 'app/db.py::Database.transaction', { phrase: 'ф', what: 'Вручную', io: '', example: '', watch: '' });
  assert.equal(v.items.find((i) => i.id === 'app/db.py::Database.transaction').status, 'fresh');
  step('ручная правка пояснения');

  // 6. обновление: изменённая, новая и удалённая функции
  const copy = path.join(tmp, 'py-copy');
  fs.cpSync(PY, copy, { recursive: true });
  const s2 = await core.createSession(copy);
  await (await core.startExplain(s2.id, { kind: 'file', file: 'app/rules.py' })).promise;
  const f = path.join(copy, 'app/rules.py');
  const src = fs.readFileSync(f, 'utf8');
  const changed = src.replace('elif sum(weak) >= 2:', 'elif sum(weak) >= 1:').replaceAll('_rule_night_time', '_rule_late_hour')
    + '\n\ndef new_helper(x):\n    return x\n';
  assert.notEqual(changed, src);
  fs.writeFileSync(f, changed);
  v = await core.updateSession(s2.id);
  const st = (id) => v.items.find((i) => i.id === id)?.status;
  assert.equal(st('app/rules.py::classify'), 'stale');
  assert.equal(st('app/rules.py::new_helper'), 'none');
  assert.equal(st('app/rules.py::_rule_big_amount'), 'fresh');
  assert.ok(v.orphans.includes('app/rules.py::_rule_night_time'));
  step(`обновление: изменено ${v.lastUpdate.changed}, новых ${v.lastUpdate.added}, удалено ${v.lastUpdate.removed}; устаревшие и новые помечены`);

  // 7. сессии переживают перезапуск
  const core2 = new MimisCore(path.join(tmp, 'data'));
  const list = await core2.listSessions();
  assert.equal(list.length, 3);
  const again = await core2.view(front.id);
  assert.equal(again.counts.fresh, again.counts.total);
  step(`перезапуск: ${list.length} сессии прочитаны с диска, пояснения на месте`);

  core2.deleteSession(s2.id);
  assert.equal((await core2.listSessions()).length, 2);
  step('удаление сессии');
  console.log(`Все проверки пройдены (${ok}). Запросов к модели: ${calls}.`);
} finally {
  gh.close(); llm.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
