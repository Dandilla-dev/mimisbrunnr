// Три уровня схемы взаимодействия:
// 1) проект — слои и сколько вызовов идёт между ними;
// 2) слой — его файлы, связи между ними и с соседними слоями;
// 3) функция — кто её вызывает и кого вызывает она (на 1–2 шага).
import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { go } from '../../app/store';
import Graph from '../../components/Graph';
import { layerColor } from './MapColumn';

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
      return { id: l.id, label: l.name, sub: `${st.files} файл. · ${st.items} функц. · внутри ${inside[l.id] || 0} св.`, color: layerColor(view, l.id), title: l.description || l.name };
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
        nodes={nodes} edges={edges} height={400} selectedEdge={sel?.id}
        onNodeClick={(n) => dispatch(go({ t: 'layer', id: n.id }))}
        onEdgeClick={(e) => setSel(e)}
        emptyText="Связей между частями проекта не найдено."
      />
      <div className="text-[12px] text-mist-dim mt-2">Блоки — части проекта, число на стрелке — сколько вызовов идёт из одной части в другую. Нажми на блок, чтобы открыть часть, на стрелку — чтобы увидеть сами вызовы.</div>
      <EdgeDetails ix={ix} edge={sel} title={sel ? `${name(sel.source)} → ${name(sel.target)}` : ''} onClose={() => setSel(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- 2. слой
export function LayerDiagram({ view, ix, layerId }) {
  const dispatch = useDispatch();
  const [sel, setSel] = useState(null);
  const [all, setAll] = useState(false);
  const { nodes, edges, hubs } = useMemo(() => {
    const files = (ix.filesByLayer[layerId] || []).map((f) => f.path);
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
      const ia = inLayer.has(fa), ib = inLayer.has(fb);
      if (!ia && !ib) continue;
      const s = ia ? `f:${fa}` : `l:${ix.fileByPath[fa].layer}`;
      const t = ib ? `f:${fb}` : `l:${ix.fileByPath[fb].layer}`;
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
    const ns = files.map((f) => ({
      id: `f:${f}`, label: f.slice(prefix.length),
      sub: hubSet.has(`f:${f}`) && !all ? `общий · используют ${usersOf[`f:${f}`].size} файлов` : `${(ix.itemsByFile[f] || []).length} функц. · ${ix.fileByPath[f].lines} стр.`,
      color: layerColor(view, layerId), mono: true, title: ix.fileByPath[f].purpose || f,
    }));
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
  }, [view, ix, layerId, all]);
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
        nodes={nodes} edges={edges} height={nodes.length > 12 ? 600 : 440} selectedEdge={sel?.id}
        onNodeClick={(n) => dispatch(go(n.id.startsWith('f:') ? { t: 'file', file: n.id.slice(2) } : { t: 'layer', id: n.id.slice(2) }))}
        onEdgeClick={(e) => setSel(e)}
        emptyText="В этой части нет файлов."
      />
      <div className="text-[12px] text-mist-dim mt-2">Блоки — файлы этой части, пунктиром — соседние части. Число на стрелке — сколько вызовов идёт между ними.</div>
      <EdgeDetails ix={ix} edge={sel} title={sel ? `${label(sel.source)} → ${label(sel.target)}` : ''} onClose={() => setSel(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- 3. функция
const PER_SIDE = 14;

export function FnDiagram({ view, ix, id }) {
  const dispatch = useDispatch();
  const [depth, setDepth] = useState(1);
  const { nodes, edges, cut } = useMemo(() => {
    const set = new Set([id]);
    let cutCount = 0;
    const walkSide = (map) => {
      let frontier = [id];
      for (let d = 0; d < depth; d++) {
        const next = [];
        for (const x of frontier) {
          for (const y of map[x] || []) {
            if (set.has(y)) continue;
            if (next.length >= PER_SIDE * (d + 1)) { cutCount += 1; continue; }
            set.add(y); next.push(y);
          }
        }
        frontier = next;
      }
    };
    walkSide(ix.callers);
    walkSide(ix.calls);
    const ns = [...set].map((x) => {
      const it = ix.itemById[x];
      return { id: x, label: it.name, sub: `${it.file.split('/').pop()}:${it.line}`, mono: true, color: layerColor(view, ix.fileByPath[it.file]?.layer), emphasis: x === id ? 'center' : undefined, title: it.phrase || it.name };
    });
    const es = view.edges.filter(([a, b]) => set.has(a) && set.has(b) && (depth > 1 || a === id || b === id))
      .map(([a, b, k]) => ({ id: `${a}>${b}`, source: a, target: b, dashed: k === 'ref' }));
    return { nodes: ns, edges: es, cut: cutCount };
  }, [view, ix, id, depth]);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] text-mist">Глубина:</span>
        {[1, 2].map((d) => (
          <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-1 rounded-md text-[12px] border ${depth === d ? 'border-bronze text-bronze' : 'border-hairline text-mist hover:text-stone'}`}>{d === 1 ? '1 шаг' : '2 шага'}</button>
        ))}
        {cut > 0 && <span className="text-[11.5px] text-mist-dim">показаны не все связи: {cut} скрыто</span>}
      </div>
      <Graph
        nodes={nodes} edges={edges} height={nodes.length > 12 ? 420 : 300}
        onNodeClick={(n) => { if (n.id !== id) dispatch(go({ t: 'fn', id: n.id })); }}
        emptyText="Связей нет."
      />
      <div className="text-[12px] text-mist-dim mt-2">Слева — кто вызывает эту функцию, справа — кого вызывает она. Пунктир — функция не вызывается, а передаётся (например, в onClick или аргументом): её вызовут позже. Цвет полоски — часть проекта.</div>
    </div>
  );
}
