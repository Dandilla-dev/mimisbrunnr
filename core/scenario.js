// Сценарии: путь от точки входа (маршрут, обработчик кнопки, main…) по вызовам —
// шаг за шагом, в том порядке, в каком вызовы стоят в коде. Без ИИ и без запуска
// кода: только места вызовов, которые нашёл разбор. Чистый JS — этим пользуются
// и ядро (рассказ ИИ), и окно (экран сценария).

const isTest = (it) => /(^|\/)(tests?|__tests__)\//.test(it.file) || /\.(test|spec)\.[jt]sx?$/.test(it.file) || /(^|\/)test_[^/]*\.py$/.test(it.file);
const short = (it) => it.name.split('.').pop();

/** Места связей по функции, по порядку строк. В разборах до 0.2 мест нет — берём связи без порядка. */
export function sitesIndex(view) {
  const bySrc = {};
  if (view.sites?.length) {
    for (const [src, tgt, line, kind, ctx, label] of view.sites) (bySrc[src] ||= []).push({ tgt, line, kind, ctx, label: label || '' });
    return { bySrc, ordered: true };
  }
  for (const [src, tgt, kind] of view.edges) (bySrc[src] ||= []).push({ tgt, line: 0, kind: kind || 'call', ctx: '' });
  return { bySrc, ordered: false };
}

/** Точки входа, сгруппированные. */
export function entryPoints(view) {
  const called = new Set(view.edges.map((e) => e[1]));
  const outCount = {};
  for (const [a, b] of view.edges) (outCount[a] ||= new Set()).add(b);
  const taken = new Set();
  const group = (title, hint, list) => {
    const ids = list.filter((it) => !taken.has(it.id));
    ids.forEach((it) => taken.add(it.id));
    return { title, hint, ids: ids.map((it) => it.id) };
  };
  const items = view.items.filter((it) => it.kind !== 'class' && it.kind !== 'entity');
  const routeIds = new Set((view.web?.routes || []).map((r) => r.id));
  const groups = [
    group('Маршруты API', 'Сюда приходят запросы извне: адрес и метод HTTP. Сценарий пройдёт весь путь запроса: промежуточные обработчики, проверки, обработчик, база, ответ и ошибки.',
      items.filter((it) => routeIds.has(it.id) || it.kind === 'route' || it.route)),
    group('Действия в интерфейсе', 'Обработчики: что происходит, когда пользователь нажимает, вводит, отправляет.',
      items.filter((it) => !isTest(it) && it.name.includes('.') && /^(handle|on)[A-Z]/.test(short(it)))),
    group('Экраны и запуск', 'С чего начинается программа: main, корневые компоненты, которые никто не рисует.',
      items.filter((it) => !isTest(it) && ((/^(main|run|cli|start|bootstrap|create_app|app)$/i.test(short(it)) && !it.name.includes('.'))
        || (it.kind === 'component' && !called.has(it.id) && (outCount[it.id]?.size || 0) > 0)))),
    group('Другие начала цепочек', 'Функции, которые никто в проекте не вызывает, а они вызывают несколько других.',
      items.filter((it) => !isTest(it) && !called.has(it.id) && (outCount[it.id]?.size || 0) >= 2)
        .sort((a, b) => outCount[b.id].size - outCount[a.id].size).slice(0, 40)),
    group('Тесты', 'Каждый тест — готовый сценарий: что вызывается и в каком порядке.',
      items.filter((it) => isTest(it) && /^test/i.test(short(it)) && (outCount[it.id]?.size || 0) > 0)),
  ];
  return groups.filter((g) => g.ids.length);
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export const ROLE_RU = {
  request: 'запрос', router: 'роутер', middleware: 'промежуточный обработчик', auth: 'проверка доступа', validate: 'проверка данных',
  dependency: 'зависимость', controller: 'обработчик', handler: 'обработчик', service: 'сервис', repository: 'репозиторий',
  unknown: 'неизвестно', entity: 'база данных', data: 'данные', schema: 'схема данных', response: 'ответ', 'error-branch': 'ошибки', error: 'обработчик ошибок', route: 'маршрут',
};

// Роль шага по месту в проекте — когда разбор не знает её точно
export function roleOf(view, id) {
  const it = view.items.find((i) => i.id === id);
  if (!it) return '';
  if (view.roles?.[id]) return view.roles[id];
  if (it.kind === 'entity') {
    const orm = (view.entities || []).find((e) => e.id === id)?.orm;
    return orm === 'dataclass' ? 'data' : orm === 'pydantic' || orm === 'dto' ? 'schema' : 'entity';
  }
  const p = `${it.file} ${it.name}`;
  if (/(^|\/)controllers?\/|Controller\b|_controller\b|\.controller\./i.test(p)) return 'controller';
  if (/(^|\/)services?\/|Service\b|_service\b|\.service\./i.test(p)) return 'service';
  if (/(^|\/)(repositor(y|ies)|dao|stores?)\/|Repository\b|Store\b|_store\b|\.repository\./i.test(p)) return 'repository';
  if (/(^|\/)middlewares?\//i.test(p)) return 'middleware';
  if (/(^|\/)(validators?|schemas?)\//i.test(p)) return 'validate';
  return '';
}

/** Маршрут веб-приложения по id обработчика или маршрута. */
export const routeOf = (view, id, method) => (view.web?.routes || []).find((r) => r.id === id && (!method || r.method === method)) || null;

/**
 * Шаги сценария: обход в глубину, дети — в порядке строк.
 * Шаг: { n, id, depth, parent, line, kind, ctx, repeat, cut, role, label, about, synthetic, file }.
 *  repeat — эта функция уже была выше, второй раз не раскрываем;
 *  cut — дальше есть вызовы, но глубина закончилась;
 *  synthetic — шаг без своей функции в проекте (запрос, express.json(), ответ…).
 * Для маршрута веб-приложения сначала идёт путь запроса (route.chain), потом ошибки и ответ.
 */
export function buildScenario(view, entryId, { depth = 4, maxSteps = 120, index, method } = {}) {
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));
  const { bySrc, ordered } = index || sitesIndex(view);
  const childrenOf = (id) => {
    const it = itemById[id];
    if (it?.kind === 'class') {
      // создание объекта: дальше идём в его конструктор
      const ctor = itemById[`${id}.__init__`] || itemById[`${id}.constructor`];
      return ctor ? [{ tgt: ctor.id, line: 0, kind: 'call', ctx: 'создание объекта' }] : [];
    }
    if (it?.kind === 'entity') return []; // сущность — конец цепочки: дальше база данных
    const seen = new Set();
    return (bySrc[id] || []).filter((s) => { const k = `${s.tgt}:${s.kind}:${s.label || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const steps = [];
  const shown = new Set();
  let truncated = false;
  const push = (st) => { const n = steps.length + 1; steps.push({ n, depth: 0, parent: 0, line: 0, kind: 'call', ctx: '', repeat: false, cut: false, role: '', label: '', about: '', ...st }); return n; };
  function dfs(id, d, parent, via, extra = {}) {
    if (steps.length >= maxSteps) { truncated = true; return; }
    if (!itemById[id]) return;
    const repeat = shown.has(id);
    const kids = repeat ? [] : childrenOf(id);
    const n = push({
      id, depth: d, parent, line: via?.line || 0, kind: via?.kind || 'call', ctx: via?.ctx || '', repeat, cut: !repeat && d >= depth && kids.length > 0,
      role: extra.role || roleOf(view, id), label: via?.label || extra.label || '', about: extra.about || '',
    });
    shown.add(id);
    if (repeat || d >= depth) return;
    for (const k of kids) dfs(k.tgt, d + 1, n, k);
  }
  const route = routeOf(view, entryId, method);
  if (route) {
    const top = push({ id: null, synthetic: true, role: 'request', label: `${route.method} ${route.path}`, about: 'запрос приходит в приложение', file: route.file, line: route.line });
    for (const st of route.chain) {
      if (st.id && itemById[st.id]) dfs(st.id, 1, top, { line: 0, kind: 'call', ctx: '', label: st.label }, { role: st.role === 'handler' ? 'controller' : st.role, about: st.about });
      else push({ id: null, synthetic: true, depth: 1, parent: top, role: st.role, label: st.label, about: st.about, file: st.file, line: st.line || 0 });
    }
    const outs = route.out || [];
    if (outs.some((o) => o.kind === 'response' || o.kind === 'return')) {
      const codes = [...new Set(outs.filter((o) => o.kind === 'response' || o.kind === 'return').map((o) => o.status).filter(Boolean))];
      push({ id: null, synthetic: true, depth: 1, parent: top, role: 'response', label: `ответ${codes.length ? ` ${codes.join(' / ')}` : ''}`, about: outs.filter((o) => o.kind === 'response' || o.kind === 'return').map((o) => `${o.status ? `${o.status} · ` : ''}${o.text}`).join('\n'), file: route.handlerFile, line: outs.find((o) => o.kind === 'response' || o.kind === 'return')?.line || 0 });
    }
    if (route.errors?.length) {
      const errTop = push({ id: null, synthetic: true, depth: 1, parent: top, role: 'error-branch', label: 'если случится ошибка', about: outs.filter((o) => o.kind === 'throw' || o.kind === 'next').map((o) => `${o.text} (стр. ${o.line})`).join('\n') });
      for (const st of route.errors) {
        if (st.id && itemById[st.id]) dfs(st.id, 2, errTop, { line: 0, kind: 'call', ctx: '' }, { role: 'error', about: st.about });
        else push({ id: null, synthetic: true, depth: 2, parent: errTop, role: 'error', label: st.label, about: st.about, file: st.file, line: st.line || 0 });
      }
    }
  } else dfs(entryId, 0, 0, null);
  const hash = hashStr(steps.map((s) => `${s.id || s.label}@${itemById[s.id]?.hash || ''}`).join('|'));
  return { entry: entryId, depth, steps, ordered, truncated, hash, route };
}
