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
import { localGitInfo } from '../core/fetchRepo.js';
import { buildScenario, entryPoints } from '../core/scenario.js';

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
// ветка feature: та же корзина, но formatPrice переписана
const JS2 = path.join(tmp, 'js_feature');
fs.cpSync(JS, JS2, { recursive: true });
fs.writeFileSync(path.join(JS2, 'src/utils/format.ts'), "export function formatPrice(n: number): string {\n  return `${Math.round(n)} руб.`;\n}\n");
const zipFeature = zipFolder(JS2, 'example-js_app-fea7ure');
let zipDownloads = 0;
const gh = http.createServer((req, res) => {
  if (req.url === '/repos/example/js_app') return res.end(JSON.stringify({ default_branch: 'main' }));
  if (req.url.startsWith('/repos/example/js_app/branches')) return res.end(JSON.stringify([{ name: 'main', commit: { sha: 'abc1234567890' } }, { name: 'feature', commit: { sha: 'fea7ure000000' } }]));
  if (req.url.startsWith('/repos/example/js_app/commits/feature')) return res.end(JSON.stringify({ sha: 'fea7ure000000', commit: { message: 'Новая цена', committer: { date: '2026-11-20T10:00:00Z' } } }));
  if (req.url.startsWith('/repos/example/js_app/commits/')) return res.end(JSON.stringify({ sha: 'abc1234567890', commit: { message: 'Тестовый коммит\n\nтело', committer: { date: '2026-11-18T10:00:00Z' } } }));
  if (req.url.startsWith('/example/js_app/zip/fea7ure')) { zipDownloads += 1; return res.end(zipFeature); }
  if (req.url.startsWith('/example/js_app/zip/')) { zipDownloads += 1; return res.end(zipData); }
  res.statusCode = 404; res.end('{}');
});

// ---- поддельная модель ----
let calls = 0;
function answerFor(user) {
  let answer;
  if (user.includes('Разложи файлы по смысловым слоям')) {
    const files = [...user.matchAll(/^- (\S+) \(/gm)].map((m) => m[1]);
    const bare = [...user.matchAll(/^- (\S+) \([^)]*\)(?!:)/gm)].map((m) => m[1]);
    answer = { file_purposes: Object.fromEntries(bare.map((f) => [f, 'Назначение из обзора.'])), summary: 'Тестовый обзор.', layers: [{ name: 'Первая половина', description: 'Тест', files: files.slice(0, Math.ceil(files.length / 2)) }, { name: 'Вторая половина', description: 'Тест', files: files.slice(Math.ceil(files.length / 2)) }] };
  } else if (user.includes('одним словом')) {
    answer = null;
  } else if (user.includes('по шагам — так, чтобы ученик понял')) {
    const ls = [...user.matchAll(/^\s*(\d+)\| /gm)].map((m) => Number(m[1]));
    answer = { steps: [{ from: ls[0], to: ls[1] || ls[0], title: 'Начало', text: 'Шаг один.' }, { from: (ls[1] || ls[0]) + 1, to: ls[ls.length - 1], title: 'Конец', text: 'Шаг два.' }] };
  } else if (user.includes('Разбираем сценарий')) {
    const ns = [...user.matchAll(/^\s*(\d+)\. /gm)].map((m) => Number(m[1]));
    answer = { title: 'Тестовый сценарий', summary: 'Сводка сценария.', steps: ns.map((n) => ({ n, text: `Шаг ${n}.` })) };
  } else {
    const names = [...user.matchAll(/^- (.+?) \((?:функция|метод|класс|React-компонент|React-хук|маршрут|сущность),/gm)].map((m) => m[1]);
    answer = {
      file_purpose: 'Тестовое назначение файла.',
      items: names.map((n) => ({ name: n, phrase: `Фраза про ${n}`, what: `Что делает ${n}.`, io: 'Вход/выход.', example: 'Пример.', watch: 'Внимание.' })),
      terms: [{ term: 'тест', definition: 'проверка' }],
    };
  }
  const text = answer ? '```json\n' + JSON.stringify(answer) + '\n```' : 'Готов';
  // отчитываемся о реалистичном расходе: ~480 токенов на одно пояснение
  const usage = { in: Math.round(user.length / 3), out: Math.round(text.length / 3) + (answer?.items?.length || 0) * 480 };
  return { text, usage };
}
// пакеты (Batch API): первая проверка — «ещё идёт», вторая — готово
const batches = new Map();
let batchSeq = 0;
const files = new Map();
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const u = req.url;
    // Anthropic
    if (u === '/v1/messages/batches' && req.method === 'POST') {
      assert.equal(req.headers['x-api-key'], 'test-key');
      const id = `msgbatch_${++batchSeq}`;
      batches.set(id, { reqs: JSON.parse(body).requests, polls: 0 });
      return res.end(JSON.stringify({ id, processing_status: 'in_progress' }));
    }
    let m = u.match(/^\/v1\/messages\/batches\/([^/]+)(\/cancel)?$/);
    if (m) {
      const b = batches.get(m[1]);
      if (!b) { res.statusCode = 404; return res.end('{"error":{"message":"not found"}}'); }
      if (m[2]) { b.canceled = true; return res.end('{}'); }
      b.polls += 1;
      const ended = b.polls >= 2 || b.canceled;
      const n = b.reqs.length;
      return res.end(JSON.stringify({ id: m[1], processing_status: ended ? 'ended' : 'in_progress', request_counts: ended ? { processing: 0, succeeded: b.canceled ? 0 : n, errored: 0, canceled: b.canceled ? n : 0, expired: 0 } : { processing: n, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, results_url: ended ? `http://127.0.0.1:${llmPort}/results/${m[1]}` : null }));
    }
    m = u.match(/^\/results\/(.+)$/);
    if (m) {
      const b = batches.get(m[1]);
      return res.end(b.reqs.map((q) => {
        if (b.canceled) return JSON.stringify({ custom_id: q.custom_id, result: { type: 'canceled' } });
        calls += 1;
        const a = answerFor(q.params.messages[0].content);
        return JSON.stringify({ custom_id: q.custom_id, result: { type: 'succeeded', message: { content: [{ type: 'text', text: a.text }], usage: { input_tokens: a.usage.in, output_tokens: a.usage.out }, stop_reason: 'end_turn' } } });
      }).reverse().join('\n')); // порядок результатов не гарантирован
    }
    // OpenAI: файл → пакет → файл с ответами
    if (u === '/v1/files' && req.method === 'POST') {
      assert.match(req.headers['content-type'], /multipart\/form-data; boundary=/);
      assert.match(body, /name="purpose"\r\n\r\nbatch/);
      const content = body.split('\r\n\r\n').slice(2).join('\r\n\r\n').replace(/\r\n--[^\r\n]+--\r\n$/, '');
      const id = `file-${++batchSeq}`;
      files.set(id, content);
      return res.end(JSON.stringify({ id }));
    }
    if (u === '/v1/batches' && req.method === 'POST') {
      const j = JSON.parse(body);
      assert.equal(j.endpoint, '/v1/chat/completions');
      const id = `batch_${++batchSeq}`;
      batches.set(id, { reqs: files.get(j.input_file_id).split('\n').map((l) => JSON.parse(l)), polls: 0 });
      return res.end(JSON.stringify({ id, status: 'validating' }));
    }
    m = u.match(/^\/v1\/batches\/([^/]+)$/);
    if (m) {
      const b = batches.get(m[1]);
      b.polls += 1;
      const n = b.reqs.length;
      if (b.polls < 2) return res.end(JSON.stringify({ id: m[1], status: 'in_progress', request_counts: { total: n, completed: 0, failed: 0 } }));
      const out = `file-out-${m[1]}`;
      files.set(out, b.reqs.map((q, k) => {
        if (k === 0) return JSON.stringify({ custom_id: q.custom_id, response: null, error: { message: 'тестовая ошибка' } });
        calls += 1;
        const a = answerFor(q.body.messages[1].content);
        return JSON.stringify({ custom_id: q.custom_id, response: { status_code: 200, body: { choices: [{ message: { content: a.text }, finish_reason: 'stop' }], usage: { prompt_tokens: a.usage.in, completion_tokens: a.usage.out } } }, error: null });
      }).join('\n'));
      return res.end(JSON.stringify({ id: m[1], status: 'completed', request_counts: { total: n, completed: n - 1, failed: 1 }, output_file_id: out }));
    }
    m = u.match(/^\/v1\/files\/([^/]+)\/content$/);
    if (m) return res.end(files.get(m[1]));

    calls += 1;
    const j = JSON.parse(body);
    const user = u.includes('/messages') ? j.messages[0].content : j.messages[1].content;
    const { text, usage } = answerFor(user);
    if (u.includes('/messages')) {
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
    // тип из результата другой функции: session = memory.get(...); session.add(...)
    ['app/sessions.py::remember_line', 'app/sessions.py::SessionStore.get'],
    ['app/sessions.py::remember_line', 'app/sessions.py::Session.add'],
    ['app/api/routes.py::create_order', 'app/services/orders.py::OrderService.create'], // service = OrderService(...)
    ['app/models.py::Order.total', 'app/models.py::Item.subtotal'], // for i in self.items, items: list[Item]
  ]) assert.ok(hasEdge(back, a, b), `${a} → ${b}`);
  const kindOfEdge = (sess, a, b) => sess.edges.find(([x, y]) => x === a && y === b)?.[2];
  assert.equal(kindOfEdge(back, 'app/rules.py::classify', 'app/rules.py::_rule_night_time'), 'ref'); // передаётся в кортеже
  assert.equal(kindOfEdge(back, 'app/rules.py::classify', 'app/rules.py::_rule_big_amount'), 'call');
  const site = (sess, a, b) => sess.sites.find(([x, y]) => x === a && y === b);
  assert.equal(site(back, 'app/services/orders.py::OrderService.create', 'app/db.py::Database.insert')[4], 'with self.repo.transaction():');
  assert.equal(site(back, 'app/db.py::Database.query', 'app/db.py::Database.connect')[4], 'if not self.connected:');
  // наследование, getattr по строке, словарь функций, догадка о типе
  assert.ok(back.sites.some(([a, b, , k, , label]) => a === 'app/reports.py::CsvExporter.export_pdf' && b === 'app/reports.py::BaseExporter.export' && k === 'call' && /унаследован от BaseExporter/.test(label)));
  assert.ok(hasEdge(back, 'app/reports.py::make_report', 'app/reports.py::BaseExporter.header')); // exp.header(), exp: CsvExporter
  assert.equal(kindOfEdge(back, 'app/reports.py::make_report', 'app/reports.py::CsvExporter.export_csv'), 'dispatch');
  assert.equal(kindOfEdge(back, 'app/reports.py::make_report', 'app/reports.py::CsvExporter.export_pdf'), 'dispatch');
  assert.equal(kindOfEdge(back, 'app/reports.py::transform', 'app/reports.py::to_upper'), 'dispatch');
  assert.equal(kindOfEdge(back, 'app/reports.py::notify', 'app/reports.py::Mailer.deliver_welcome'), 'guess');
  step('Python: тип из результата функции, связи «передаётся», места вызовов с условиями, наследование, «одна из», догадки');
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
    ['src/api/orders.ts::loadOrders', 'src/api/client.ts::ApiClient.get'], // client = makeClient(): ApiClient
    ['src/features/cart/useCart.js::useCart.remove', 'src/features/cart/cartSlice.js::cartSlice.removeItem'], // export const { removeItem } = slice.actions
  ]) assert.ok(hasEdge(front, a, b), `${a} → ${b}`);
  assert.equal(front.edges.find(([x, y]) => x === 'src/features/cart/CartPage.jsx::CartPage' && y === 'src/features/cart/CartPage.jsx::CartPage.handleRemove')?.[2], 'ref'); // onRemove={handleRemove}
  const fk = (a, b) => front.edges.find(([x, y]) => x === a && y === b)?.[2];
  assert.equal(fk('src/legacy/Counter.js::StepCounter.incrementTwice', 'src/legacy/Counter.js::Counter.increment'), 'call'); // this.increment() — от родителя
  assert.equal(fk('src/legacy/Counter.js::StepCounter.incrementTwice', 'src/legacy/Counter.js::Counter.reset'), 'call'); // super.reset()
  assert.equal(fk('src/utils/dispatch.js::dispatch', 'src/utils/dispatch.js::onCreate'), 'dispatch'); // handlers[event.type](event)
  assert.equal(fk('src/utils/dispatch.js::notify', 'src/utils/dispatch.js::Mailer.sendWelcomeLetter'), 'guess');
  step('JS/TS: тип из результата функции, действия createSlice, обработчик в JSX — «передаётся», наследование, «одна из», догадки');
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

  // ветки: список, переключение, пояснения для каждой версии кода, сохранённые копии
  const FP = 'src/utils/format.ts::formatPrice';
  const br = await core.branches(front.id, true);
  assert.equal(br.current, 'main');
  assert.deepEqual(br.list.map((b) => [b.name, b.cached]), [['main', true], ['feature', false]]);
  const peek = await core.peekBranches('https://github.com/example/js_app');
  assert.deepEqual(peek.list.map((b) => b.name), ['main', 'feature']);
  const dl0 = zipDownloads;
  v = await core.switchBranch(front.id, 'feature');
  assert.equal(v.source.branch, 'feature');
  assert.equal(v.commit.short, 'fea7ure');
  assert.equal(v.items.find((i) => i.id === FP).status, 'stale'); // код другой — пояснение от main помечено
  assert.equal(v.counts.fresh, v.counts.total - 1); // остальные функции те же — пояснения на месте
  await (await core.startExplain(front.id, { kind: 'item', id: FP })).promise;
  assert.equal((await core.view(front.id)).items.find((i) => i.id === FP).status, 'fresh');
  v = await core.switchBranch(front.id, 'main');
  assert.equal(v.items.find((i) => i.id === FP).status, 'fresh'); // вернулось пояснение для кода из main
  assert.equal(v.expl[FP].branch, 'main');
  v = await core.switchBranch(front.id, 'feature');
  assert.equal(v.items.find((i) => i.id === FP).status, 'fresh'); // и для кода из feature
  assert.equal(zipDownloads - dl0, 1); // feature скачана один раз, дальше — сохранённая копия
  assert.ok((await core.branches(front.id)).list.every((b) => b.cached));
  v = await core.switchBranch(front.id, 'main');
  step('ветки: список, переключение, пояснения для каждой версии кода, без повторной загрузки');
  // папка с git: ветки читаются из .git (git не запускается)
  const gr = path.join(tmp, 'gitrepo', '.git');
  fs.mkdirSync(path.join(gr, 'refs/heads/feature'), { recursive: true });
  fs.writeFileSync(path.join(gr, 'HEAD'), 'ref: refs/heads/dev\n');
  fs.writeFileSync(path.join(gr, 'refs/heads/dev'), 'a'.repeat(40));
  fs.writeFileSync(path.join(gr, 'refs/heads/feature/login'), 'b'.repeat(40));
  fs.writeFileSync(path.join(gr, 'packed-refs'), `# pack-refs\n${'c'.repeat(40)} refs/heads/main\n`);
  fs.writeFileSync(path.join(gr, 'config'), '[remote "origin"]\n\turl = git@github.com:example/js_app.git\n');
  const gi = localGitInfo(path.join(tmp, 'gitrepo'));
  assert.deepEqual(gi, { current: 'dev', branches: ['dev', 'feature/login', 'main'], remote: { owner: 'example', repo: 'js_app' } });
  step('папка с git: текущая ветка, список веток и адрес на GitHub — из файлов .git');

  // 4. формат Anthropic, одна функция
  core.updateSettings({ provider: { type: 'anthropic', baseUrl: `http://127.0.0.1:${llmPort}`, model: 'fake-claude', priceIn: 2, priceOut: 10 }, apiKey: 'test-key' });
  r = await (await core.startExplain(back.id, { kind: 'item', id: 'app/rules.py::classify' })).promise;
  v = await core.view(back.id);
  assert.equal(v.expl['app/rules.py::classify'].what, 'Что делает classify.');
  step('формат Anthropic: пояснение одной функции');
  const t = await core.testConnection();
  assert.equal(t.reply, 'Готов');
  step('проверка подключения к модели');

  // пакетный режим: вдвое дешевле, ответ позже; пакет переживает перезапуск
  const pb = await core.createSession(PY);
  const pe = await core.estimate(pb.id, { kind: 'all' });
  assert.equal(pe.batch.why, '');
  assert.ok(pe.batch.estCost < pe.estCost * 0.6 && pe.batch.estCost > pe.estCost * 0.4, `${pe.batch.estCost} / ${pe.estCost}`);
  v = await core.startBatch(pb.id, { kind: 'all' });
  assert.ok(v.batch?.id && v.batch.count === pe.count && !('map' in v.batch));
  await assert.rejects(core.startBatch(pb.id, { kind: 'all' }), /уже отправлен/);
  let cb = await core.checkBatch(pb.id);
  assert.equal(cb.state, 'waiting');
  assert.equal(cb.view.batch.last.total, pe.requests - (pe.overview ? 1 : 0));
  const coreR = new MimisCore(path.join(tmp, 'data')); // приложение закрыли и открыли
  coreR.updateSettings({});
  cb = await coreR.checkBatch(pb.id);
  assert.equal(cb.state, 'applied', JSON.stringify(cb.result?.log));
  assert.equal(cb.view.batch, null);
  assert.equal(cb.view.counts.fresh, cb.view.counts.total);
  assert.equal(cb.view.layersSource, 'ai'); // обзор проекта — обычным запросом после пакета
  assert.ok(cb.result.spent > 0 && cb.result.spent < pe.estCost);
  assert.equal(cb.view.batchLast.done, pe.count);
  step(`пакет (Anthropic): ${cb.result.done}/${cb.result.total} за $${cb.result.spent.toFixed(4)} вместо ~$${pe.estCost.toFixed(4)}; пакет пережил перезапуск`);
  // отмена: пакет закрывается, ничего не записано
  v = await coreR.startBatch(pb.id, { kind: 'file', file: 'app/rules.py', force: true });
  v = await coreR.cancelBatch(pb.id);
  assert.ok(v.batch.canceling);
  cb = await coreR.checkBatch(pb.id);
  assert.equal(cb.state, 'applied');
  assert.equal(cb.result.done, 0);
  assert.equal(cb.view.batch, null);
  step('пакет: отмена');
  // OpenAI: файл JSONL → пакет → файл с ответами; одна пачка с ошибкой
  process.env.MIMIS_BATCH_ANY = '1';
  coreR.updateSettings({ provider: { type: 'openai', baseUrl: `http://127.0.0.1:${llmPort}/v1`, model: 'fake', priceIn: 2, priceOut: 10 }, apiKey: 'sk-test' });
  const ob = await coreR.estimate(pb.id, { kind: 'all', force: true });
  await coreR.startBatch(pb.id, { kind: 'all', force: true });
  assert.equal((await coreR.checkBatch(pb.id)).state, 'waiting');
  cb = await coreR.checkBatch(pb.id);
  assert.equal(cb.state, 'applied');
  assert.ok(cb.result.errors > 0 && cb.result.done === ob.count - cb.result.errors, JSON.stringify(cb.result));
  delete process.env.MIMIS_BATCH_ANY;
  step(`пакет (OpenAI): ${cb.result.done} объяснено, ${cb.result.errors} не получилось — отмечено`);
  // пакет шёл, а разбор переключили на другую ветку: пояснение ждёт свою версию кода
  const s0 = await coreR.sessions.get(pb.id);
  const { checkBatch: cbx, startBatch: sbx } = await import('../core/explain.js');
  coreR.updateSettings({ provider: { type: 'anthropic', baseUrl: `http://127.0.0.1:${llmPort}`, model: 'fake-claude', priceIn: 2, priceOut: 10 }, apiKey: 'test-key' });
  await sbx({ session: s0, settings: coreR.settings, provider: coreR.settings.data.provider, apiKey: 'test-key' }, { kind: 'item', id: 'app/rules.py::classify', force: true });
  const job = s0.meta('batch_job');
  const realHash = job.map.b0.hashes['app/rules.py::classify'];
  job.map.b0.hashes['app/rules.py::classify'] = 'other-version';
  s0.setMeta('batch_job', job);
  const before = s0.view().expl['app/rules.py::classify'].what;
  await cbx({ session: s0, settings: coreR.settings, apiKey: 'test-key' });
  await cbx({ session: s0, settings: coreR.settings, apiKey: 'test-key' });
  assert.equal(s0.view().expl['app/rules.py::classify'].what, before); // текущее не тронуто
  assert.ok(s0.db.exec("SELECT 1 FROM expl_versions WHERE id='app/rules.py::classify' AND hash='other-version'")[0]);
  assert.ok(realHash);
  step('пакет и смена ветки: пояснение сохранено для той версии кода, которую отправляли');
  coreR.deleteSession(pb.id);
  core.sessions.open.delete(pb.id);

  // 5. ручная правка
  v = await core.saveExplanation(back.id, 'app/db.py::Database.transaction', { phrase: 'ф', what: 'Вручную', io: '', example: '', watch: '' });
  assert.equal(v.items.find((i) => i.id === 'app/db.py::Database.transaction').status, 'fresh');
  step('ручная правка пояснения');

  // 6. сценарии: цепочка из кода и рассказ ИИ
  v = await core.view(back.id);
  const groups = entryPoints(v);
  assert.ok(groups.find((g) => g.title === 'Маршруты API').ids.includes('app/api/routes.py::create_order'));
  const sc = buildScenario(v, 'app/api/routes.py::create_order', { depth: 4 });
  assert.equal(sc.steps[0].role, 'request');
  assert.equal(sc.steps[0].label, 'POST /api/orders'); // include_router(router, prefix="/api")
  const roles = sc.steps.filter((x) => x.depth === 1).map((x) => x.role);
  assert.deepEqual(roles.slice(0, 7), ['middleware', 'middleware', 'middleware', 'router', 'validate', 'dependency', 'controller']); // CORS, GZip, timing, роутер, OrderIn, get_db, обработчик
  assert.equal(sc.steps.find((x) => x.label === 'GZipMiddleware').ctx, 'если not DEBUG');
  assert.ok(!sc.route.guess && !sc.route.incomplete); // for r in (router,): app.include_router(r, prefix="/api")
  const order = sc.steps.filter((x) => x.id).map((x) => x.id.split('::')[1]);
  // Depends(get_db) выполняется до обработчика; дальше — шаги обработчика по порядку строк
  assert.ok(order.indexOf('get_db') < order.indexOf('create_order'));
  assert.ok(order.indexOf('OrderService.create') < order.indexOf('Database.insert'));
  assert.ok(sc.steps.some((x) => x.role === 'error' && x.id === 'app/main.py::value_error')); // @app.exception_handler
  assert.ok(sc.steps.find((x) => x.id === 'app/api/routes.py::create_order').role === 'controller');
  assert.ok(order.indexOf('OrderService.create') < order.indexOf('Database.insert'));
  assert.equal(sc.steps.find((x) => x.id === 'app/db.py::Database.insert').ctx, 'with self.repo.transaction():');
  step(`сценарий: ${sc.steps.length} шагов от create_order, порядок как в коде`);
  const se = await core.estimateStory(back.id, 'app/api/routes.py::create_order', 4);
  assert.ok(se.steps === sc.steps.length && se.estCost > 0);
  const sr = await core.runStory(back.id, 'app/api/routes.py::create_order', 4);
  const story = sr.view.stories.find((x) => x.entry === 'app/api/routes.py::create_order');
  assert.equal(story.title, 'Тестовый сценарий');
  assert.equal(Object.keys(story.texts).length, sc.steps.length);
  assert.equal(story.hash, sc.hash);
  step(`рассказ сценария от ИИ: ${Object.keys(story.texts).length} шагов, $${sr.result.cost.toFixed(4)}`);

  // 7. разбор по шагам от ИИ и «что внутри» (поток данных)
  const fl = await core.flow(back.id, 'app/services/orders.py::OrderService.create');
  assert.deepEqual(fl.params.map((p) => p.name), ['customer', 'lines', 'code']);
  assert.ok(fl.vars.find((x) => x.name === 'amount' && /apply_discount/.test(x.from)));
  assert.ok(fl.outputs.some((o) => o.kind === 'return'));
  const we = await core.estimateWalk(back.id, 'app/services/orders.py::OrderService.create');
  assert.ok(we.estCost > 0);
  const wr = await core.runWalk(back.id, 'app/services/orders.py::OrderService.create');
  assert.equal(wr.view.walks['app/services/orders.py::OrderService.create'].steps.length, 2);
  step('«что внутри»: параметры, переменные, выход; разбор по шагам от ИИ');

  // 8. сущности Python: SQLAlchemy, Pydantic, dataclass
  const ents = Object.fromEntries(wr.view.entities.map((e) => [e.id.split('::')[1], e]));
  assert.equal(ents.Customer.orm, 'sqlalchemy');
  assert.equal(ents.Customer.table, 'customers');
  assert.deepEqual(ents.Customer.relations.map((r) => [r.kind, r.to, r.as]), [['hasMany', 'app/tables.py::OrderRow', 'orders']]);
  assert.equal(ents.OrderRow.fields.find((f) => f.name === 'customer_id').ref.id, 'app/tables.py::Customer');
  assert.equal(ents.OrderIn.orm, 'pydantic');
  assert.ok(ents.OrderIn.fields.find((f) => f.name === 'customer').validate.includes('min_length=1'));
  assert.equal(ents.Order.orm, 'dataclass');
  step('сущности Python: SQLAlchemy (таблица, связи, внешний ключ), Pydantic, dataclass');

  // 9. веб-приложения на JS: Express + Sequelize, NestJS + TypeORM, Fastify + Prisma; Flask
  const web = async (name) => core.createSession(path.join(FIX, name));
  const ex = await web('web_express');
  const rt = (sess, m, p) => sess.web.routes.find((r) => r.method === m && r.path === p);
  const post = rt(ex, 'POST', '/api/books');
  assert.deepEqual(post.chain.map((x) => x.role), ['middleware', 'middleware', 'middleware', 'auth', 'router', 'validate', 'handler']);
  assert.equal(post.chain[2].cond, "если process.env.NODE_ENV !== 'production'"); // if (...) app.use(morgan('dev'))
  assert.equal(post.chain[0].label, 'express.json()');
  assert.ok(post.errors.some((x) => x.id === 'src/middlewares/error.middleware.js::errorHandler'));
  assert.ok(rt(ex, 'DELETE', '/api/readers/:id')); // router.route('/readers/:id').get().delete()
  assert.deepEqual(rt(ex, 'GET', '/api/books/:isbn').chain.map((x) => x.role), ['middleware', 'middleware', 'middleware', 'auth', 'router', 'validate', 'handler']); // [checkIsbn]
  const stats = rt(ex, 'GET', '/admin/stats'); // вложенное приложение: с префиксом и общими обработчиками
  assert.ok(stats && !stats.incomplete && stats.chain[0].label === 'express.json()');
  assert.ok(!rt(ex, 'GET', '/stats')); // и не дублируется как отдельное приложение
  const daily = rt(ex, 'GET', '/reports/daily'); // for (const r of [reportRoutes]) app.use('/reports', r)
  assert.ok(daily && !daily.incomplete && /в цикле/.test(daily.chain.find((x) => x.role === 'router').about));
  const v2 = rt(ex, 'GET', '/api/v2/ping'); // registerRoutes(app)
  assert.ok(v2 && !v2.incomplete && v2.errors.some((x) => x.id === 'src/middlewares/error.middleware.js::errorHandler'));
  assert.ok(rt(ex, 'GET', '/health') && !rt(ex, 'GET', '/health').incomplete); // require('./mount.cjs')(app)
  const old = rt(ex, 'GET', '/old'); // список плагинов из чужого пакета — честно помечен
  assert.ok(old.incomplete && /server\.js:\d+/.test(old.reason));
  assert.ok(post.chain.every((x) => x.role !== 'unknown') && rt(ex, 'GET', '/admin/stats').chain.every((x) => x.role !== 'unknown'));
  assert.ok(!post.incomplete && !post.guess);
  const exE = Object.fromEntries(ex.entities.map((e) => [e.id.split('::')[1], e]));
  assert.equal(exE.Book.table, 'books');
  assert.ok(exE.Book.fields.find((f) => f.name === 'isbn').pk);
  const rel = exE.Book.relations[0];
  assert.deepEqual([rel.kind, rel.to, rel.through], ['belongsToMany', 'src/models/reader.model.js::Reader', 'loans']);
  assert.ok(rel.methods.includes('setReaders'));
  assert.ok(ex.sites.some(([a, b, , , , label]) => a === 'src/services/library.service.js::addBook' && b === 'src/models/reader.model.js::Reader' && label === 'book.setReaders'));
  assert.ok(ex.sites.some(([a, b, , , , label]) => a === 'src/repositories/book.repository.js::findBook' && b === 'src/models/book.model.js::Book' && label === 'Book.findByPk'));
  const exF = await core.flow(ex.id, 'src/services/library.service.js::addBook');
  assert.ok(exF.vars.find((x) => x.name === 't' && /sequelize\.transaction/.test(x.from)));
  assert.ok(exF.outputs.some((o) => o.kind === 'throw' && /already exists/.test(o.text)));
  assert.ok(exF.effects.some((e) => e.text === 't.commit'));
  const ctlF = await core.flow(ex.id, 'src/controllers/library.controller.js::getBook');
  assert.ok(ctlF.inputs.some((x) => x.text === 'req.params'));
  assert.ok(ctlF.outputs.some((o) => o.kind === 'response') && ctlF.outputs.some((o) => o.kind === 'next'));
  const exSc = buildScenario(ex, post.id, { depth: 5 });
  assert.equal(exSc.steps[0].label, 'POST /api/books');
  assert.ok(exSc.steps.some((x) => x.role === 'response' && /201/.test(x.about)));
  step(`Express: путь POST /api/books (${post.chain.length} шагов до обработчика), Sequelize-сущности и связи, поток данных`);

  const ne = await web('web_nest');
  const nr = rt(ne, 'GET', '/api/books/:id');
  assert.deepEqual(nr.chain.map((x) => x.role), ['middleware', 'auth', 'auth', 'middleware', 'validate', 'validate', 'handler']);
  assert.equal(nr.chain[0].id, 'src/common/logger.middleware.ts::LoggerMiddleware.use'); // consumer.apply().forRoutes('books')
  assert.equal(nr.chain[1].id, 'src/common/jwt-auth.guard.ts::JwtAuthGuard.canActivate'); // APP_GUARD
  assert.match(nr.chain[1].about, /@Public/);
  assert.equal(nr.chain[2].id, 'src/common/api-key.guard.ts::ApiKeyGuard.canActivate');
  assert.ok(hasEdge(ne, 'src/books/books.controller.ts::BooksController.findOne', 'src/books/books.service.ts::BooksService.findOne')); // constructor(private booksService)
  const neE = Object.fromEntries(ne.entities.map((e) => [e.id.split('::')[1], e]));
  assert.equal(neE.Book.orm, 'typeorm');
  assert.deepEqual(neE.Book.relations.map((r) => [r.kind, r.to]), [['belongsTo', 'src/books/author.entity.ts::Author']]);
  assert.equal(neE.CreateBookDto.orm, 'dto');
  assert.ok(ne.sites.some(([a, b]) => a === 'src/books/books.service.ts::BooksService.findOne' && b === 'src/books/book.entity.ts::Book'));
  step('NestJS: guard → interceptor → pipe → DTO → контроллер → сервис → TypeORM');

  const fa = await web('web_fastify');
  const fr = rt(fa, 'POST', '/v1/notes');
  assert.deepEqual(fr.chain.map((x) => x.role), ['auth', 'router', 'middleware', 'validate', 'handler']); // verifyUser из auth.js
  const faE = Object.fromEntries(fa.entities.map((e) => [e.id.split('::')[1], e]));
  assert.equal(faE.Note.orm, 'prisma');
  assert.equal(faE.Note.table, 'notes');
  assert.deepEqual(faE.User.relations.map((r) => r.kind), ['hasMany']);
  assert.ok(fa.sites.some(([a, b, , , , label]) => b === 'prisma/schema.prisma::Note' && label === 'prisma.note.create'));
  step('Fastify + Prisma: хук onRequest, плагин с префиксом, preHandler, схема; модели из schema.prisma');

  const fl2 = await web('web_flask');
  const flr = rt(fl2, 'GET', '/shop/items');
  assert.deepEqual(flr.chain.map((x) => x.role), ['router', 'middleware', 'auth', 'handler']);
  assert.ok(flr.errors.some((x) => x.label === '404'));
  step('Flask: blueprint с префиксом, before_request, login_required, errorhandler');

  // с чего начинается программа
  const at = (v) => v.entries.map((e) => `${e.kind} ${e.file}:${e.line}${e.fn ? ` ${e.fn.split('::')[1]}` : ''}`);
  const frontV = await core.view(front.id);
  assert.deepEqual(at(frontV).sort(), ['server server/index.js:15', 'ui src/main.jsx:6']); // интерфейс и сервер — две программы
  assert.deepEqual(at(await core.view(back.id)), ['app app/main.py:10']);
  assert.equal(at(ne)[0], 'server src/main.ts:7 bootstrap');
  assert.equal(at(ex)[0], 'server src/server.js:29');
  assert.equal(at(fl2)[0], 'app app/__init__.py:11 create_app');
  assert.ok(frontV.files.every((f) => f.path !== 'package.json')); // настройки проекта читаются, но в файлы проекта не попадают
  // команда из package.json и строка в кавычках, которая лишь похожа на запуск
  const mf = path.join(tmp, 'manifest_app');
  fs.mkdirSync(path.join(mf, 'src/cli'), { recursive: true });
  fs.writeFileSync(path.join(mf, 'package.json'), JSON.stringify({ name: 'm', scripts: { start: 'node src/cli/run.js' } }));
  fs.writeFileSync(path.join(mf, 'src/cli/run.js'), "import { go } from '../lib.js';\nexport function main() { go(); }\nmain();\n");
  fs.writeFileSync(path.join(mf, 'src/lib.js'), "export function go() { return 'app.listen(3000) в строке — не запуск'; }\n");
  const mv = await core.createSession(mf);
  assert.deepEqual(mv.entries.map((e) => [e.file, e.cmd]), [['src/cli/run.js', 'npm run start → node src/cli/run.js']]);
  core.deleteSession(mv.id);
  step('с чего начинается программа: app.listen, FastAPI(), NestFactory, create_app, createRoot, команда из package.json');

  // 10. обновление: изменённая, новая и удалённая функции
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

  // учебные проекты для тестов (tests/fixtures) — не часть разбираемого проекта
  const fx = path.join(tmp, 'with_fixtures');
  fs.mkdirSync(path.join(fx, 'tests/fixtures/shop'), { recursive: true });
  fs.mkdirSync(path.join(fx, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'src/main.js'), 'export function run() { return 1; }\n');
  fs.writeFileSync(path.join(fx, 'tests/main.test.js'), "import { run } from '../src/main.js';\nexport function testRun() { return run(); }\n");
  fs.writeFileSync(path.join(fx, 'tests/fixtures/shop/book.js'), "export class Book { constructor() { this.title = ''; } }\n");
  const sfx = await core.createSession(fx);
  assert.deepEqual(sfx.files.map((f) => f.path).sort(), ['src/main.js', 'tests/main.test.js']);
  core.deleteSession(sfx.id);
  step('папки fixtures/testdata (учебные проекты для тестов) не разбираются');

  // 11. сессии переживают перезапуск
  const core2 = new MimisCore(path.join(tmp, 'data'));
  const list = await core2.listSessions();
  assert.equal(list.length, 7);
  const again = await core2.view(front.id);
  assert.equal(again.counts.fresh, again.counts.total);
  step(`перезапуск: ${list.length} сессии прочитаны с диска, пояснения на месте`);

  core2.deleteSession(s2.id);
  assert.equal((await core2.listSessions()).length, 6);
  step('удаление сессии');
  console.log(`Все проверки пройдены (${ok}). Запросов к модели: ${calls}.`);
} finally {
  gh.close(); llm.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
