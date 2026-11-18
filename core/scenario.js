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
    for (const [src, tgt, line, kind, ctx] of view.sites) (bySrc[src] ||= []).push({ tgt, line, kind, ctx });
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
  const items = view.items.filter((it) => it.kind !== 'class');
  const groups = [
    group('Маршруты API', 'Сюда приходят запросы извне: адрес и метод HTTP.', items.filter((it) => it.kind === 'route' || it.route)),
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

/**
 * Шаги сценария: обход в глубину, дети — в порядке строк.
 * Шаг: { n, id, depth, parent, line, kind, ctx, repeat, cut }.
 *  repeat — эта функция уже была выше, второй раз не раскрываем;
 *  cut — дальше есть вызовы, но глубина закончилась.
 */
export function buildScenario(view, entryId, { depth = 4, maxSteps = 80, index } = {}) {
  const itemById = Object.fromEntries(view.items.map((i) => [i.id, i]));
  const { bySrc, ordered } = index || sitesIndex(view);
  const childrenOf = (id) => {
    const it = itemById[id];
    if (it?.kind === 'class') {
      // создание объекта: дальше идём в его конструктор
      const ctor = itemById[`${id}.__init__`] || itemById[`${id}.constructor`];
      return ctor ? [{ tgt: ctor.id, line: 0, kind: 'call', ctx: 'создание объекта' }] : [];
    }
    const seen = new Set();
    return (bySrc[id] || []).filter((s) => { const k = `${s.tgt}:${s.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const steps = [];
  const shown = new Set();
  let truncated = false;
  (function dfs(id, d, parent, via) {
    if (steps.length >= maxSteps) { truncated = true; return; }
    const n = steps.length + 1;
    const repeat = shown.has(id);
    const kids = repeat ? [] : childrenOf(id);
    const step = { n, id, depth: d, parent, line: via?.line || 0, kind: via?.kind || 'call', ctx: via?.ctx || '', repeat, cut: !repeat && d >= depth && kids.length > 0 };
    steps.push(step);
    shown.add(id);
    if (repeat || d >= depth) return;
    for (const k of kids) dfs(k.tgt, d + 1, n, k);
  })(entryId, 0, 0, null);
  const hash = hashStr(steps.map((s) => `${s.id}@${itemById[s.id]?.hash || ''}`).join('|'));
  return { entry: entryId, depth, steps, ordered, truncated, hash };
}
