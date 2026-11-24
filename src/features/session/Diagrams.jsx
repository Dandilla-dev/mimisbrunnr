// Три уровня схемы взаимодействия:
// 1) проект — слои и сколько вызовов идёт между ними;
// 2) слой — его файлы, связи между ними и с соседними слоями;
// 3) функция — кто её вызывает и кого вызывает она (на 1–2 шага), путь до другой функции;
// плюс схема «как проходят запросы» — колонки по ролям слева направо.
import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { go } from '../../app/store';
import Graph from '../../components/Graph';
import { layerColor } from './MapColumn';
import { linkOf } from './linkKinds';
import { roleOf } from '../../../core/scenario.js';

const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const calls = (n) => `${n} ${plural(n, 'вызов', 'вызова', 'вызовов')}`;

function EdgeDetails({ ix, edge, title, onClose }) {
  const dispatch = useDispatch();
  if (!edge) return null;
  return (
    <div className="mt-3 card px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[13px]"><b>{title}</b> · {calls(edge.pairs.length)}</div>
        <button className="btn-ghost" onClick={onClose}>Скрыть</button>
      </div>
      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto scroll-thin">
        {edge.pairs.slice(0, 200).map(([a, b]) => (
          <div key={`${a}>${b}`} className="flex items-center gap-2 font-mono text-[12px] flex-wrap">
            <button className="hover:text-bronze" onClick={() => dispatch(go({ t: 'fn', id: a }))}>{ix.itemById[a]?.name}</button>
            <span className="text-mist-dim">→</span>
            <button className="hover:text-bronze" onClick={() => dispatch(go({ t: 'fn', id: b }))}>{ix.itemById[b]?.name}</button>
            {ix.edgeKind[`${a}>${b}`] === 'ref' && <span className="text-[10.5px] text-bronze/80">передаётся</span>}
            <span className="text-mist-dim text-[10.5px]">{ix.itemById[a]?.file.split('/').pop()} → {ix.itemById[b]?.file.split('/').pop()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const layerOfItem = (ix, id) => ix.fileByPath[ix.itemById[id]?.file]?.layer;

// ---------------------------------------------------------------- 1. проект
export function ProjectDiagram({ view, ix }) {
  const dispatch = useDispatch();
  const [sel, setSel] = useState(null);
  const { nodes, edges } = useMemo(() => {
    const startLayers = new Set((view.entries || []).slice(0, 3).map((e) => ix.fileByPath[e.file]?.layer).filter(Boolean));
    const agg = {};
    const inside = {};
    for (const [a, b] of view.edges) {
      const la = layerOfItem(ix, a), lb = layerOfItem(ix, b);
      if (!la || !lb) continue;
      if (la === lb) { inside[la] = (inside[la] || 0) + 1; continue; }
      (agg[`${la}\u0000${lb}`] ||= []).push([a, b]);
    }
    const ns = view.layers.map((l) => {
      const st = ix.layerStats[l.id] || { files: 0, items: 0 };
      return { id: l.id, label: l.name, start: startLayers.has(l.id), sub: `${st.files} файл. · ${st.items} функц. · внутри ${inside[l.id] || 0} св.`, note: l.description || '', color: layerColor(view, l.id), title: l.description || l.name };
    });
    const es = Object.entries(agg).map(([k, pairs]) => {
      const [s, t] = k.split('\u0000');
      return { id: `e:${k}`, source: s, target: t, label: String(pairs.length), weight: pairs.length, pairs };
    });
    return { nodes: ns, edges: es };
  }, [view, ix]);
  const name = (id) => view.layers.find((l) => l.id === id)?.name;
  return (
    <div>
      <Graph
        nodes={nodes} edges={edges} height={440} selectedEdge={sel?.id} name={`${view.title} — части проекта`}
        onNodeClick={(n) => dispatch(go({ t: 'layer', id: n.id }))}
        onEdgeClick={(e) => setSel(e)}
        emptyText="Связей между частями проекта не найдено."
      />
      <div className="text-[12px] text-mist-dim mt-2">Блоки — части проекта, под названием — за что часть отвечает. Число на стрелке — сколько вызовов идёт из одной части в другую. Нажми на блок, чтобы открыть часть, на стрелку — чтобы увидеть сами вызовы.</div>
      <EdgeDetails ix={ix} edge={sel} title={sel ? `${name(sel.source)} → ${name(sel.target)}` : ''} onClose={() => setSel(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- 2. слой
const MAX_FILES = 24;
export function LayerDiagram({ view, ix, layerId }) {
  const dispatch = useDispatch();
  const [sel, setSel] = useState(null);
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  const { nodes, edges, hubs } = useMemo(() => {
    const allFiles = (ix.filesByLayer[layerId] || []).map((f) => f.path);
    // в большой части показываем самые связанные файлы, остальные — одним блоком «ещё N»
    const degree = {};
    for (const [a, b] of view.edges) {
      const fa = ix.itemById[a]?.file, fb = ix.itemById[b]?.file;
      if (fa && fb && fa !== fb) { degree[fa] = (degree[fa] || 0) + 1; degree[fb] = (degree[fb] || 0) + 1; }
    }
    const hidden = new Set(!more && allFiles.length > MAX_FILES ? [...allFiles].sort((a, b) => (degree[b] || 0) - (degree[a] || 0)).slice(MAX_FILES) : []);
    const files = allFiles.filter((f) => !hidden.has(f));
    const inLayer = new Set(files);
    const prefix = (() => {
      if (files.length < 2) return '';
      const parts = files.map((f) => f.split('/'));
      let i = 0;
      while (parts.every((p) => p.length - 1 > i && p[i] === parts[0][i])) i += 1;
      return i ? `${parts[0].slice(0, i).join('/')}/` : '';
    })();
    const agg = {};
    for (const [a, b] of view.edges) {
      const fa = ix.itemById[a]?.file, fb = ix.itemById[b]?.file;
      if (!fa || !fb || fa === fb) continue;
      const ia = inLayer.has(fa) || hidden.has(fa), ib = inLayer.has(fb) || hidden.has(fb);
      if (!ia && !ib) continue;
      const s = hidden.has(fa) ? 'more' : ia ? `f:${fa}` : `l:${ix.fileByPath[fa].layer}`;
      const t = hidden.has(fb) ? 'more' : ib ? `f:${fb}` : `l:${ix.fileByPath[fb].layer}`;
      if (s === t) continue;
      (agg[`${s}\u0000${t}`] ||= []).push([a, b]);
    }
    // «общие» файлы, которыми пользуются почти все (например, db.py): стрелки к ним
    // превращают схему в паутину, поэтому по умолчанию их не рисуем
    const usersOf = {};
    for (const k of Object.keys(agg)) { const [s, t] = k.split('\u0000'); if (t.startsWith('f:')) (usersOf[t] ||= new Set()).add(s); }
    const hubSet = new Set(Object.entries(usersOf)
      .filter(([, u]) => u.size >= 5 && u.size >= 0.35 * files.length).map(([t]) => t));
    if (!all) for (const k of Object.keys(agg)) if (hubSet.has(k.split('\u0000')[1])) delete agg[k];
    const used = new Set();
    Object.keys(agg).forEach((k) => k.split('\u0000').forEach((x) => used.add(x)));
    const starts = new Set((view.entries || []).map((e) => e.file));
    const ns = files.map((f) => ({
      id: `f:${f}`, label: f.slice(prefix.length), start: starts.has(f),
      sub: hubSet.has(`f:${f}`) && !all ? `общий · используют ${usersOf[`f:${f}`].size} файлов` : `${(ix.itemsByFile[f] || []).length} функц. · ${ix.fileByPath[f].lines} стр.`,
      note: ix.fileByPath[f].purpose || '',
      color: layerColor(view, layerId), mono: true, title: ix.fileByPath[f].purpose || f,
    }));
    if (hidden.size) ns.push({ id: 'more', label: `ещё ${hidden.size} файлов`, sub: 'нажми, чтобы показать все', emphasis: 'cluster', title: [...hidden].join('\n') });
    for (const x of used) {
      if (!x.startsWith('l:')) continue;
      const lid = x.slice(2);
      ns.push({ id: x, label: view.layers.find((l) => l.id === lid)?.name || lid, sub: 'другая часть проекта', color: layerColor(view, lid), emphasis: 'ghost' });
    }
    const es = Object.entries(agg).map(([k, pairs]) => {
      const [s, t] = k.split('\u0000');
      return { id: `e:${k}`, source: s, target: t, label: String(pairs.length), weight: pairs.length, pairs };
    });
    return { nodes: ns, edges: es, hubs: [...hubSet] };
  }, [view, ix, layerId, all, more]);
  const label = (id) => nodes.find((n) => n.id === id)?.label;
  return (
    <div>
      {hubs.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-mist mb-2 cursor-pointer w-fit" htmlFor={`all-${layerId}`}>
          <input id={`all-${layerId}`} type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[#B98D55]" />
          Показать все связи (в том числе к общим файлам: {hubs.map((h) => h.split('/').pop()).join(', ')})
        </label>
      )}
      <Graph
        nodes={nodes} edges={edges} height={nodes.length > 12 ? 640 : 480} selectedEdge={sel?.id} name={`${view.title} — ${view.layers.find((l) => l.id === layerId)?.name || 'часть'}`}
        onNodeClick={(n) => (n.id === 'more' ? setMore(true) : dispatch(go(n.id.startsWith('f:') ? { t: 'file', file: n.id.slice(2) } : { t: 'layer', id: n.id.slice(2) })))}
        onEdgeClick={(e) => setSel(e)}
        emptyText="В этой части нет файлов."
      />
      {more && (ix.filesByLayer[layerId] || []).length > MAX_FILES && <button className="btn-ghost text-[12px] mt-1 -ml-2" onClick={() => setMore(false)}>Снова показать только главные файлы</button>}
      <div className="text-[12px] text-mist-dim mt-2">Блоки — файлы этой части, под именем — зачем файл нужен. Пунктиром — соседние части. Число на стрелке — сколько вызовов идёт между ними.</div>
      <EdgeDetails ix={ix} edge={sel} title={sel ? `${label(sel.source)} → ${label(sel.target)}` : ''} onClose={() => setSel(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- 3. функция
const PER_SIDE = 14;
const PER_SIDE_MORE = 60;

/** «Общие» функции: их вызывают отовсюду (логгер, форматирование, get_db). */
export function hubsOf(view, ix) {
  const n = view.items.length;
  const min = Math.max(8, Math.round(n * 0.04));
  return new Set(Object.entries(ix.callers).filter(([, c]) => new Set(c).size >= min).map(([id]) => id));
}
const fnNode = (view, ix, x, extra = {}) => {
  const it = ix.itemById[x];
  return { id: x, start: (view.entries || []).some((e) => e.fn === x), label: it.name, sub: `${it.file.split('/').pop()}:${it.line}`, note: it.phrase || '', mono: true, color: layerColor(view, ix.fileByPath[it.file]?.layer), title: it.phrase || it.name, ...extra };
};
const kindLabel = (k) => (k === 'guess' ? '?' : k === 'dispatch' ? 'или' : undefined);

/** Все кратчайшие пути по вызовам от a до b. */
function shortestPaths(ix, a, b, limit = 40) {
  const bfs = (start, next) => {
    const d = { [start]: 0 };
    const q = [start];
    while (q.length) { const x = q.shift(); for (const y of next[x] || []) if (d[y] === undefined) { d[y] = d[x] + 1; q.push(y); } }
    return d;
  };
  const ds = bfs(a, ix.calls);
  if (ds[b] === undefined) return null;
  const dt = bfs(b, ix.callers);
  const D = ds[b];
  const on = Object.keys(ds).filter((x) => dt[x] !== undefined && ds[x] + dt[x] === D).slice(0, limit);
  const set = new Set(on);
  const edges = [];
  for (const x of on) for (const y of ix.calls[x] || []) if (set.has(y) && ds[y] === ds[x] + 1) edges.push([x, y]);
  // сколько разных кратчайших путей
  const ways = { [a]: 1 };
  for (const x of [...on].sort((p, q) => ds[p] - ds[q])) for (const y of ix.calls[x] || []) if (set.has(y) && ds[y] === ds[x] + 1) ways[y] = (ways[y] || 0) + (ways[x] || 0);
  return { nodes: on, edges, steps: D, ways: ways[b] || 1 };
}

function PathPicker({ view, ix, from, onPick }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const hits = s ? view.items.filter((i) => i.id !== from && i.name.toLowerCase().includes(s)).sort((a, b) => a.name.length - b.name.length).slice(0, 12) : [];
  return (
    <div className="relative w-[320px] max-w-full">
      <label htmlFor="path-to" className="sr-only">До какой функции</label>
      <input id="path-to" autoFocus className="input py-1.5 text-[12.5px]" placeholder="До какой функции? Начни вводить имя…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) onPick(hits[0].id); }} />
      {hits.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 card rounded-xl py-1 max-h-72 overflow-y-auto scroll-thin shadow-2xl">
          {hits.map((h) => (
            <button key={h.id} className="w-full text-left px-3 py-1.5 hover:bg-panel-2" onClick={() => onPick(h.id)}>
              <div className="font-mono text-[12px] truncate">{h.name}</div>
              <div className="text-[11px] text-mist-dim truncate">{h.file}:{h.line}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FnDiagram({ view, ix, id }) {
  const dispatch = useDispatch();
  const [depth, setDepth] = useState(1);
  const [more, setMore] = useState(false);
  const [showHubs, setShowHubs] = useState(false);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState(null);
  const hubs = useMemo(() => hubsOf(view, ix), [view, ix]);
  const path = useMemo(() => {
    if (!target) return null;
    const fwd = shortestPaths(ix, id, target);
    if (fwd) return { ...fwd, dir: 'forward' };
    const back = shortestPaths(ix, target, id);
    return back ? { ...back, dir: 'back' } : { none: true };
  }, [ix, id, target]);

  const { nodes, edges, hiddenHubs } = useMemo(() => {
    if (path && !path.none) {
      const ns = path.nodes.map((x) => fnNode(view, ix, x, { emphasis: x === id || x === target ? 'center' : undefined }));
      const es = path.edges.map(([a, b]) => { const k = ix.edgeKind[`${a}>${b}`]; return { id: `${a}>${b}`, source: a, target: b, kind: k, dash: linkOf(k).dash, label: kindLabel(k), hl: true }; });
      return { nodes: ns, edges: es, hiddenHubs: [] };
    }
    const limit = more ? PER_SIDE_MORE : PER_SIDE;
    const set = new Set([id]);
    const cut = { in: 0, out: 0 };
    const hidden = new Set();
    const walkSide = (map, side) => {
      let frontier = [id];
      for (let d = 0; d < depth; d++) {
        const next = [];
        for (const x of frontier) {
          // через общие функции дальше не идём: за ними — полпроекта
          if (d > 0 && hubs.has(x) && !showHubs) continue;
          for (const y of map[x] || []) {
            if (set.has(y)) continue;
            if (d > 0 && hubs.has(y) && !showHubs) { hidden.add(y); continue; }
            if (next.length >= limit * (d + 1)) { cut[side] += 1; continue; }
            set.add(y); next.push(y);
          }
        }
        frontier = next;
      }
    };
    walkSide(ix.callers, 'in');
    walkSide(ix.calls, 'out');
    const ns = [...set].map((x) => fnNode(view, ix, x, {
      emphasis: x === id ? 'center' : undefined,
      ...(hubs.has(x) && x !== id ? { sub: `общая · вызывают ${new Set(ix.callers[x]).size} функций` } : {}),
    }));
    const es = view.edges.filter(([a, b]) => set.has(a) && set.has(b) && (depth > 1 || a === id || b === id))
      .map(([a, b, k]) => ({ id: `${a}>${b}`, source: a, target: b, kind: k || 'call', dash: linkOf(k).dash, label: kindLabel(k) }));
    if (cut.in) { ns.push({ id: '__more_in', label: `ещё ${cut.in}`, sub: 'кто вызывает · показать', emphasis: 'cluster' }); es.push({ id: 'more_in', source: '__more_in', target: id }); }
    if (cut.out) { ns.push({ id: '__more_out', label: `ещё ${cut.out}`, sub: 'кого вызывает · показать', emphasis: 'cluster' }); es.push({ id: 'more_out', source: id, target: '__more_out' }); }
    return { nodes: ns, edges: es, hiddenHubs: [...hidden] };
  }, [view, ix, id, depth, more, hubs, showHubs, path, target]);

  const name = (x) => ix.itemById[x]?.name || '';
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {!target && <>
          <span className="text-[12px] text-mist">Глубина:</span>
          {[1, 2].map((d) => (
            <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-1 rounded-md text-[12px] border ${depth === d ? 'border-bronze text-bronze' : 'border-hairline text-mist hover:text-stone'}`}>{d === 1 ? '1 шаг' : '2 шага'}</button>
          ))}
          {more && <button className="btn-ghost text-[12px]" onClick={() => setMore(false)}>Свернуть лишнее</button>}
        </>}
        <span className="flex-1" />
        {target
          ? <button className="btn text-[12px] py-1" onClick={() => { setTarget(null); setPicking(false); }}>Обычная схема</button>
          : picking
            ? <><PathPicker view={view} ix={ix} from={id} onPick={(x) => { setTarget(x); setPicking(false); }} /><button className="btn-ghost text-[12px]" onClick={() => setPicking(false)}>Отмена</button></>
            : <button className="btn text-[12px] py-1" onClick={() => setPicking(true)} title="Как эта функция доходит до другой — по цепочке вызовов">Путь до функции…</button>}
      </div>
      {target && (
        <div className="text-[13px] mb-2 leading-relaxed">
          {path?.none
            ? <>Из <b className="font-mono">{name(id)}</b> до <b className="font-mono">{name(target)}</b> по вызовам не дойти — ни в одну сторону. Возможно, их связывает что-то, чего разбор не видит (событие, очередь, вызов по имени из данных).</>
            : <>
                {path.dir === 'back' ? <>Наоборот: <b className="font-mono">{name(target)}</b> доходит до <b className="font-mono">{name(id)}</b></> : <><b className="font-mono">{name(id)}</b> доходит до <b className="font-mono">{name(target)}</b></>}
                {' '}за {path.steps} {plural(path.steps, 'шаг', 'шага', 'шагов')}{path.ways > 1 ? ` — разными путями (${path.ways})` : ''}. На схеме только функции на самых коротких путях.
              </>}
        </div>
      )}
      {!target && hiddenHubs.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-mist mb-2 cursor-pointer w-fit" htmlFor={`hubs-${id}`}>
          <input id={`hubs-${id}`} type="checkbox" checked={showHubs} onChange={(e) => setShowHubs(e.target.checked)} className="accent-[#B98D55]" />
          Показать общие функции, которые вызывают отовсюду: {hiddenHubs.slice(0, 5).map((x) => name(x).split('.').pop()).join(', ')}{hiddenHubs.length > 5 ? ` и ещё ${hiddenHubs.length - 5}` : ''}
        </label>
      )}
      {!(target && path?.none) && (
        <Graph
          nodes={nodes} edges={edges} height={nodes.length > 10 ? 480 : 340} name={`${name(id)}${target ? ` — путь до ${name(target)}` : ' — связи'}`}
          onNodeClick={(n) => { if (n.id === '__more_in' || n.id === '__more_out') setMore(true); else if (n.id !== id) dispatch(go({ t: 'fn', id: n.id })); }}
          emptyText="Связей нет."
        />
      )}
      <div className="text-[12px] text-mist-dim mt-2">{target ? 'Читай слева направо: кто кого вызывает по дороге.' : 'Слева — кто вызывает эту функцию, справа — кого вызывает она. Под именем — что функция делает (если уже объяснена).'} Виды стрелок — в легенде внизу схемы; подробнее — наведи на вид связи в списке справа.</div>
    </div>
  );
}

// ---------------------------------------------------------------- как проходят запросы
const LANES = ['Маршруты', 'Проверки и обвязка', 'Обработчики', 'Логика', 'Хранилище', 'Данные'];
const LANE_OF = { request: 0, router: 0, middleware: 1, auth: 1, validate: 1, dependency: 1, unknown: 1, controller: 2, handler: 2, service: 3, repository: 4, entity: 5, data: 5, schema: 5 };
const MAX_FN_NODES = 36;
const MAX_NODES = 44;

export function RequestDiagram({ view, ix }) {
  const dispatch = useDispatch();
  const [byFile, setByFile] = useState(null); // null — решает размер схемы
  const [full, setFull] = useState(false);
  const [only, setOnly] = useState(''); // только маршруты из этого файла
  const allRoutes = view.web?.routes || [];
  const routeFiles = useMemo(() => {
    const c = {};
    for (const r of allRoutes) c[r.file] = (c[r.file] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [allRoutes]);
  const routes = useMemo(() => (only ? allRoutes.filter((r) => r.file === only) : allRoutes), [allRoutes, only]);
  const built = useMemo(() => {
    const laneOf = {};
    const setLane = (id, l) => { if (laneOf[id] === undefined || l < laneOf[id]) laneOf[id] = l; };
    const agg = {};
    const link = (a, b) => { if (a !== b) agg[`${a}\u0000${b}`] = (agg[`${a}\u0000${b}`] || 0) + 1; };
    const handlers = new Set();
    for (const r of routes) {
      const rf = `r:${r.file}`;
      setLane(rf, 0);
      let prev = rf;
      for (const st of r.chain) {
        if (!st.id || !ix.itemById[st.id]) continue;
        if (st.role === 'router' || st.role === 'request') continue; // роутер — это и есть блок файла с маршрутами
        const role = st.role === 'handler' ? 'controller' : st.role;
        setLane(st.id, LANE_OF[role] ?? 1);
        link(prev, st.id);
        prev = st.id;
        if (role === 'controller') handlers.add(st.id);
      }
      if (!r.chain.some((c) => c.role === 'handler' || c.role === 'controller') && ix.itemById[r.id]) { setLane(r.id, 2); link(prev, r.id); handlers.add(r.id); }
    }
    // от обработчиков — вглубь по вызовам, 3 шага; роль — по месту в проекте
    const hubs = hubsOf(view, ix);
    let frontier = [...handlers];
    const seen = new Set(frontier);
    for (let d = 0; d < 3; d++) {
      const next = [];
      for (const x of frontier) for (const y of ix.calls[x] || []) {
        if (!ix.itemById[y] || ix.itemById[y].kind === 'class') continue;
        const role = roleOf(view, y);
        const lane = LANE_OF[role] ?? (hubs.has(y) ? -1 : 3);
        if (lane < 0) continue; // общие функции (логгер и т. п.) не рисуем
        if (lane < laneOf[x]) continue; // стрелка назад, против пути запроса — не рисуем
        setLane(y, lane);
        link(x, y);
        if (!seen.has(y)) { seen.add(y); next.push(y); }
      }
      frontier = next;
    }
    return { laneOf, agg };
  }, [view, ix, routes]);

  const fnCount = Object.keys(built.laneOf).filter((x) => !x.startsWith('r:')).length;
  const fileMode = byFile ?? fnCount > MAX_FN_NODES;

  const { nodes, edges, cut } = useMemo(() => {
    const { laneOf, agg } = built;
    // по файлам: блок — файл в своей колонке
    const keyOf = (x) => (x.startsWith('r:') || !fileMode ? x : `F:${laneOf[x]}:${ix.itemById[x].file}`);
    const members = {};
    for (const x of Object.keys(laneOf)) (members[keyOf(x)] ||= []).push(x);
    const eagg = {};
    for (const [k, w] of Object.entries(agg)) {
      const [a, b] = k.split('\u0000');
      const ka = keyOf(a), kb = keyOf(b);
      if (laneOf[a] > laneOf[b]) continue; // против пути запроса — не рисуем
      if (ka !== kb) eagg[`${ka}\u0000${kb}`] = (eagg[`${ka}\u0000${kb}`] || 0) + w;
    }
    // слишком много блоков — в каждой колонке оставляем самые связанные
    const deg = {};
    for (const [k, w] of Object.entries(eagg)) { const [a, b] = k.split('\u0000'); deg[a] = (deg[a] || 0) + w; deg[b] = (deg[b] || 0) + w; }
    const keys = Object.keys(members);
    const hidden = new Set();
    if (keys.length > MAX_NODES && !full) {
      const byLane = {};
      for (const k of keys) (byLane[laneOf[members[k][0]]] ||= []).push(k);
      const per = Math.max(4, Math.floor(MAX_NODES / Object.keys(byLane).length));
      for (const list of Object.values(byLane)) list.sort((a, b) => (deg[b] || 0) - (deg[a] || 0)).slice(per).forEach((k) => hidden.add(k));
    }
    const moreId = (lane) => `more:${lane}`;
    const vis = (k) => (hidden.has(k) ? moreId(laneOf[members[k][0]]) : k);
    const ns = [];
    const moreCount = {};
    for (const k of keys) {
      const lane = laneOf[members[k][0]];
      if (hidden.has(k)) { moreCount[lane] = (moreCount[lane] || 0) + 1; continue; }
      if (k.startsWith('r:')) {
        const file = k.slice(2);
        const rs = routes.filter((r) => r.file === file);
        const methods = [...new Set(rs.map((r) => r.method))].join(', ');
        ns.push({ id: k, label: file.split('/').pop(), sub: `${rs.length} ${plural(rs.length, 'маршрут', 'маршрута', 'маршрутов')} · ${methods}`, note: rs.slice(0, 3).map((r) => r.path).join(', ') + (rs.length > 3 ? '…' : ''), mono: true, lane: 0, color: '#8A93A6', title: rs.map((r) => `${r.method} ${r.path}`).join('\n') });
      } else if (k.startsWith('F:')) {
        const file = members[k][0] && ix.itemById[members[k][0]].file;
        ns.push({ id: k, label: file.split('/').pop(), sub: `${members[k].length} функц. · ${file.split('/').slice(-2, -1)[0] || ''}`, note: ix.fileByPath[file]?.purpose || '', mono: true, lane, color: layerColor(view, ix.fileByPath[file]?.layer), title: members[k].map((x) => ix.itemById[x].name).join('\n') });
      } else ns.push(fnNode(view, ix, k, { lane }));
    }
    for (const [lane, n] of Object.entries(moreCount)) ns.push({ id: moreId(lane), label: `ещё ${n}`, sub: 'нажми, чтобы показать все', emphasis: 'cluster', lane: Number(lane) });
    const es = {};
    for (const [k, w] of Object.entries(eagg)) {
      const [a, b] = k.split('\u0000').map(vis);
      if (a === b) continue;
      const id = `${a}>${b}`;
      es[id] = es[id] ? { ...es[id], weight: es[id].weight + w } : { id, source: a, target: b, weight: w };
    }
    const el = Object.values(es).map((e) => ({ ...e, label: e.weight > 1 ? String(e.weight) : undefined }));
    return { nodes: ns, edges: el, cut: hidden.size };
  }, [built, fileMode, ix, view, routes, full]);

  if (!allRoutes.length) return null;
  return (
    <div>
      {routeFiles.length > 1 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap text-[12px]">
          <span className="text-mist mr-0.5">Маршруты:</span>
          {[['', `все (${allRoutes.length})`], ...routeFiles.map(([f, n]) => [f, `${f.split('/').pop()} (${n})`])].map(([f, t]) => (
            <button key={f || 'all'} onClick={() => { setOnly(f); setFull(false); }} title={f || 'все файлы с маршрутами'} className={`px-2 py-0.5 rounded-md border font-mono text-[11.5px] ${only === f ? 'border-bronze text-bronze' : 'border-hairline text-mist hover:text-stone'}`}>{t}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mb-2 flex-wrap text-[12px]">
        <span className="text-mist">Блоки:</span>
        {[[false, 'функции'], [true, 'файлы']].map(([v, t]) => (
          <button key={t} onClick={() => setByFile(v)} className={`px-2.5 py-1 rounded-md border ${fileMode === v ? 'border-bronze text-bronze' : 'border-hairline text-mist hover:text-stone'}`}>{t}</button>
        ))}
        {cut > 0 && <span className="text-mist-dim">показаны самые связанные, остальное — в блоках «ещё N»{!only && routeFiles.length > 1 ? '. Выбери один файл маршрутов выше — схема станет проще' : ''}</span>}
        {full && <button className="btn-ghost text-[12px]" onClick={() => setFull(false)}>Снова только главные</button>}
      </div>
      <Graph
        nodes={nodes} edges={edges} lanes={LANES} height={nodes.length > 16 ? 680 : 480} name={`${view.title} — как проходят запросы`}
        onNodeClick={(n) => {
          if (n.id.startsWith('more:')) setFull(true);
          else if (n.id.startsWith('r:')) dispatch(go({ t: 'scenarios' }));
          else if (n.id.startsWith('F:')) dispatch(go({ t: 'file', file: n.id.split(':').slice(2).join(':') }));
          else dispatch(go({ t: 'fn', id: n.id }));
        }}
        emptyText="Маршрутов нет."
      />
      <div className="text-[12px] text-mist-dim mt-2 leading-relaxed">
        Запрос идёт слева направо: файл с маршрутами → промежуточные обработчики и проверки → обработчик → логика (сервисы) → хранилище → данные.
        Колонку для каждой функции разбор определяет по её месту в проекте (папка, имя, как подключена), поэтому иногда может ошибиться.
        Нажми на блок, чтобы открыть его; полный путь отдельного запроса — в «Сценариях».
      </div>
    </div>
  );
}
