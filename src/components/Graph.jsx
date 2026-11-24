// Диаграмма «блоки и стрелки». Раскладку считает ELK (elkjs, алгоритм layered):
// блоки встают в ряды так, чтобы стрелки шли в одну сторону и меньше пересекались.
// Рисуем сами в SVG; колесо — масштаб, перетаскивание — сдвиг.
// Для читаемости: наведение выделяет связи блока (кто вызывает — синим, кого вызывает —
// бронзой), под именем — фраза простыми словами, легенда всегда на виду, мини-карта для
// больших схем, дорожки (колонки по ролям), сохранение картинкой.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ELK from 'elkjs/lib/elk.bundled.js';
import { saveSvg } from './exportImage';

const elk = new ELK();

const MIN_READABLE = 0.62;
const LABEL_FONT = 13;
const SUB_FONT = 11;
const NOTE_FONT = 11.5;
const NOTE_LINE = 15;
const LANE_HEAD = 34;
const C = { in: '#7FA7C9', out: '#B98D55', edge: '#4A544D', arrow: '#5C6660', bg: '#0E1310' };

const baseWidth = (n) => Math.min(300, Math.max(n.minWidth || 110, Math.max(n.label.length * 7.6, (n.sub || '').length * 6.3) + 30));
const nodeWidth = (n) => (n.note ? Math.min(300, Math.max(baseWidth(n), 220)) : baseWidth(n));
/** Фраза под именем — не больше двух строк. */
function noteLines(n) {
  if (!n.note) return [];
  const max = Math.floor((nodeWidth(n) - 26) / 6.1);
  const words = String(n.note).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if (`${cur} ${w}`.length <= max) lines[lines.length - 1] = `${cur} ${w}`;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1].slice(0, max - 1)}…`; return lines; }
  }
  return lines.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
}
const nodeHeight = (n) => (n.sub ? 54 : 36) + (n.note ? noteLines(n).length * NOTE_LINE + 2 : 0);

function pathOf(section) {
  const pts = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
  // скругляем углы ломаной
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    if (!next) { d += ` L ${p.x} ${p.y}`; break; }
    const r = Math.min(10, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const a = { x: p.x - Math.sign(p.x - prev.x) * r, y: p.y - Math.sign(p.y - prev.y) * r };
    const b = { x: p.x + Math.sign(next.x - p.x) * r, y: p.y + Math.sign(next.y - p.y) * r };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  return d;
}

/** Подпись стрелки — посередине самого длинного её отрезка. */
function midLabel(e, text) {
  const s = e.sections?.[0];
  if (!s) return null;
  const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint];
  let best = null, len = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > len) { len = l; best = [pts[i - 1], pts[i]]; }
  }
  const w = String(text).length * 7 + 10;
  return { text, width: w, height: 16, x: (best[0].x + best[1].x) / 2 - w / 2, y: (best[0].y + best[1].y) / 2 - 8 };
}

// виды связей для легенды
const KINDS = [
  ['call', undefined, 'вызов'],
  ['ref', '5 4', 'передаётся (вызовут позже)'],
  ['dispatch', '9 4', 'одна из (зависит от данных)'],
  ['guess', '2 4', 'догадка'],
];

function Legend({ edges, weighted, lanes }) {
  const kinds = new Set(edges.map((e) => e.kind || 'call'));
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 px-1 text-[10.5px] text-mist">
      {KINDS.filter(([k]) => k === 'call' || kinds.has(k)).map(([k, dash, label]) => (
        <span key={k} className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#8A93A6" strokeWidth="1.6" strokeDasharray={dash} /></svg>{label}
        </span>
      ))}
      {weighted && <span className="flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#8A93A6" strokeWidth="3.6" /></svg>толще — больше вызовов</span>}
      <span>наведи на блок: <b style={{ color: C.in }} className="font-medium">синие</b> — кто к нему обращается, <b style={{ color: C.out }} className="font-medium">бронзовые</b> — к кому обращается он</span>
      {lanes && <span>колонки — роли: слева направо по пути запроса</span>}
      <span className="text-mist-dim">колесо — масштаб · перетаскивание — сдвиг</span>
    </div>
  );
}

/**
 * nodes: [{ id, label, sub?, note?, color?, emphasis?: 'center'|'ghost'|'cluster', lane?, title?, mono? }]
 *   note — пояснение простыми словами под именем; lane — номер колонки (вместе с lanes)
 * edges: [{ id, source, target, label?, weight?, kind?, dash?, dashed?, hl? }]
 *   kind — вид связи (call/ref/dispatch/guess) для легенды; hl — подсветить (например, путь A → B)
 * lanes: ['Маршрут', 'Проверки', …] — колонки с подписями
 * name — имя файла при сохранении картинкой
 */
export default function Graph({ nodes, edges, direction = 'RIGHT', height = 420, onNodeClick, onEdgeClick, selectedEdge, emptyText = 'Связей нет.', lanes = null, name = 'схема', legend = true }) {
  const [laid, setLaid] = useState(null); // { key, res } — раскладка и то, для какой схемы она посчитана
  const [err, setErr] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMenu, setSaveMenu] = useState(false);
  const [saved, setSaved] = useState('');
  const [, setBoxSize] = useState(0);
  const box = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const offY = lanes ? LANE_HEAD : 0;

  const key = useMemo(() => JSON.stringify([nodes.map((n) => [n.id, n.label, n.sub, n.note, n.lane]), edges.map((e) => [e.id, e.source, e.target, e.label]), direction, lanes]), [nodes, edges, direction, lanes]);
  // Раскладка считается асинхронно. Пока считается новая, старую не рисуем: в ней другие
  // блоки и стрелки (раньше из-за этого падал весь интерфейс при быстрой смене схемы).
  const layout = laid && laid.key === key ? laid.res : null;
  const W = layout ? layout.width : 1;
  const H = layout ? layout.height + offY : 1;

  useEffect(() => {
    let alive = true;
    setErr(null);
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': lanes ? '90' : '80',
        'elk.spacing.nodeNode': '26',
        'elk.spacing.edgeNode': '18',
        'elk.spacing.edgeEdge': '12',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.edgeLabels.inline': 'false',
        // колонки: каждый блок — как можно левее в своей колонке, чтобы колонки были узкими
        ...(lanes ? { 'elk.partitioning.activate': 'true', 'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE' } : {}),
      },
      children: nodes.map((n) => ({
        id: n.id, width: nodeWidth(n), height: nodeHeight(n),
        ...(lanes ? { layoutOptions: { 'elk.partitioning.partition': String(n.lane ?? lanes.length - 1) } } : {}),
      })),
      edges: edges.map((e) => ({
        id: e.id, sources: [e.source], targets: [e.target],
        // в колонках подписи стрелок ставим сами: у ELK они занимают свой ряд и раздвигают колонки
        labels: e.label && !lanes ? [{ text: e.label, width: String(e.label).length * 7 + 10, height: 16 }] : [],
      })),
    };
    setHover(null);
    elk.layout(graph).then((res) => { if (alive) setLaid({ key, res }); }).catch((e) => { if (alive) setErr(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fit = useCallback(() => {
    if (!layout || !box.current) return;
    const bw = box.current.clientWidth, bh = box.current.clientHeight, pad = 28, top = 46; // сверху — кнопки
    const fitK = Math.min(1.15, (bw - pad * 2) / Math.max(1, W), (bh - pad - top) / Math.max(1, H));
    // мельче читаемого не уменьшаем: большую схему лучше подвигать, чем разглядывать
    const k = Math.max(fitK, MIN_READABLE);
    setView({
      k,
      x: W * k <= bw - pad * 2 ? (bw - W * k) / 2 : pad,
      y: H * k <= bh - pad - top ? Math.max(top, (bh - H * k) / 2) : top,
    });
  }, [layout, W, H]);
  useEffect(() => { fit(); }, [fit, expanded]);
  // окно или колонка поменяли ширину — подгоняем заново, пока пользователь сам не двигал схему
  const touched = useRef(false);
  useEffect(() => { touched.current = false; }, [layout, expanded]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { setBoxSize(el.clientWidth * 10000 + el.clientHeight); if (!touched.current) fit(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, expanded]);

  function onWheel(e) {
    touched.current = true;
    const r = box.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  }
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const h = (e) => { if (e.target.closest('[data-minimap]')) return; e.preventDefault(); onWheel(e); };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  });

  const zoom = (f) => {
    touched.current = true;
    const cx = box.current.clientWidth / 2, cy = box.current.clientHeight / 2;
    setView((v) => { const k = Math.min(3, Math.max(0.15, v.k * f)); return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }; });
  };

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeById = useMemo(() => Object.fromEntries(edges.map((e) => [e.id, e])), [edges]);
  const maxW = Math.max(1, ...edges.map((e) => e.weight || 1));
  const anyHl = edges.some((e) => e.hl);
  const hlNodes = useMemo(() => new Set(edges.filter((e) => e.hl).flatMap((e) => [e.source, e.target])), [edges]);
  const inOf = hover ? edges.filter((e) => e.target === hover && e.source !== hover) : [];
  const outOf = hover ? edges.filter((e) => e.source === hover && e.target !== hover) : [];
  const related = (id) => id === hover || inOf.some((e) => e.source === id) || outOf.some((e) => e.target === id);

  // колонки-дорожки: ширина по блокам, которые в них попали
  const bands = useMemo(() => {
    if (!lanes || !layout) return [];
    const by = {};
    for (const c of layout.children) {
      const lane = byId[c.id]?.lane ?? lanes.length - 1;
      const b = (by[lane] ||= { lane, x0: Infinity, x1: -Infinity });
      b.x0 = Math.min(b.x0, c.x); b.x1 = Math.max(b.x1, c.x + c.width);
    }
    return Object.values(by).sort((a, b) => a.lane - b.lane);
  }, [lanes, layout, byId]);

  // ---- сохранение картинкой: вся схема целиком, без масштаба и выделения
  async function save(ext) {
    setSaveMenu(false);
    if (!svgRef.current || !layout) return;
    setSaving(true); setSaved('');
    try {
      const file = await saveSvg(svgRef.current, {
        width: W, height: H, name, ext, bg: C.bg,
        prepare: (clone, pad) => {
          const root = clone.querySelector('[data-root]');
          root.setAttribute('transform', `translate(${pad},${pad})`);
          root.querySelectorAll('[opacity]').forEach((n) => n.setAttribute('opacity', '1'));
        },
      });
      if (file) setSaved(`Сохранено: ${file}`);
    } catch (e) { setSaved(`Не получилось сохранить: ${e.message}`); } finally { setSaving(false); }
  }

  // ---- мини-карта: где мы на большой схеме
  const bw = box.current?.clientWidth || 0, bh = box.current?.clientHeight || 0;
  const big = layout && (W * view.k > bw + 4 || H * view.k > bh + 4);
  const mmS = Math.min(160 / W, 110 / H);
  const mmW = W * mmS, mmH = H * mmS;
  const moveTo = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / mmS, py = (e.clientY - r.top) / mmS;
    touched.current = true;
    setView((v) => ({ ...v, x: bw / 2 - px * v.k, y: bh / 2 - py * v.k }));
  };

  const hoverNode = hover && byId[hover];
  const body = (
    <div
      ref={box}
      className={`overflow-hidden select-none border border-hairline-soft ${expanded ? 'relative w-full h-full rounded-2xl shadow-2xl bg-rail-bg' : 'relative rounded-xl bg-rail-bg/70'}`}
      style={expanded ? undefined : { height }}
      onPointerDown={(e) => { if (e.button === 0 && !e.target.closest('[data-hit]')) { drag.current = { x: e.clientX, y: e.clientY, v: view }; touched.current = true; e.currentTarget.setPointerCapture(e.pointerId); setSaveMenu(false); } }}
      onPointerMove={(e) => { const d = drag.current; if (d) setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y }); }}
      onPointerUp={() => { drag.current = null; }}
    >
      {!nodes.length ? <div className="absolute inset-0 flex items-center justify-center text-[13px] text-mist-dim">{emptyText}</div>
        : err ? <div className="p-4 text-danger-soft text-[13px]">Не удалось нарисовать схему: {err}</div>
          : !layout ? <div className="absolute inset-0 flex items-center justify-center text-[13px] text-mist-dim">Рисую схему…</div> : (
            <svg ref={svgRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
              <defs>
                {[['arr', C.arrow], ['arr-out', C.out], ['arr-in', C.in]].map(([id, fill]) => (
                  <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
                  </marker>
                ))}
              </defs>
              <g data-root transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {bands.map((b, i) => (
                  <g key={`band${b.lane}`}>
                    <rect x={b.x0 - 14} y={0} width={b.x1 - b.x0 + 28} height={H} rx="12" fill={i % 2 ? '#141A16' : '#121815'} stroke="#1F2722" />
                    <text x={(b.x0 + b.x1) / 2} y={21} textAnchor="middle" fontSize="12" fontFamily="Inter, sans-serif" fontWeight="600" letterSpacing="0.6" fill="#8A93A6">{String(lanes[b.lane] || '').toUpperCase()}</text>
                  </g>
                ))}
                <g transform={`translate(0,${offY})`}>
                  {layout.edges.map((e) => {
                    const src = edgeById[e.id];
                    if (!src) return null;
                    const out = hover && src.source === hover, inn = hover && src.target === hover;
                    const sel = selectedEdge === e.id || (!hover && src.hl);
                    const color = out ? C.out : inn ? C.in : sel ? C.out : C.edge;
                    const marker = out || sel ? 'arr-out' : inn ? 'arr-in' : 'arr';
                    const dim = hover ? !(out || inn) : anyHl && !src.hl;
                    const w = (out || inn || sel ? 0.6 : 0) + 1.2 + 2.6 * ((src.weight || 1) / maxW);
                    return (
                      <g key={e.id} opacity={dim ? 0.18 : 1}>
                        {e.sections?.map((s, i) => (
                          <g key={i}>
                            <path d={pathOf(s)} fill="none" stroke={color} strokeWidth={w} strokeDasharray={src.dash || (src.dashed ? '5 4' : undefined)} markerEnd={`url(#${marker})`} />
                            {onEdgeClick && <path data-hit data-noexport d={pathOf(s)} fill="none" stroke="transparent" strokeWidth="12" className="cursor-pointer" onClick={() => onEdgeClick(src)} />}
                          </g>
                        ))}
                        {(lanes && src.label ? [midLabel(e, src.label)].filter(Boolean) : e.labels || []).map((l, i) => (
                          <g key={`l${i}`} data-hit className={onEdgeClick ? 'cursor-pointer' : ''} onClick={() => onEdgeClick?.(src)}>
                            <rect x={l.x - 2} y={l.y - 1} width={l.width + 4} height={l.height + 2} rx="4" fill="#111713" stroke={color === C.edge ? '#2A332C' : color} />
                            <text x={l.x + l.width / 2 + 2} y={l.y + 12} textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono, monospace" fill={color === C.edge ? '#8A93A6' : color}>{l.text}</text>
                          </g>
                        ))}
                      </g>
                    );
                  })}
                  {layout.children.map((c) => {
                    const n = byId[c.id];
                    if (!n) return null;
                    const center = n.emphasis === 'center';
                    const ghost = n.emphasis === 'ghost';
                    const cluster = n.emphasis === 'cluster';
                    const dim = hover ? !related(c.id) : anyHl && !hlNodes.has(c.id) && !center;
                    const isIn = hover && hover !== c.id && inOf.some((e) => e.source === c.id);
                    const isOut = hover && hover !== c.id && outOf.some((e) => e.target === c.id);
                    const stroke = center ? C.out : isIn ? C.in : isOut ? C.out : hover === c.id ? '#D6D9DD' : (anyHl && hlNodes.has(c.id)) ? C.out : '#2A332C';
                    const lines = noteLines(n);
                    const top = n.sub ? 54 : 36;
                    return (
                      <g
                        key={c.id} data-hit transform={`translate(${c.x},${c.y})`} opacity={dim ? 0.3 : 1}
                        className={onNodeClick ? 'cursor-pointer' : ''}
                        onClick={() => onNodeClick?.(n)}
                        onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}
                      >
                        <rect width={c.width} height={c.height} rx="10" fill={center ? '#1C231E' : ghost || cluster ? '#111713' : '#161C18'}
                          stroke={stroke} strokeWidth={center || isIn || isOut ? 1.6 : 1} strokeDasharray={ghost || cluster ? '4 3' : undefined} />
                        {!cluster && <rect width="4" height={c.height - 12} x="0" y="6" rx="2" fill={n.color || '#5C6660'} />}
                        <text x="14" y={n.sub ? 22 : 23} fontSize={LABEL_FONT} fontFamily={n.mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif'} fontWeight="500" fill={ghost || cluster ? '#8A93A6' : '#D6D9DD'}>
                          {n.label.length > 36 ? `${n.label.slice(0, 35)}…` : n.label}
                        </text>
                        {n.sub && <text x="14" y="40" fontSize={SUB_FONT} fontFamily="JetBrains Mono, monospace" fill="#6B756F">{n.sub.length > 42 ? `${n.sub.slice(0, 41)}…` : n.sub}</text>}
                        {lines.length > 0 && <line x1="14" x2={c.width - 12} y1={top - 6} y2={top - 6} stroke="#222A25" />}
                        {lines.map((l, i) => <text key={i} x="14" y={top + 6 + i * NOTE_LINE} fontSize={NOTE_FONT} fontFamily="Inter, sans-serif" fill="#A3AAA5">{l}</text>)}
                        <title>{n.title || n.label}</title>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>
          )}
      {hoverNode && (
        <div className="absolute left-2.5 top-2.5 max-w-[60%] px-2.5 py-1.5 rounded-lg bg-panel/95 border border-hairline text-[11.5px] pointer-events-none">
          <span className="font-medium text-stone">{hoverNode.label}</span>
          <span className="text-mist"> · </span><span style={{ color: C.in }}>к нему обращаются: {new Set(inOf.map((e) => e.source)).size}</span>
          <span className="text-mist"> · </span><span style={{ color: C.out }}>он обращается к: {new Set(outOf.map((e) => e.target)).size}</span>
        </div>
      )}
      <div className="absolute right-2.5 top-2.5 flex gap-1" data-hit>
        {[['+', () => zoom(1.25), 'Крупнее'], ['−', () => zoom(0.8), 'Мельче'], ['⤢', fit, 'Вписать'], ['⤓', () => setSaveMenu((x) => !x), 'Сохранить картинкой'], [expanded ? '✕' : '⛶', () => setExpanded((x) => !x), expanded ? 'Свернуть' : 'На весь экран']].map(([t, fn, title]) => (
          <button key={title} type="button" onClick={fn} title={title} aria-label={title} disabled={title === 'Сохранить картинкой' && (!layout || saving)}
            className="w-7 h-7 rounded-md bg-panel border border-hairline text-mist hover:text-stone hover:border-mist-dim text-[13px] leading-none disabled:opacity-40">{t}</button>
        ))}
        {saveMenu && (
          <div className="absolute right-8 top-8 z-10 card rounded-lg py-1 w-[230px] shadow-2xl">
            <button className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-panel-2" onClick={() => save('png')}>Картинка PNG<div className="text-[11px] text-mist-dim">откроется где угодно, вставляется в отчёт</div></button>
            <button className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-panel-2" onClick={() => save('svg')}>Векторная SVG<div className="text-[11px] text-mist-dim">не теряет чёткость при увеличении</div></button>
          </div>
        )}
      </div>
      {saved && <div data-hit className="absolute right-2.5 top-11 max-w-[60%] px-2.5 py-1 rounded-md bg-panel/95 border border-hairline text-[11px] text-mist break-all cursor-pointer" onClick={() => setSaved('')} title="Скрыть">{saved}</div>}
      {big && (
        <svg data-hit data-minimap width={mmW + 2} height={mmH + 2} className="absolute right-2.5 bottom-2.5 rounded-md bg-panel/90 border border-hairline cursor-pointer"
          onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); moveTo(e); }}
          onPointerMove={(e) => { if (e.buttons) moveTo(e); }}>
          <g transform="translate(1,1)">
            {layout.children.map((c) => <rect key={c.id} x={c.x * mmS} y={(c.y + offY) * mmS} width={Math.max(2, c.width * mmS)} height={Math.max(2, c.height * mmS)} rx="1.5" fill={byId[c.id]?.emphasis === 'center' ? C.out : '#3A443D'} />)}
            <rect x={(-view.x / view.k) * mmS} y={(-view.y / view.k) * mmS} width={(bw / view.k) * mmS} height={(bh / view.k) * mmS} fill="rgba(185,141,85,0.08)" stroke={C.out} strokeWidth="1" />
          </g>
        </svg>
      )}
    </div>
  );
  const legendRow = legend && nodes.length > 0 ? <Legend edges={edges} weighted={maxW > 1} lanes={Boolean(lanes)} /> : null;
  // развёрнутая схема — поверх всего окна, включая левую панель
  return expanded
    ? <>{createPortal(<><div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setExpanded(false)} /><div className="fixed inset-6 z-[70] flex flex-col"><div className="flex-1 min-h-0">{body}</div><div className="bg-panel rounded-xl mt-2 px-2 py-1">{legendRow}</div></div></>, document.body)}<div style={{ height }} /></>
    : <>{body}{legendRow}</>;
}
