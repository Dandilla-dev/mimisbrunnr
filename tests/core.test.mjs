// Проверка ядра без Electron, сети и настоящего ИИ:
// поддельный GitHub (zip-архив) и поддельная модель (форматы Anthropic и OpenAI).
// Запуск: npm test  (MIMIS_TEST_BACK / MIMIS_TEST_FRONT — пути к репозиториям)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { MimisCore } from '../core/core.js';

const BACK = process.env.MIMIS_TEST_BACK || '/tmp/mimir_back';
const FRONT = process.env.MIMIS_TEST_FRONT || '/tmp/mimir';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimis-test-'));
let ok = 0;
const step = (m) => { ok += 1; console.log(`  ✓ ${m}`); };

// ---- поддельный GitHub ----
const zipFile = path.join(tmp, 'front.zip');
execFileSync('git', ['-C', FRONT, 'archive', '--format=zip', '--prefix=mimir-abc123/', '-o', zipFile, 'HEAD']);
const gh = http.createServer((req, res) => {
  if (req.url === '/repos/Dandilla-dev/mimir') return res.end(JSON.stringify({ default_branch: 'master' }));
  if (req.url.startsWith('/repos/Dandilla-dev/mimir/commits/')) return res.end(JSON.stringify({ sha: 'abc1234567890', commit: { message: 'Тестовый коммит\n\nтело', committer: { date: '2026-11-18T10:00:00Z' } } }));
  if (req.url.startsWith('/Dandilla-dev/mimir/zip/')) return res.end(fs.readFileSync(zipFile));
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

  // 1. локальная папка, Python
  const back = await core.createSession(BACK);
  assert.ok(back.items.length > 400, `функций ${back.items.length}`);
  assert.ok(back.edges.length > 600, `связей ${back.edges.length}`);
  assert.ok(back.items.find((i) => i.id === 'core/dlp_heuristics.py::classify'));
  assert.equal(back.counts.none, back.counts.total);
  step(`папка (Python): ${back.files.length} файлов, ${back.items.length} функций, ${back.edges.length} связей, слои: ${back.layers.map((l) => l.name).join(', ')}`);

  // 2. GitHub через zip, JS/React
  const front = await core.createSession('https://github.com/Dandilla-dev/mimir');
  assert.equal(front.commit.short, 'abc1234');
  assert.ok(front.items.some((i) => i.kind === 'component'));
  step(`GitHub (JS/React): ${front.files.length} файлов, ${front.items.length} позиций, коммит ${front.commit.short} «${front.commit.subject}»`);
  const code = await core.code(front.id, 'src/App.jsx');
  assert.ok(code.includes('export default function App'));
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
  r = await (await core.startExplain(back.id, { kind: 'item', id: 'core/dlp_heuristics.py::classify' })).promise;
  v = await core.view(back.id);
  assert.equal(v.expl['core/dlp_heuristics.py::classify'].what, 'Что делает classify.');
  step('формат Anthropic: пояснение одной функции');
  const t = await core.testConnection();
  assert.equal(t.reply, 'Готов');
  step('проверка подключения к модели');

  // 5. ручная правка
  v = await core.saveExplanation(back.id, 'core/db.py::transaction', { phrase: 'ф', what: 'Вручную', io: '', example: '', watch: '' });
  assert.equal(v.items.find((i) => i.id === 'core/db.py::transaction').status, 'fresh');
  step('ручная правка пояснения');

  // 6. обновление: изменённая, новая и удалённая функции
  const copy = path.join(tmp, 'back-copy');
  fs.cpSync(BACK, copy, { recursive: true, filter: (p) => !p.includes(`${path.sep}.git`) });
  const s2 = await core.createSession(copy);
  await (await core.startExplain(s2.id, { kind: 'file', file: 'core/dlp_heuristics.py' })).promise;
  const f = path.join(copy, 'core/dlp_heuristics.py');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('if threat_reasons:\n        level = ThreatLevel.THREAT', 'if threat_reasons and event:\n        level = ThreatLevel.THREAT')
    .replace('def _rule_domain_watchlisted(', 'def _rule_watchlisted_domain(') + '\n\ndef new_helper(x):\n    return x\n');
  v = await core.updateSession(s2.id);
  const st = (id) => v.items.find((i) => i.id === id)?.status;
  assert.equal(st('core/dlp_heuristics.py::classify'), 'stale');
  assert.equal(st('core/dlp_heuristics.py::new_helper'), 'none');
  assert.equal(st('core/dlp_heuristics.py::_rule_executable_content'), 'fresh');
  assert.ok(v.orphans.includes('core/dlp_heuristics.py::_rule_domain_watchlisted'));
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
