// Путь запроса в веб-приложениях на JS/TS: Express, Fastify, NestJS.
// Из фактов разбора (app.use, router.get, register, декораторы Nest) собирает для
// каждого маршрута цепочку: промежуточные обработчики → проверки → обработчик →
// обработчики ошибок. Код не запускается: порядок берётся из порядка в файлах.

// методы ORM, которые возвращают объект сущности (Book.create → book)
export const ORM_INSTANCE = new Set(['create', 'build', 'findByPk', 'findOne', 'findAll', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate', 'findOrCreate', 'save', 'insert', 'findOneBy', 'find', 'findBy']);

export const AUTH_RE = /auth|jwt|token|passport|guard|login|logged|session|permission|role|acl|protect|isAdmin|requireUser|current_?user/i;
export const VALID_RE = /valid|schema|joi|zod|celebrate|sanitiz|checkSchema|express-validator|\bbody\(|\bparam\(|\bquery\(|dto|pipe/i;

// известные middleware из npm — подпись по-русски
const KNOWN = [
  [/^express\.json\b|^bodyParser\.json\b/, 'разбирает JSON из тела запроса в req.body'],
  [/^express\.urlencoded\b|^bodyParser\.urlencoded\b/, 'разбирает данные формы в req.body'],
  [/^express\.static\b/, 'отдаёт файлы из папки (картинки, стили, страницы)'],
  [/^cors\b/, 'разрешает запросы с других сайтов (CORS)'],
  [/^helmet\b/, 'добавляет заголовки безопасности'],
  [/^morgan\b/, 'пишет каждый запрос в журнал'],
  [/^cookieParser\b|^cookie-parser\b/, 'разбирает cookie в req.cookies'],
  [/^compression\b/, 'сжимает ответ'],
  [/^rateLimit\b|^limiter\b/, 'ограничивает число запросов'],
  [/^passport\.authenticate\b/, 'проверяет, кто делает запрос (passport)'],
  [/^passport\.initialize\b/, 'подключает passport'],
  [/^session\b|^expressSession\b/, 'хранит сессию пользователя'],
  [/^multer\b|upload\.(single|array|fields)\b/, 'принимает загружаемые файлы'],
  [/^ValidationPipe\b|new ValidationPipe\b/, 'проверяет тело запроса по DTO (class-validator)'],
  [/^ParseIntPipe\b/, 'превращает параметр в число и проверяет его'],
];
const known = (text) => KNOWN.find(([re]) => re.test(text))?.[1] || '';

const joinPath = (...ps) => {
  const p = ps.filter((x) => x !== null && x !== undefined && x !== '').join('/').replace(/\/{2,}/g, '/');
  return (`/${p}`).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') || '/';
};

export function jsWeb(jsFiles, R, sites) {
  const routes = [];
  const roles = {};
  const containers = {}; // ключ → { file, mounts: [] }
  const keyOf = (file, m) => (m.objIsParam && m.container ? `fn:${m.container}` : `var:${file}:${m.obj}`);
  for (const [file, facts] of Object.entries(jsFiles)) {
    for (const m of facts.web?.mounts || []) (containers[keyOf(file, m)] ||= { file, mounts: [] }).mounts.push(m);
  }
  for (const c of Object.values(containers)) c.mounts.sort((a, b) => a.line - b.line);
  const varInfo = (file, name) => jsFiles[file]?.web?.vars?.[name] || null;
  // router.get('/', [auth, validate], handler) — список раскрываем в отдельные шаги
  const flat = (hs) => hs.flatMap((h) => (h?.t === 'array' ? h.items : [h]));

  // имя обработчика → что это: роутер, плагин, функция проекта или внешний middleware
  function resolveRef(file, h) {
    if (!h) return null;
    if (h.t === 'inline') return h.id ? { id: h.id, label: '' } : null;
    if (h.t === 'name') {
      const own = varInfo(file, h.name);
      if (own?.kind === 'router') return { container: `var:${file}:${h.name}` };
      if (own?.kind === 'app' && own.fw === 'express') return { container: `var:${file}:${h.name}`, subapp: true }; // app.use('/admin', adminApp)
      const imp = jsFiles[file]?.imports[h.name];
      if (imp) {
        const tf = R.resolveSource(file, imp.source);
        if (tf) {
          const local = R.exportedLocal(tf, imp.name === '*' ? 'default' : imp.name);
          const v = local && varInfo(tf, local);
          if (v?.kind === 'router') return { container: `var:${tf}:${local}` };
          if (v?.kind === 'app' && v.fw === 'express') return { container: `var:${tf}:${local}`, subapp: true };
        }
      }
      const id = R.resolveName(file, null, h.name);
      if (id) return containers[`fn:${id}`] ? { container: `fn:${id}`, id } : { id, label: '' };
      // импорт из npm-пакета (cors, helmet…) — известный внешний middleware;
      // иначе это переменная цикла или параметр: что в ней, разбор не знает
      if (imp) return { label: h.name, ext: true, about: known(h.name) };
      return { label: h.name, unknown: true };
    }
    if (h.t === 'member') {
      const imp = jsFiles[file]?.imports[h.obj];
      if (imp) {
        const tf = R.resolveSource(file, imp.source);
        const id = tf && (R.exported(tf, h.name) || R.byName[tf]?.[`${R.exported(tf, 'default')?.split('::')[1]}.${h.name}`]);
        if (id) return { id, label: '' };
      }
      const id = R.byName[file]?.[`${h.obj}.${h.name}`];
      if (id) return { id, label: '' };
      return { label: h.text, ext: true, about: known(h.text) };
    }
    if (h.t === 'call') {
      // validate(schema), auth('admin'), passport.authenticate('jwt') — фабрика middleware
      const inner = resolveRef(file, h.callee);
      if (inner?.id) return { id: inner.id, label: h.text, factory: true };
      return { label: h.text, ext: true, about: known(h.text) };
    }
    if (h.t === 'new') {
      const id = R.resolveName(file, null, h.name);
      return id ? { id, label: h.text } : { label: h.text, ext: true, about: known(h.text) };
    }
    return null;
  }
  const params = (id) => {
    const f = id?.split('::')[0];
    return jsFiles[f]?.params?.[id];
  };
  const guessRole = (ref, text, fallback) => {
    const t = `${text || ''} ${ref?.id || ''}`;
    if (AUTH_RE.test(t)) return 'auth';
    if (VALID_RE.test(t)) return 'validate';
    return fallback;
  };
  const step = (role, ref, extra = {}) => ({
    role, id: ref?.id || null, label: ref?.label || '', about: ref?.about || '', ...extra,
  });

  // ---- Express / Fastify: обход от приложения по use / register ----
  const reached = new Set();
  const vague = []; // app.use(r), где r — неизвестно что (цикл, параметр): место для честной пометки
  function walkContainer(ck, prefix, before, errors, fw, depth = 0, flags = null) {
    const c = containers[ck];
    if (!c || depth > 8 || reached.has(`${ck}@${prefix}`)) return;
    reached.add(`${ck}@${prefix}`);
    const local = [...before];
    for (const m of c.mounts) {
      if (m.method === 'setErrorHandler') {
        for (const h of m.handlers) { const ref = resolveRef(c.file, h); if (ref) { errors.push(step('error', ref, { file: c.file, line: m.line })); if (ref.id) roles[ref.id] = 'error'; } }
        continue;
      }
      if (m.method === 'use' || m.method === 'register' || m.method === 'addHook') {
        let path = m.method === 'use' ? m.path : null; // у addHook первый аргумент — имя хука, не адрес
        let hooks = m.handlers;
        if (m.method === 'register') {
          const o = m.handlers.find((h) => h.t === 'opts');
          const pref = o?.text?.match(/prefix\s*:\s*['"`]([^'"`]+)/);
          if (pref) path = pref[1];
          hooks = m.handlers.filter((h) => h.t !== 'opts');
        }
        if (m.method === 'addHook') hooks = m.handlers;
        for (const h of flat(hooks)) {
          const ref = resolveRef(c.file, h);
          if (!ref) continue;
          if (ref.container) {
            const what = ref.subapp ? 'вложенное приложение' : '';
            const rs = { role: 'router', id: ref.id || null, label: h.name || h.text || '', about: `${what ? `${what}, ` : ''}${path ? `подключён по адресу ${joinPath(prefix, path)}` : 'подключён к приложению'}`, file: c.file, line: m.line };
            walkContainer(ref.container, joinPath(prefix, path), [...local, rs], errors, fw, depth + 1, flags);
            continue;
          }
          if (ref.unknown) {
            vague.push({ file: c.file, line: m.line, text: m.text });
            local.push({ role: 'unknown', id: null, label: ref.label, about: 'здесь подключается переменная, и что в ней — разбор не знает (например, роутер из цикла). Если это роутер, его маршруты показаны с пометкой «путь неполный».', file: c.file, line: m.line, under: path ? joinPath(prefix, path) : null });
            continue;
          }
          const p = ref.id ? params(ref.id) : null;
          const wrapped = { file: c.file, line: m.line, text: m.text, under: path ? joinPath(prefix, path) : null };
          if (fw === 'express' && p === 4) { errors.push(step('error', ref, wrapped)); if (ref.id) roles[ref.id] = 'error'; continue; }
          if (m.method === 'addHook') wrapped.hook = m.path || '';
          const role = guessRole(ref, h.text || h.name || ref.label, 'middleware');
          local.push(step(role, ref, wrapped));
          if (ref.id) roles[ref.id] ??= role;
        }
        continue;
      }
      if (!m.routeId) continue;
      const handlers = flat(m.method === 'route' ? m.handlers : m.handlers.filter((h) => h.t !== 'opts'));
      const opts = m.opts || m.handlers.find((h) => h.t === 'opts');
      const full = m.method === 'route'
        ? joinPath(prefix, (m.opts?.text?.match(/url\s*:\s*['"`]([^'"`]+)/) || [])[1] || '')
        : joinPath(prefix, m.path);
      const chain = local.filter((s) => !s.under || full === s.under || full.startsWith(`${s.under}/`)).map((s) => ({ ...s }));
      for (const hk of opts?.hooks || []) {
        const ref = resolveRef(c.file, hk);
        if (ref) { const role = guessRole(ref, hk.text || hk.name, 'middleware'); chain.push(step(role, ref, { hook: hk.hook, file: c.file, line: m.line })); if (ref.id) roles[ref.id] ??= role; }
      }
      if (opts?.schema) chain.push({ role: 'validate', id: null, label: 'schema', about: 'Fastify проверяет запрос по схеме из параметров маршрута', file: c.file, line: m.line });
      handlers.forEach((h, i) => {
        const ref = resolveRef(c.file, h);
        if (!ref) return;
        const last = i === handlers.length - 1;
        const role = last ? 'handler' : guessRole(ref, h.text || h.name, 'middleware');
        chain.push(step(role, ref, { file: c.file, line: m.line }));
        if (ref.id) roles[ref.id] ??= last ? 'controller' : role;
      });
      const method = (m.method === 'route' ? (m.opts?.text?.match(/method\s*:\s*['"`](\w+)/) || [])[1] || 'GET' : m.method).toUpperCase();
      routes.push({ id: m.routeId, method, path: full, fw, file: c.file, line: m.line, chain, errors, ...(flags || {}) });
      roles[m.routeId] = 'route';
    }
  }
  const BUILTIN = {
    express: { role: 'error', id: null, label: 'встроенный обработчик Express', about: 'если ошибку никто не обработал — ответ 500 с текстом ошибки' },
    fastify: { role: 'error', id: null, label: 'встроенный обработчик Fastify', about: 'ошибка → ответ с её statusCode или 500; ошибка проверки по схеме → 400' },
  };
  // приложения, которые сами подключены к другому (app.use('/admin', adminApp)), — не корни
  const mounted = new Set();
  for (const c of Object.values(containers)) {
    for (const m of c.mounts) if (m.method === 'use') for (const h of flat(m.handlers)) { const r = h && resolveRef(c.file, h); if (r?.subapp) mounted.add(r.container); }
  }
  for (const [file, facts] of Object.entries(jsFiles)) {
    for (const [name, v] of Object.entries(facts.web?.vars || {})) {
      if (v.kind !== 'app' || v.fw === 'nest' || mounted.has(`var:${file}:${name}`)) continue;
      const errors = [];
      walkContainer(`var:${file}:${name}`, '', [], errors, v.fw);
      if (BUILTIN[v.fw]) errors.push(BUILTIN[v.fw]);
    }
  }
  // маршруты в роутерах, которые ни к какому приложению не подключены
  for (const [ck, c] of Object.entries(containers)) {
    if ([...reached].some((r) => r.startsWith(`${ck}@`))) continue;
    if (!c.mounts.some((m) => m.routeId)) continue;
    const fw = ck.startsWith('var:') ? varInfo(c.file, ck.split(':').pop())?.fw || 'express' : 'fastify';
    const where = vague.map((x) => `${x.file}:${x.line} (${x.text})`);
    walkContainer(ck, '', [], [], fw, 0, {
      incomplete: true,
      reason: where.length
        ? `Возможно, он подключается здесь: ${where.join('; ')} — но что именно там подключается, по коду не понять.`
        : 'В коде не нашлось места, где этот роутер подключается к приложению.',
    });
  }

  // ---- NestJS ----
  const nestClasses = {};
  for (const facts of Object.values(jsFiles)) for (const n of facts.web?.nest || []) nestClasses[n.id] = n;
  const globals = { prefix: '', guards: [], pipes: [], interceptors: [], filters: [], middleware: [] };
  for (const [file, facts] of Object.entries(jsFiles)) {
    for (const [name, v] of Object.entries(facts.web?.vars || {})) {
      if (v.fw !== 'nest') continue;
      for (const m of containers[`var:${file}:${name}`]?.mounts || []) {
        const refs = m.handlers.map((h) => ({ h, ref: resolveRef(file, h) })).filter((x) => x.ref);
        const add = (list) => refs.forEach(({ h, ref }) => list.push({ ...ref, text: h.text || h.name || '' }));
        if (m.method === 'setGlobalPrefix') globals.prefix = m.path || '';
        else if (m.method === 'useGlobalGuards') add(globals.guards);
        else if (m.method === 'useGlobalPipes') add(globals.pipes);
        else if (m.method === 'useGlobalInterceptors') add(globals.interceptors);
        else if (m.method === 'useGlobalFilters') add(globals.filters);
        else if (m.method === 'use') add(globals.middleware);
      }
    }
  }
  const nestApp = Object.values(jsFiles).some((f) => Object.values(f.web?.vars || {}).some((v) => v.fw === 'nest'));
  const methodOf = (ref, m) => {
    if (!ref?.id) return ref;
    const cls = ref.id;
    const mid = R.classMethod(cls, m);
    return mid ? { ...ref, id: mid, cls } : ref;
  };
  for (const [file, facts] of Object.entries(jsFiles)) {
    for (const ctl of facts.web?.nest || []) {
      if (ctl.role !== 'controller') continue;
      roles[ctl.id] = 'controller';
      const res = (list) => list.map((h) => resolveRef(file, h)).filter(Boolean);
      for (const m of ctl.methods) {
        if (!m.http) continue;
        const chain = [];
        for (const x of globals.middleware) chain.push(step(guessRole(x, x.text, 'middleware'), methodOf(x, 'use'), { label: x.label || x.text }));
        for (const x of [...globals.guards, ...res(ctl.guards), ...res(m.guards)]) chain.push(step('auth', methodOf(x, 'canActivate'), { label: x.label || x.text, about: x.about || 'guard: решает, пускать ли запрос дальше' }));
        for (const x of [...globals.interceptors, ...res(ctl.interceptors), ...res(m.interceptors)]) chain.push(step('middleware', methodOf(x, 'intercept'), { label: x.label || x.text, about: 'interceptor: работает до и после обработчика' }));
        for (const x of [...globals.pipes, ...res(ctl.pipes), ...res(m.pipes)]) chain.push(step('validate', methodOf(x, 'transform'), { label: x.label || x.text, about: x.about || 'pipe: проверяет и преобразует данные запроса' }));
        for (const p of m.params) {
          const dto = p.type && R.annType(file, null, p.type);
          if (/^Body|^Query|^Param/.test(p.deco)) chain.push({ role: 'validate', id: dto && R.kinds.get(dto) === 'entity' ? dto : null, label: `@${p.deco} ${p.name}${p.type ? `: ${p.type}` : ''}`, about: dto ? 'данные запроса проверяются по описанию DTO' : 'берёт данные из запроса' });
        }
        chain.push(step('handler', { id: m.id }));
        roles[m.id] = 'controller';
        const errors = [...res(m.filters), ...res(ctl.filters), ...globals.filters].map((x) => step('error', methodOf(x, 'catch'), { label: x.label || x.text }));
        errors.push({ role: 'error', id: null, label: 'встроенный обработчик ошибок Nest', about: 'HttpException → ответ с её кодом, остальные ошибки → 500' });
        routes.push({ id: m.id, method: m.http, path: joinPath(globals.prefix, ctl.prefix, m.path), fw: 'nest', file, line: m.line, chain, errors, ...(nestApp ? {} : { incomplete: true, reason: 'Не нашлось main.ts с NestFactory.create: глобальные guard\'ы, pipe\'ы, middleware и префикс адреса не видны.' }) });
      }
    }
    for (const n of facts.web?.nest || []) if (n.role !== 'controller') roles[n.id] ??= n.role === 'guard' ? 'auth' : n.role === 'pipe' ? 'validate' : n.role === 'filter' ? 'error' : n.role === 'provider' ? 'service' : 'middleware';
  }
  void sites;
  return { routes, roles };
}
