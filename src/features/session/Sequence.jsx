// Диаграмма последовательности для сценария: вверху — участники (клиент, фреймворк,
// классы и файлы), вниз идут шаги по порядку — стрелка от того, кто вызывает, к тому,
// кого вызывают. Так рисуют путь запроса в учебниках.
import { useMemo, useRef, useState } from 'react';
import { ROLE_RU } from '../../../core/scenario.js';
import { linkOf } from './linkKinds';
import { saveSvg } from '../../components/exportImage';

const COL = 176;
const HEAD = 64;
const ROW = 36;
const FW = { express: 'Express', fastify: 'Fastify', nest: 'NestJS', fastapi: 'FastAPI', flask: 'Flask' };
const C = { line: '#2A332C', arrow: '#8A93A6', on: '#B98D55', back: '#7FA08A', err: '#D98787', text: '#D6D9DD', mist: '#8A93A6', dim: '#5C6660' };

function participantOf(step, it, route) {
  if (step.synthetic) {
    if (step.role === 'request' || step.role === 'response') return { key: 'client', label: 'Клиент', sub: 'браузер или приложение', order: 0 };
    return { key: 'fw', label: FW[route?.fw] || 'Фреймворк', sub: 'встроенное', order: 1 };
  }
  const cls = it.kind === 'method' || (it.name.includes('.') && it.kind !== 'class') ? it.name.split('.').slice(0, -1).join('.') : '';
  const file = it.file.split('/').pop();
  return cls ? { key: `${it.file}::${cls}`, label: cls, sub: file, order: 2 } : { key: it.file, label: file, sub: it.file.split('/').slice(-2, -1)[0] || '', order: 2 };
}

export default function Sequence({ sc, ix, cur, onPick, name }) {
  const svg = useRef(null);
  const [saved, setSaved] = useState('');
  const { parts, rows } = useMemo(() => {
    const route = sc.route;
    const partBy = {};
    const order = [];
    const pOf = (s) => {
      const it = ix.itemById[s.id];
      if (!s.synthetic && !it) return null;
      const p = participantOf(s, it, route);
      if (!partBy[p.key]) { partBy[p.key] = { ...p, role: s.role }; order.push(p.key); }
      return p.key;
    };
    const stepP = {};
    const rs = [];
    for (const s of sc.steps) {
      const to = pOf(s);
      stepP[s.n] = to;
      if (s.role === 'error-branch') { rs.push({ s, note: s.label }); continue; }
      if (s.role === 'request') { rs.push({ s, note: `${s.label}${s.ctx ? ` (${s.ctx})` : ''} — запрос приходит` }); continue; }
      const parent = s.parent ? sc.steps[s.parent - 1] : null;
      let from = parent ? stepP[parent.n] : to;
      if (parent?.role === 'error-branch') from = 'fw';
      if (s.role === 'response') {
        // ответ уходит клиенту от обработчика
        const h = [...sc.steps].reverse().find((x) => (x.role === 'controller' || x.role === 'handler') && x.depth === 1);
        from = (h && stepP[h.n]) || 'fw';
        rs.push({ s, from, to: 'client', back: true });
        continue;
      }
      if (parent?.role === 'request' && !s.synthetic && from === 'client') {
        // запрос от клиента сначала принимает фреймворк
        if (!partBy.fw) { partBy.fw = { key: 'fw', label: FW[route?.fw] || 'Фреймворк', sub: 'встроенное', order: 1 }; order.push('fw'); }
        from = 'fw';
      }
      rs.push({ s, from, to });
    }
    if (rs.some((r) => r.from === 'fw' || r.to === 'fw') && !partBy.fw) { partBy.fw = { key: 'fw', label: FW[route?.fw] || 'Фреймворк', sub: 'встроенное', order: 1 }; order.push('fw'); }
    const ps = order.map((k) => partBy[k]).sort((a, b) => a.order - b.order || order.indexOf(a.key) - order.indexOf(b.key));
    return { parts: ps, rows: rs };
  }, [sc, ix]);

  const colOf = Object.fromEntries(parts.map((p, i) => [p.key, i]));
  const x = (k) => (colOf[k] ?? 0) * COL + COL / 2;
  const width = parts.length * COL;
  const height = HEAD + rows.length * ROW + 16;

  async function save(ext) {
    try { const f = await saveSvg(svg.current, { width, height, name: `${name} — последовательность`, ext }); if (f) setSaved(`Сохранено: ${f}`); } catch (e) { setSaved(`Не получилось: ${e.message}`); }
  }

  return (
    <div className="card p-2">
      <div className="flex items-center gap-2 px-2 pt-1 pb-2 text-[11.5px] text-mist flex-wrap">
        <span>Вверху — участники, вниз — шаги по порядку. Стрелка — кто к кому обращается; <span style={{ color: C.back }}>зелёная обратная</span> — ответ клиенту. Нажми на шаг — справа его код.</span>
        <span className="flex-1" />
        <button className="btn-ghost text-[11.5px] py-0.5" onClick={() => save('png')}>Сохранить PNG</button>
        <button className="btn-ghost text-[11.5px] py-0.5" onClick={() => save('svg')}>SVG</button>
      </div>
      {saved && <div className="px-2 pb-2 text-[11px] text-mist-dim break-all">{saved}</div>}
      <div className="overflow-auto scroll-thin max-h-[68vh]">
        <svg ref={svg} width={width} height={height} className="block">
          <defs>
            {[['sq', C.arrow], ['sq-on', C.on], ['sq-back', C.back], ['sq-err', C.err]].map(([id, f]) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={f} /></marker>
            ))}
          </defs>
          {parts.map((p, i) => (
            <g key={p.key}>
              <line x1={i * COL + COL / 2} x2={i * COL + COL / 2} y1={HEAD - 6} y2={height - 6} stroke={C.line} strokeDasharray="3 4" />
              <rect x={i * COL + 8} y={6} width={COL - 16} height={HEAD - 18} rx="8" fill="#161C18" stroke={p.key === 'client' ? C.mist : '#2A332C'} />
              <text x={i * COL + COL / 2} y={26} textAnchor="middle" fontSize="12.5" fontWeight="600" fontFamily="Inter, sans-serif" fill={C.text}>{p.label.length > 20 ? `${p.label.slice(0, 19)}…` : p.label}</text>
              <text x={i * COL + COL / 2} y={41} textAnchor="middle" fontSize="10" fontFamily="JetBrains Mono, monospace" fill={C.dim}>{(p.role && p.key !== 'client' && p.key !== 'fw' ? `${ROLE_RU[p.role === 'handler' ? 'controller' : p.role] || ''} · ` : '') + (p.sub.length > 22 ? `${p.sub.slice(0, 21)}…` : p.sub)}</text>
              <title>{`${p.label}\n${p.sub}`}</title>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = HEAD + i * ROW + 22;
            const on = r.s.n === cur;
            const err = r.s.role === 'error' || r.s.role === 'error-branch' || sc.steps[r.s.parent - 1]?.role === 'error-branch';
            const color = on ? C.on : r.back ? C.back : err ? C.err : C.arrow;
            const marker = on ? 'sq-on' : r.back ? 'sq-back' : err ? 'sq-err' : 'sq';
            const it = ix.itemById[r.s.id];
            const label = `${r.s.n}. ${r.s.synthetic ? r.s.label : (r.s.label && r.s.label !== it?.name ? r.s.label : it?.name.split('.').pop() || '')}${r.s.repeat ? ' (было выше)' : ''}${r.s.cut ? ' …' : ''}`;
            const short = label.length > 34 ? `${label.slice(0, 33)}…` : label;
            const ctxShown = r.s.ctx ? (r.s.ctx.length > 34 ? `${r.s.ctx.slice(0, 33)}…` : r.s.ctx) : '';
            return (
              <g key={r.s.n} className="cursor-pointer" onClick={() => onPick(r.s.n)}>
                <rect x={0} y={y - 22} width={width} height={ROW} fill={on ? 'rgba(185,141,85,0.09)' : 'transparent'} />
                {r.note ? (
                  <>
                    <line x1={8} x2={width - 8} y1={y - 4} y2={y - 4} stroke={err ? C.err : C.line} strokeDasharray="6 4" opacity="0.7" />
                    <rect x={10} y={y - 15} width={Math.min(width - 20, r.note.length * 6.6 + 24)} height={20} rx="5" fill="#111713" stroke={on ? C.on : err ? C.err : '#2A332C'} />
                    <text x={22} y={y - 1} fontSize="11.5" fontFamily="Inter, sans-serif" fill={on ? C.on : err ? C.err : C.mist}>{`${r.s.n}. ${r.note}`}</text>
                  </>
                ) : r.from === r.to ? (
                  <>
                    <path d={`M ${x(r.from) + 2} ${y - 6} h 26 v 12 h -24`} fill="none" stroke={color} strokeWidth={on ? 1.8 : 1.3} strokeDasharray={linkOf(r.s.kind).dash} markerEnd={`url(#${marker})`} />
                    <text x={x(r.from) + 34} y={y - 2} fontSize="11.5" fontFamily="JetBrains Mono, monospace" fill={on ? C.on : C.text}>{short}</text>
                    {ctxShown && <text x={x(r.from) + 34} y={y + 10} fontSize="9.5" fontFamily="JetBrains Mono, monospace" fill={C.on} opacity="0.8">{ctxShown}</text>}
                  </>
                ) : (
                  <>
                    <line x1={x(r.from)} x2={x(r.to) + (x(r.to) > x(r.from) ? -3 : 3)} y1={y} y2={y} stroke={color} strokeWidth={on ? 1.8 : 1.3} strokeDasharray={r.back ? '6 4' : linkOf(r.s.kind).dash} markerEnd={`url(#${marker})`} />
                    <text x={(x(r.from) + x(r.to)) / 2} y={y - 5} textAnchor="middle" fontSize="11.5" fontFamily="JetBrains Mono, monospace" fill={on ? C.on : C.text}>{short}</text>
                    {ctxShown && <text x={(x(r.from) + x(r.to)) / 2} y={y + 11} textAnchor="middle" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fill={C.on} opacity="0.8">{ctxShown}</text>}
                  </>
                )}
                <title>{`${label}${r.s.ctx ? `\n${r.s.ctx}` : ''}${r.s.about ? `\n${r.s.about}` : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
