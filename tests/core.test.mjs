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
  step('Python: тип из результата функции, связи «передаётся», места вызовов с условиями');
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
  step('JS/TS: тип из результата функции, действия createSlice, обработчик в JSX — «передаётся»');
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

  // 6. сценарии: цепочка из кода и рассказ ИИ
  v = await core.view(back.id);
  const groups = entryPoints(v);
  assert.ok(groups.find((g) => g.title === 'Маршруты API').ids.includes('app/api/routes.py::create_order'));
  const sc = buildScenario(v, 'app/api/routes.py::create_order', { depth: 4 });
  assert.equal(sc.steps[0].role, 'request');
  assert.equal(sc.steps[0].label, 'POST /api/orders'); // include_router(router, prefix="/api")
  const roles = sc.steps.filter((x) => x.depth === 1).map((x) => x.role);
  assert.deepEqual(roles.slice(0, 6), ['middleware', 'middleware', 'router', 'validate', 'dependency', 'controller']); // CORS, timing, роутер, OrderIn, get_db, обработчик
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
  assert.deepEqual(post.chain.map((x) => x.role), ['middleware', 'middleware', 'auth', 'router', 'validate', 'handler']);
  assert.equal(post.chain[0].label, 'express.json()');
  assert.ok(post.errors.some((x) => x.id === 'src/middlewares/error.middleware.js::errorHandler'));
  assert.ok(rt(ex, 'DELETE', '/api/readers/:id')); // router.route('/readers/:id').get().delete()
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
  assert.deepEqual(nr.chain.map((x) => x.role), ['auth', 'middleware', 'validate', 'validate', 'handler']);
  assert.equal(nr.chain[0].id, 'src/common/api-key.guard.ts::ApiKeyGuard.canActivate');
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
