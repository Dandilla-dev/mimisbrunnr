// Диаграмма «блоки и стрелки». Раскладку считает ELK (elkjs, алгоритм layered):
// блоки встают в ряды так, чтобы стрелки шли в одну сторону и меньше пересекались.
// Рисуем сами в SVG; колесо — масштаб, перетаскивание — сдвиг.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

const MIN_READABLE = 0.62;
const LABEL_FONT = 13;
const SUB_FONT = 11;
const nodeWidth = (n) => Math.min(300, Math.max(n.minWidth || 110, Math.max(n.label.length * 7.6, (n.sub || '').length * 6.3) + 30));
const nodeHeight = (n) => (n.sub ? 54 : 36);

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

/**
 * nodes: [{ id, label, sub?, color?, emphasis?: 'center'|'ghost' }]
 * edges: [{ id, source, target, label?, weight? }]
 */
export default function Graph({ nodes, edges, direction = 'RIGHT', height = 420, onNodeClick, onEdgeClick, selectedEdge, emptyText = 'Связей нет.' }) {
  const [layout, setLayout] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const drag = useRef(null);

  const key = useMemo(() => JSON.stringify([nodes.map((n) => [n.id, n.label, n.sub]), edges.map((e) => [e.source, e.target, e.label]), direction]), [nodes, edges, direction]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '26',
        'elk.spacing.edgeNode': '18',
        'elk.spacing.edgeEdge': '12',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.edgeLabels.inline': 'false',
      },
      children: nodes.map((n) => ({ id: n.id, width: nodeWidth(n), height: nodeHeight(n) })),
      edges: edges.map((e) => ({
        id: e.id, sources: [e.source], targets: [e.target],
        labels: e.label ? [{ text: e.label, width: String(e.label).length * 7 + 10, height: 16 }] : [],
      })),
    };
    elk.layout(graph).then((res) => { if (alive) setLayout(res); }).catch((e) => { if (alive) setErr(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fit = useCallback(() => {
    if (!layout || !box.current) return;
    const W = box.current.clientWidth, H = box.current.clientHeight, pad = 28;
    const fitK = Math.min(1.15, (W - pad * 2) / Math.max(1, layout.width), (H - pad * 2) / Math.max(1, layout.height));
    // мельче читаемого не уменьшаем: большую схему лучше подвигать, чем разглядывать
    const k = Math.max(fitK, MIN_READABLE);
    setView({
      k,
      x: layout.width * k <= W - pad * 2 ? (W - layout.width * k) / 2 : pad,
      y: layout.height * k <= H - pad * 2 ? (H - layout.height * k) / 2 : pad,
    });
  }, [layout]);
  useEffect(() => { fit(); }, [fit, expanded]);
  // окно или колонка поменяли ширину — подгоняем заново, пока пользователь сам не двигал схему
  const touched = useRef(false);
  useEffect(() => { touched.current = false; }, [layout, expanded]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (!touched.current) fit(); });
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
    const h = (e) => { e.preventDefault(); onWheel(e); };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  });

  const zoom = (f) => {
    touched.current = true;
    const W = box.current.clientWidth / 2, H = box.current.clientHeight / 2;
    setView((v) => { const k = Math.min(3, Math.max(0.15, v.k * f)); return { k, x: W - ((W - v.x) * k) / v.k, y: H - ((H - v.y) * k) / v.k }; });
  };

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const maxW = Math.max(1, ...edges.map((e) => e.weight || 1));
  const related = (id) => hover && (id === hover || edges.some((e) => (e.source === hover && e.target === id) || (e.target === hover && e.source === id)));

  const body = (
    <div
      ref={box}
      className={`overflow-hidden select-none border border-hairline-soft ${expanded ? 'relative w-full h-full rounded-2xl shadow-2xl bg-rail-bg' : 'relative rounded-xl bg-rail-bg/70'}`}
      style={expanded ? undefined : { height }}
      onPointerDown={(e) => { if (e.button === 0 && !e.target.closest('[data-hit]')) { drag.current = { x: e.clientX, y: e.clientY, v: view }; touched.current = true; e.currentTarget.setPointerCapture(e.pointerId); } }}
      onPointerMove={(e) => { const d = drag.current; if (d) setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y }); }}
      onPointerUp={() => { drag.current = null; }}
    >
      {!nodes.length ? <div className="absolute inset-0 flex items-center justify-center text-[13px] text-mist-dim">{emptyText}</div>
        : err ? <div className="p-4 text-danger-soft text-[13px]">Не удалось нарисовать схему: {err}</div>
          : !layout ? <div className="absolute inset-0 flex items-center justify-center text-[13px] text-mist-dim">Рисую схему…</div> : (
            <svg className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
              <defs>
                <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#5C6660" />
                </marker>
                <marker id="arr-on" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#B98D55" />
                </marker>
              </defs>
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {layout.edges.map((e) => {
                  const src = edges.find((x) => x.id === e.id);
                  const on = selectedEdge === e.id || (hover && (src.source === hover || src.target === hover));
                  const dim = hover && !on;
                  const w = 1.2 + 2.4 * ((src.weight || 1) / maxW);
                  return (
                    <g key={e.id} opacity={dim ? 0.25 : 1}>
                      {e.sections?.map((s, i) => (
                        <g key={i}>
                          <path d={pathOf(s)} fill="none" stroke={on ? '#B98D55' : '#4A544D'} strokeWidth={w} markerEnd={`url(#${on ? 'arr-on' : 'arr'})`} />
                          {onEdgeClick && <path data-hit d={pathOf(s)} fill="none" stroke="transparent" strokeWidth="12" className="cursor-pointer" onClick={() => onEdgeClick(src)} />}
                        </g>
                      ))}
                      {e.labels?.map((l, i) => (
                        <g key={`l${i}`} data-hit className={onEdgeClick ? 'cursor-pointer' : ''} onClick={() => onEdgeClick?.(src)}>
                          <rect x={l.x - 2} y={l.y - 1} width={l.width + 4} height={l.height + 2} rx="4" fill="#111713" stroke={on ? '#B98D55' : '#2A332C'} />
                          <text x={l.x + l.width / 2 + 2} y={l.y + 12} textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono, monospace" fill={on ? '#B98D55' : '#8A93A6'}>{l.text}</text>
                        </g>
                      ))}
                    </g>
                  );
                })}
                {layout.children.map((c) => {
                  const n = byId[c.id];
                  const center = n.emphasis === 'center';
                  const ghost = n.emphasis === 'ghost';
                  const dim = hover && !related(c.id);
                  return (
                    <g
                      key={c.id} data-hit transform={`translate(${c.x},${c.y})`} opacity={dim ? 0.35 : 1}
                      className={onNodeClick ? 'cursor-pointer' : ''}
                      onClick={() => onNodeClick?.(n)}
                      onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(null)}
                    >
                      <rect width={c.width} height={c.height} rx="10" fill={center ? '#1C231E' : ghost ? '#111713' : '#161C18'}
                        stroke={center ? '#B98D55' : hover === c.id ? '#8A93A6' : '#2A332C'} strokeWidth={center ? 1.6 : 1} strokeDasharray={ghost ? '4 3' : undefined} />
                      <rect width="4" height={c.height - 12} x="0" y="6" rx="2" fill={n.color || '#5C6660'} />
                      <text x="14" y={n.sub ? 22 : 23} fontSize={LABEL_FONT} fontFamily={n.mono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif'} fontWeight="500" fill={ghost ? '#8A93A6' : '#D6D9DD'}>
                        {n.label.length > 36 ? `${n.label.slice(0, 35)}…` : n.label}
                      </text>
                      {n.sub && <text x="14" y="40" fontSize={SUB_FONT} fontFamily="JetBrains Mono, monospace" fill="#5C6660">{n.sub.length > 42 ? `${n.sub.slice(0, 41)}…` : n.sub}</text>}
                      <title>{n.title || n.label}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
      <div className="absolute right-2.5 top-2.5 flex gap-1" data-hit>
        {[['+', () => zoom(1.25), 'Крупнее'], ['−', () => zoom(0.8), 'Мельче'], ['⤢', fit, 'Вписать'], [expanded ? '✕' : '⛶', () => setExpanded((x) => !x), expanded ? 'Свернуть' : 'На весь экран']].map(([t, fn, title]) => (
          <button key={title} type="button" onClick={fn} title={title} aria-label={title}
            className="w-7 h-7 rounded-md bg-panel border border-hairline text-mist hover:text-stone hover:border-mist-dim text-[13px] leading-none">{t}</button>
        ))}
      </div>
      <div className="absolute left-3 bottom-2 font-mono text-[10px] text-mist-dim pointer-events-none">колесо — масштаб · перетаскивание — сдвиг</div>
    </div>
  );
  // развёрнутая схема — поверх всего окна, включая левую панель
  return expanded
    ? <>{createPortal(<><div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setExpanded(false)} /><div className="fixed inset-6 z-[70]">{body}</div></>, document.body)}<div style={{ height }} /></>
    : body;
}
