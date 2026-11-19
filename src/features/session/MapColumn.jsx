// Левая колонка: схема проекта — слои, у каждого файлы и функции.
import { useDispatch, useSelector } from 'react-redux';
import { go, home } from '../../app/store';
import { AlertIcon, BookIcon, PathIcon, ScrollIcon, TableIcon } from '../../components/icons';

const LAYER_COLORS = ['#B98D55', '#5C82A6', '#7FA08A', '#C9A7D9', '#D98787', '#A9C2D8', '#C8B27A', '#8FB59A', '#9AA5C9', '#D6A57A'];

export function layerColor(view, id) {
  const i = view.layers.findIndex((l) => l.id === id);
  return id === 'new' ? '#8A93A6' : LAYER_COLORS[(i < 0 ? 0 : i) % LAYER_COLORS.length];
}

export default function MapColumn({ view, ix }) {
  const dispatch = useDispatch();
  const top = useSelector((s) => s.session.stack[s.session.stack.length - 1]);
  const activeLayer = top.t === 'layer' ? top.id : top.t === 'file' ? ix.fileByPath[top.file]?.layer : top.t === 'fn' || top.t === 'scenario' ? ix.fileByPath[ix.itemById[top.id]?.file]?.layer : null;
  const attention = view.counts.stale + view.counts.none + view.orphans.length;

  const navBtn = (active, onClick, Icon, label, extra) => (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] transition-colors ${active ? 'bg-panel-2 text-bronze' : 'text-mist hover:bg-panel-2 hover:text-stone'}`}>
      <Icon className="w-4 h-4 flex-shrink-0" /><span className="flex-1 text-left">{label}</span>{extra}
    </button>
  );

  return (
    <aside className="w-[300px] flex-shrink-0 border-r border-hairline-soft overflow-y-auto scroll-thin px-3.5 py-4">
      <div className="flex flex-col gap-0.5 mb-5">
        {navBtn(top.t === 'overview', () => dispatch(home()), ScrollIcon, 'Обзор проекта')}
        {navBtn(top.t === 'scenarios' || top.t === 'scenario', () => dispatch(go({ t: 'scenarios' })), PathIcon, view.web?.routes?.length ? 'Сценарии и запросы' : 'Сценарии', view.web?.routes?.length ? <span className="font-mono text-[10.5px] text-mist-dim">{view.web.routes.length}</span> : null)}
        {view.entities?.length > 0 && navBtn(top.t === 'entities', () => dispatch(go({ t: 'entities' })), TableIcon, 'Сущности', <span className="font-mono text-[10.5px] text-mist-dim">{view.entities.length}</span>)}
        {navBtn(top.t === 'todo', () => dispatch(go({ t: 'todo' })), AlertIcon, 'Требует внимания', attention ? <span className="font-mono text-[10.5px] text-bronze">{attention}</span> : null)}
        {navBtn(top.t === 'terms', () => dispatch(go({ t: 'terms' })), BookIcon, 'Словарь терминов', view.terms.length ? <span className="font-mono text-[10.5px] text-mist-dim">{view.terms.length}</span> : null)}
      </div>
      <div className="label-mono px-1 mb-2">
        Части проекта · {view.layersSource === 'ai' ? 'от ИИ' : 'по папкам'}
      </div>
      <div className="flex flex-col gap-2">
        {view.layers.map((l) => {
          const st = ix.layerStats[l.id] || { files: 0, items: 0, notFresh: 0 };
          const pct = st.items ? Math.round((100 * (st.items - st.notFresh)) / st.items) : 0;
          return (
            <button
              key={l.id}
              onClick={() => dispatch(go({ t: 'layer', id: l.id }))}
              className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${activeLayer === l.id ? 'bg-panel-2 border-hairline' : 'bg-panel border-hairline-soft hover:border-hairline'}`}
              style={{ borderLeft: `4px solid ${layerColor(view, l.id)}` }}
            >
              <div className="font-display font-semibold text-[14.5px] leading-snug">{l.name}</div>
              {l.description && <div className="text-[11.5px] text-mist leading-snug mt-1 line-clamp-2">{l.description}</div>}
              <div className="flex items-center justify-between mt-2">
                <span className="font-mono text-[10.5px] text-mist-dim">{st.files} файл. · {st.items} функц.</span>
                <span className="h-1 w-14 rounded-full bg-hairline overflow-hidden"><span className="block h-full bg-bronze" style={{ width: `${pct}%` }} /></span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
