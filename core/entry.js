// С чего начинается программа: точка запуска. Без запуска кода — по тому, что
// написано в файлах: команда в package.json / pyproject.toml / Procfile / Dockerfile,
// и строки, которые запускают программу (app.listen, uvicorn.run, createRoot(...).render,
// if __name__ == "__main__" и т. п.).

const isTest = (f) => /(^|\/)(tests?|__tests__|spec|e2e)\//.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f) || /(^|\/)(test_[^/]*|conftest)\.py$/.test(f);
const base = (f) => f.split('/').pop();
const dir = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '');
const norm = (p) => {
  const out = [];
  for (const s of p.replace(/\\/g, '/').split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
};

// что в коде запускает программу; kind — для заголовка
const CODE_RULES = [
  // серверы
  { lang: 'js', re: /\bNestFactory\.create(?:Microservice)?\s*\(/, kind: 'server', score: 6, why: 'NestFactory.create(...) — здесь создаётся приложение NestJS' },
  { lang: 'js', re: /\b(\w+)\.listen\s*\(\s*(?:\{[^}]*port\s*:\s*([\w.|' ]+)|([\w.|' ]+))?/, kind: 'server', score: 5, why: (m) => `${m[1]}.listen(${(m[2] || m[3] || '').trim()}) — сервер начинает принимать запросы${/^\d+$/.test((m[2] || m[3] || '').trim()) ? ` на порту ${(m[2] || m[3]).trim()}` : ''}`, skip: (m) => /^(emitter|socket|ws|events?|this|el|element|stream)$/i.test(m[1]) },
  { lang: 'js', re: /\bcreateServer\s*\(/, kind: 'server', score: 4, why: 'createServer(...) — создаётся веб-сервер' },
  { lang: 'py', re: /\buvicorn\.run\s*\(\s*["']?([\w.:]+)?/, kind: 'server', score: 6, why: (m) => `uvicorn.run(${m[1] || '...'}) — запускается веб-сервер` },
  { lang: 'py', re: /^\s*(\w+)\.run\s*\((?:.*(?:host|port|debug)\s*=)/, kind: 'server', score: 5, why: (m) => `${m[1]}.run(...) — запускается сервер Flask` },
  { lang: 'py', re: /\bweb\.run_app\s*\(/, kind: 'server', score: 5, why: 'web.run_app(...) — запускается сервер aiohttp' },
  { lang: 'py', re: /^\s*(\w+)\s*=\s*FastAPI\s*\(/, kind: 'app', score: 4, why: (m) => `${m[1]} = FastAPI() — здесь создаётся приложение FastAPI; запускают его командой вида «uvicorn ${'{файл}'}:${m[1]}»` },
  { lang: 'py', re: /^\s*(\w+)\s*=\s*Flask\s*\(/, kind: 'app', score: 3, why: (m) => `${m[1]} = Flask(__name__) — здесь создаётся приложение Flask` },
  { lang: 'py', re: /execute_from_command_line\s*\(/, kind: 'cli', score: 5, why: 'execute_from_command_line — стандартный запуск Django (manage.py)' },
  // интерфейс
  { lang: 'js', re: /\bcreateRoot\s*\([^)]*\)\s*\.render\s*\(|\bcreateRoot\s*\(/, kind: 'ui', score: 5, why: 'createRoot(...).render(...) — React рисует приложение на странице' },
  { lang: 'js', re: /\bReactDOM\.render\s*\(|\bhydrateRoot\s*\(/, kind: 'ui', score: 5, why: 'ReactDOM.render(...) — React рисует приложение на странице' },
  { lang: 'js', re: /\bcreateApp\s*\([^)]*\)[\s\S]{0,80}?\.mount\s*\(|\bnew Vue\s*\(/, kind: 'ui', score: 5, why: 'createApp(...).mount(...) — Vue рисует приложение на странице' },
  { lang: 'js', re: /\bbootstrapApplication\s*\(|platformBrowserDynamic\s*\(\s*\)\s*\.bootstrapModule/, kind: 'ui', score: 5, why: 'bootstrapApplication(...) — запуск приложения Angular' },
  { lang: 'js', re: /\bnew BrowserWindow\s*\(/, kind: 'desktop', score: 4, why: 'new BrowserWindow(...) — Electron открывает окно приложения' },
  // скрипты
  { lang: 'py', re: /^if\s+__name__\s*==\s*["']__main__["']\s*:/, kind: 'script', score: 4, why: 'if __name__ == "__main__": — этот блок выполняется, когда файл запускают напрямую (python файл.py)' },
  { lang: 'js', re: /\brequire\.main\s*===\s*module\b/, kind: 'script', score: 4, why: 'require.main === module — этот блок выполняется, когда файл запускают напрямую (node файл.js)' },
];

const KIND_RU = {
  server: 'Запуск веб-сервера', app: 'Создание веб-приложения', ui: 'Запуск интерфейса (страницы в браузере)', desktop: 'Запуск программы для компьютера',
  script: 'Запуск как программы', cli: 'Запуск из командной строки', manifest: 'Точка входа из настроек проекта',
};

/** Команды запуска из package.json, pyproject.toml, Procfile, Dockerfile → какие файлы они запускают. */
function manifestHints(sources, has) {
  const hints = []; // { file, cmd, why, score }
  const resolveJs = (from, p) => {
    if (!p) return null;
    const cand = norm(dir(from) + p);
    for (const c of [cand, `${cand}.js`, `${cand}.ts`, `${cand}.mjs`, `${cand}.cjs`, `${cand}/index.js`, `${cand}/index.ts`, cand.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'), cand.replace(/^(dist|build|out)\//, 'src/')]) if (has(c)) return c;
    return null;
  };
  for (const { path: f, text } of sources) {
    const b = base(f);
    if (b === 'package.json') {
      let j; try { j = JSON.parse(text); } catch { continue; }
      const add = (p, cmd, why, score) => { const r = resolveJs(f, p); if (r) hints.push({ file: r, cmd, why, score }); };
      for (const k of ['start', 'dev', 'serve', 'start:dev']) {
        const s = j.scripts?.[k];
        if (!s) continue;
        const m = s.match(/(?:node|nodemon|ts-node|tsx|ts-node-dev|electron|bun|deno run)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./@-]+\.(?:m?[jt]s|cjs)|[\w./-]+)/);
        if (m && m[1] !== '.') add(m[1], `npm run ${k} → ${s}`, `в package.json команда «${k}» запускает этот файл`, 3);
        if (/\bnest start\b/.test(s)) add('src/main.ts', `npm run ${k} → ${s}`, 'NestJS по команде «nest start» запускает src/main.ts', 3);
        if (/\b(vite|react-scripts|next|nuxt|ng serve)\b/.test(s)) hints.push({ cmd: `npm run ${k} → ${s}`, frontend: /\bvite\b/.test(s) ? 'vite' : /react-scripts/.test(s) ? 'cra' : 'other', from: f, score: 2 });
      }
      if (j.main) add(j.main, `package.json → "main": "${j.main}"`, 'в package.json это главный файл пакета', 2);
      const bins = typeof j.bin === 'string' ? [j.bin] : Object.values(j.bin || {});
      for (const p of bins) add(p, `package.json → "bin": "${p}"`, 'в package.json это команда для терминала', 3);
    }
    if (b === 'pyproject.toml' || b === 'setup.cfg') {
      const sec = text.match(/\[(?:project\.scripts|tool\.poetry\.scripts|options\.entry_points)\]([\s\S]*?)(?:\n\[|$)/);
      for (const m of (sec?.[1] || '').matchAll(/^\s*([\w-]+)\s*=\s*["']?([\w.]+):(\w+)/gm)) {
        const mod = m[2].replace(/\./g, '/');
        const file = [`${mod}.py`, `${mod}/__init__.py`, `src/${mod}.py`, `src/${mod}/__init__.py`].find(has);
        if (file) hints.push({ file, fn: m[3], cmd: `${m[1]} → ${m[2]}:${m[3]}`, why: `в ${b} команда «${m[1]}» запускает функцию ${m[3]}`, score: 3 });
      }
    }
    if (b === 'Procfile' || b === 'Dockerfile') {
      for (const line of text.split('\n')) {
        const l = b === 'Procfile' ? line.replace(/^\w+:\s*/, '') : (line.match(/^\s*(?:CMD|ENTRYPOINT)\s+(.+)/)?.[1] || '');
        if (!l) continue;
        const cmd = l.replace(/[[\]",]/g, ' ').replace(/\s+/g, ' ').trim();
        const uv = cmd.match(/\b(?:uvicorn|gunicorn|hypercorn)\b.*?\s([\w.]+):(\w+)/);
        if (uv) {
          const mod = uv[1].replace(/\./g, '/');
          const file = [`${mod}.py`, `${mod}/__init__.py`, `src/${mod}.py`].find(has);
          if (file) hints.push({ file, cmd: `${b}: ${cmd}`, why: `в ${b} сервер запускается из этого файла (${uv[1]}:${uv[2]})`, score: 4 });
        }
        const node = cmd.match(/\b(?:node|python3?)\s+([\w./-]+\.(?:m?js|cjs|ts|py))/);
        if (node) { const file = norm(node[1]); if (has(file)) hints.push({ file, cmd: `${b}: ${cmd}`, why: `в ${b} запускается этот файл`, score: 4 }); }
      }
    }
    if (b === 'index.html') {
      const m = text.match(/<script[^>]+type=["']module["'][^>]+src=["']\/?([^"']+)["']/);
      if (m) { const file = norm(dir(f) + m[1]); if (has(file)) hints.push({ file, cmd: `${f} → <script src="${m[1]}">`, why: 'страница index.html загружает этот файл первым', score: 3 }); }
    }
  }
  return hints;
}

/**
 * Точки запуска, лучшая — первой.
 * @returns [{ file, line, kind, title, why, cmd, fn, score }]
 */
export function findEntries(sources, items) {
  const codeFiles = new Set(sources.filter((s) => /\.(py|m?[jt]sx?|cjs)$/.test(s.path)).map((s) => s.path));
  const has = (f) => codeFiles.has(f);
  const byFile = {};
  for (const it of items) (byFile[it.file] ||= []).push(it);
  const fnAt = (file, line) => {
    let best = null;
    for (const it of byFile[file] || []) if (it.kind !== 'class' && it.kind !== 'entity' && it.line <= line && it.end >= line && (!best || it.end - it.line < best.end - best.line)) best = it;
    return best;
  };
  const found = {}; // file → запись
  const put = (e) => {
    const cur = found[e.file];
    if (!cur) { found[e.file] = e; return; }
    cur.score += e.score >= cur.score ? Math.min(e.score, 3) : 1;
    if (e.cmd && !cur.cmd) cur.cmd = e.cmd;
    if (e.reasons) cur.reasons.push(...e.reasons);
    if (KIND_RANK[e.kind] > KIND_RANK[cur.kind]) { cur.kind = e.kind; cur.line = e.line; cur.fn = e.fn; cur.why = e.why; }
  };
  for (const { path: f, text } of sources) {
    if (!has(f) || isTest(f)) continue;
    const lang = f.endsWith('.py') ? 'py' : 'js';
    const lines = text.split('\n');
    for (const r of CODE_RULES) {
      if (r.lang !== lang) continue;
      for (let i = 0; i < lines.length; i++) {
        // текст в кавычках не считаем: там бывают имена функций, а не их вызов
        const src = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
        const m = src.match(r.re);
        if (!m || r.skip?.(m)) continue;
        // строки внутри комментариев не считаем
        if (/^\s*(\/\/|#|\*)/.test(lines[i])) continue;
        const line = i + 1;
        const why = typeof r.why === 'function' ? r.why(m).replace('{файл}', f.replace(/\.py$/, '').replace(/\//g, '.')) : r.why;
        const fn = fnAt(f, line);
        // глубоко вложенные и служебные файлы — ниже
        const depth = f.split('/').length - 1;
        const named = /^(main|index|app|server|manage|wsgi|asgi|run|cli|__main__|bootstrap)\.\w+$/.test(base(f)) ? 1 : 0;
        put({ file: f, line, kind: r.kind, why, fn: fn?.id || null, score: r.score + named - Math.max(0, depth - 2) * 0.5, cmd: '', reasons: [why] });
        break;
      }
    }
  }
  const hints = manifestHints(sources, has);
  for (const h of hints) {
    if (!h.file) continue;
    let fn = null, line = 1;
    const it = (byFile[h.file] || []).find((x) => (h.fn ? x.name === h.fn : /^(main|run|start|bootstrap|cli)$/.test(x.name)));
    if (it) { fn = it.id; line = it.line; }
    put({ file: h.file, line, kind: 'manifest', why: h.why, fn, score: h.score, cmd: h.cmd, reasons: [h.why] });
  }
  // фронтенд без index.html (Vite/CRA): src/main.* или src/index.*
  for (const h of hints.filter((x) => x.frontend)) {
    const root = dir(h.from);
    const f = [`${root}src/main.tsx`, `${root}src/main.jsx`, `${root}src/main.ts`, `${root}src/main.js`, `${root}src/index.tsx`, `${root}src/index.jsx`, `${root}src/index.js`].find(has);
    if (f) put({ file: f, line: found[f]?.line || 1, kind: 'manifest', why: `команда «${h.cmd.split(' → ')[1]}» собирает интерфейс начиная с этого файла`, fn: null, score: 2, cmd: h.cmd, reasons: [] });
  }
  // Electron: сначала запускается главный процесс, он уже открывает окно со страницей
  for (const e of Object.values(found)) if (e.kind === 'desktop') e.score += 4;
  const textOf = Object.fromEntries(sources.map((x) => [x.path, x.text]));
  const list = Object.values(found).map((e) => ({ ...e, title: KIND_RU[e.kind] || 'Точка входа', reasons: [...new Set(e.reasons)].slice(0, 4), outline: outlineOf(e.file, textOf[e.file] || '', byFile[e.file] || []) }));
  list.sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  // слабые кандидаты, когда есть сильные, не показываем
  const top = list[0]?.score || 0;
  return list.filter((e) => e.score >= Math.min(4, top - 3)).slice(0, 6);
}
/**
 * Порядок выполнения файла запуска: что делается на верхнем уровне, сверху вниз.
 * Не разбор языка, а чтение по строкам: верхний уровень — строки без отступа.
 * @returns [{ from, to, text, code }]
 */
export function outlineOf(file, text, items) {
  const py = file.endsWith('.py');
  const lines = text.split('\n');
  const blocks = [];
  let inDoc = false;
  let deco = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // строки документации Python (""" … """) — не код
    if (py) {
      const q = (l.match(/"""|'''/g) || []).length;
      if (inDoc) { if (q % 2) inDoc = false; continue; }
      if (/^\s*[rRuU]?("""|''')/.test(l)) { if (q % 2) inDoc = true; continue; }
      if (/^@/.test(l)) { deco = l.trim(); continue; }
    }
    if (!l.trim() || /^\s/.test(l) || /^(\/\/|#|\/\*|\*|[}\])])/.test(l.trim()) || (py && /^(@|""\"|''')/.test(l))) {
      if (blocks.length && /^\s/.test(l) && l.trim()) blocks[blocks.length - 1].to = i + 1;
      else if (blocks.length && /^[}\])]/.test(l.trim())) blocks[blocks.length - 1].to = i + 1;
      continue;
    }
    blocks.push({ from: i + 1, to: i + 1, first: l.trim(), deco, body: '' });
    deco = '';
  }
  for (const b of blocks) b.body = lines.slice(b.from - 1, b.to).join('\n');
  const fnName = (b) => (b.first.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)|^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/) || []).slice(1).find(Boolean);
  const out = [];
  let imp = null;
  const flushImp = () => { if (imp) { out.push({ from: imp.from, to: imp.to, text: `подключаются модули и файлы проекта (${imp.n})`, code: '' }); imp = null; } };
  const routes = [];
  for (const b of blocks) {
    const f = b.first;
    if (/^(import\b|from\s+\S+\s+import\b|(?:const|let|var)\s+[\w{}\s,]+=\s*require\()/.test(f)) { imp = imp ? { ...imp, to: b.to, n: imp.n + 1 } : { from: b.from, to: b.to, n: 1 }; continue; }
    flushImp();
    const name = fnName(b);
    const route = b.deco.match(/^@\w+\.(get|post|put|patch|delete|route|websocket)\s*\(\s*[rf]?["']([^"']*)/i);
    if (name && route) { out.push({ from: b.from, to: b.to, text: `объявляется маршрут ${route[1].toUpperCase()} ${route[2]} → функция ${name} (выполнится, когда придёт такой запрос)`, code: '' }); continue; }
    if (name && /\.middleware\s*\(/.test(b.deco)) { out.push({ from: b.from, to: b.to, text: `объявляется промежуточный обработчик ${name} — будет срабатывать на каждый запрос`, code: '', decl: name }); continue; }
    if (name && /\.(exception_handler|errorhandler)\s*\(/.test(b.deco)) { out.push({ from: b.from, to: b.to, text: `объявляется обработчик ошибок ${name} — сработает, если при запросе случится ${(b.deco.match(/\(\s*(\w+)/) || [])[1] || 'ошибка'}`, code: '', decl: name }); continue; }
    if (name && b.deco) { out.push({ from: b.from, to: b.to, text: `объявляется функция ${name} с декоратором ${b.deco.slice(0, 50)} — выполнится, когда её вызовут`, code: '' }); continue; }
    if (name) { out.push({ from: b.from, to: b.to, text: `объявляется ${/^(export\s+)?class|^class/.test(f) ? 'класс' : 'функция'} ${name} — пока только описание, выполнится, когда её вызовут`, code: '', decl: name }); continue; }
    let m;
    if ((m = f.match(/^(?:const|let|var)?\s*(\w+)\s*=\s*(express|fastify|Fastify|Koa|new Koa|FastAPI|Flask|Sanic|web\.Application|NestFactory\.create)\b/))) { out.push({ from: b.from, to: b.to, text: `создаётся приложение ${m[1]} (${m[2].replace('new ', '')})`, code: f }); continue; }
    if ((m = f.match(/^(\w+)\.(?:use|register|include_router|register_blueprint|mount)\s*\((.*)/))) {
      const mount = routeMount(m[2]);
      if (mount) { routes.push({ from: b.from, to: b.to, text: mount }); continue; }
      out.push({ from: b.from, to: b.to, text: `подключается промежуточный обработчик: ${argsOf(m[2]).slice(0, 60)}`, code: f });
      continue;
    }
    if (/^\w+\.add_middleware\s*\(/.test(f)) { out.push({ from: b.from, to: b.to, text: `подключается промежуточный обработчик: ${(b.body.match(/add_middleware\(\s*(\w+)/) || [])[1] || '…'}`, code: f }); continue; }
    if (/^if\s+__name__\s*==/.test(f)) { out.push({ from: b.from, to: b.to, text: 'блок «если файл запустили напрямую» — выполняется только при запуске этого файла', code: f }); continue; }
    if ((m = f.match(/^(if|for|while)\b\s*(.*)$/))) {
      const loop = m[1] !== 'if';
      // условие: в скобках (JS) или до двоеточия (Python); остальное — что выполняется
      let cond, rest;
      if (m[2].startsWith('(')) { const e = parenEnd(m[2], 0); cond = m[2].slice(1, e); rest = m[2].slice(e + 1); } else { const c = m[2].lastIndexOf(':'); cond = c > 0 ? m[2].slice(0, c) : m[2]; rest = ''; }
      rest = rest.replace(/^\s*\{?\s*/, '').replace(/\s*\}?\s*$/, '').trim() || (b.body.split('\n').slice(1).map((x) => x.trim()).find((x) => x && x !== '}') || '');
      const inner = rest.match(/^(\w+)\.(?:use|register|include_router|register_blueprint|mount)\s*\((.*)/);
      const what = inner ? (routeMount(inner[2]) || `подключается промежуточный обработчик: ${argsOf(inner[2]).slice(0, 50)}`) : rest.replace(/;$/, '').slice(0, 60);
      const head = loop ? `в цикле по ${cond.replace(/^(const|let|var)\s+/, '').slice(0, 50)}` : `только если ${cond.slice(0, 50)}`;
      out.push({ from: b.from, to: b.to, text: `${head}: ${what}`, code: f, route: Boolean(inner && routeMount(inner[2])) });
      continue;
    }
    if ((m = f.match(/^(?:await\s+)?(\w+)\.listen\s*\(|^uvicorn\.run\s*\(|^(\w+)\.run\s*\(/))) { out.push({ from: b.from, to: b.to, text: 'запускается сервер — дальше программа ждёт запросов', code: f }); continue; }
    if ((m = f.match(/^(?:await\s+)?(\w+(?:\.\w+)*)\s*\(/))) {
      const target = m[1];
      const decl = out.find((o) => o.decl === target);
      out.push({ from: b.from, to: b.to, text: decl ? `вызывается ${target}() — вот теперь выполняется то, что объявлено в строке ${decl.from}` : `вызывается ${target}(…)`, code: f, call: target });
      continue;
    }
    out.push({ from: b.from, to: b.to, text: f.replace(/;$/, '').slice(0, 80), code: f });
  }
  flushImp();
  // маршруты — каждый на своём месте; подряд идущие — одним шагом
  for (const r of routes) out.push({ from: r.from, to: r.to, text: r.text, code: '', route: true });
  out.sort((x, y) => x.from - y.from);
  const merged = [];
  for (const o of out) {
    const last = merged[merged.length - 1];
    if (last && last.route && o.route && !/^(в цикле|только если)/.test(o.text) && !/^(в цикле|только если)/.test(last.text) && o.from <= last.to + 2) { last.to = o.to; last.text += `, ${o.text.replace(/^подключаются маршруты:?\s*/, '')}`; } else merged.push({ ...o });
  }
  out.length = 0; out.push(...merged);
  void items;
  return out.slice(0, 16);
}

function parenEnd(str, start) {
  let d = 0;
  for (let i = start; i < str.length; i++) { if (str[i] === '(') d += 1; else if (str[i] === ')') { d -= 1; if (!d) return i; } }
  return str.length;
}
/** Аргументы вызова без закрывающей скобки: «express.json()», «'/api', auth, routes». */
function argsOf(rest) { const e = parenEnd(`(${rest}`, 0); return `(${rest}`.slice(1, e).trim(); }
/** «'/api', requireToken, libraryRoutes» → «подключаются маршруты libraryRoutes под /api». Не маршруты — null. */
function routeMount(rest) {
  const args = argsOf(rest);
  const path = args.match(/^\s*["'`](\/[^"'`]*)["'`]/)?.[1];
  const names = args.replace(/^\s*["'`][^"'`]*["'`]\s*,?/, '').split(',').map((x) => x.trim()).filter((x) => /^[\w.]+$/.test(x));
  const last = names[names.length - 1] || '';
  const prefix = rest.match(/prefix\s*=\s*["']([^"']+)/)?.[1];
  if (!path && !prefix && !/(route|router|blueprint|bp|api|controller)/i.test(last)) return null;
  const extra = names.length > 1 ? ` (перед ними: ${names.slice(0, -1).join(', ')})` : '';
  return `подключаются маршруты ${last || '…'}${path || prefix ? ` под ${path || prefix}` : ''}${extra}`;
}

const KIND_RANK = { manifest: 0, app: 1, script: 2, cli: 2, desktop: 3, ui: 3, server: 4 };
