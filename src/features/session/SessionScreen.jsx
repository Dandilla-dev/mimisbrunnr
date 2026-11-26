// Экран разбора: шапка, схема слоёв слева, панель справа.
import { useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { go, setScreen, updateSession, toast } from '../../app/store';
import { useIndex } from './useIndex';
import MapColumn from './MapColumn';
import Panel from './Panel';
import ExplainDialog from './ExplainDialog';
import BranchPicker from './BranchPicker';
import BatchBanner from './BatchBanner';
import { BackIcon, RefreshIcon, SearchIcon, SparkIcon } from '../../components/icons';

function Search({ view, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const idx = useMemo(() => [
    ...view.files.map((f) => ({ key: f.path.toLowerCase(), label: f.path, sub: 'файл', v: { t: 'file', file: f.path } })),
    ...view.items.map((i) => ({ key: i.name.toLowerCase(), label: i.name, sub: `${i.file}:${i.line}`, v: { t: 'fn', id: i.id } })),
  ], [view]);
  const s = q.trim().toLowerCase();
  const hits = s ? idx.filter((x) => x.key.includes(s)).sort((a, b) => (a.key.startsWith(s) ? 0 : 1) - (b.key.startsWith(s) ? 0 : 1) || a.key.length - b.key.length).slice(0, 30) : [];
  const pick = (h) => { onPick(h.v); setQ(''); setOpen(false); };
  return (
    <div className="relative w-[300px] max-w-[40vw]">
      <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist-dim" />
      <label htmlFor="search" className="sr-only">Поиск</label>
      <input
        id="search" className="input pl-9 py-2" value={q} placeholder="Функция или файл…" autoComplete="off" spellCheck={false}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') setOpen(false); }}
      />
      {open && s && (
        <div className="absolute right-0 left-0 top-[calc(100%+4px)] z-30 card rounded-xl py-1 max-h-[60vh] overflow-y-auto scroll-thin shadow-2xl">
          {hits.length === 0 && <div className="px-3 py-2 text-[13px] text-mist">Ничего не найдено</div>}
          {hits.map((h) => (
            <button key={h.label + h.sub} className="w-full text-left px-3 py-1.5 hover:bg-panel-2" onMouseDown={() => pick(h)}>
              <div className="font-mono text-[12.5px] truncate">{h.label}</div>
              <div className="text-[11px] text-mist-dim truncate">{h.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionScreen() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.session.view);
  const job = useSelector((s) => (s.session.job?.id === s.session.view?.id ? s.session.job : null));
  const loading = useSelector((s) => s.app.loading);
  const ix = useIndex(view);
  const [explain, setExplain] = useState(null); // scope или null
  const busyRef = useRef(false);

  if (!view || !ix) return null;
  const running = job?.status === 'running';

  async function refresh() {
    if (busyRef.current) return;
    busyRef.current = true;
    const r = await dispatch(updateSession(view.id));
    busyRef.current = false;
    if (r.error) dispatch(toast(r.error.message, 'error'));
    else {
      const d = r.payload.lastUpdate;
      dispatch(toast(d.from === d.to && !d.changed && !d.added && !d.removed
        ? 'Код не изменился.'
        : `Код обновлён (${d.from} → ${d.to}): изменено ${d.changed}, новых ${d.added}, удалено ${d.removed}.${d.moved?.length ? ` Пояснения перешли к переименованным функциям: ${d.moved.length}.` : ''}`));
    }
  }

  return (
    <div className="relative z-10 flex-1 min-w-0 flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-hairline-soft">
        <button className="btn-ghost -ml-2" onClick={() => dispatch(setScreen('home'))} title="К списку разборов"><BackIcon className="w-4 h-4" />Разборы</button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-display font-semibold text-[17px] truncate">{view.title}</div>
            <BranchPicker view={view} />
          </div>
          <div className="font-mono text-[10.5px] text-mist-dim truncate">
            {view.commit?.short} · {view.commit?.date} · {view.commit?.subject}
          </div>
        </div>
        <Search view={view} onPick={(v) => dispatch(go(v))} />
        <button className="btn" onClick={refresh} disabled={Boolean(loading) || running} title="Скачать свежую версию кода и пересобрать схему">
          <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Обновляю…' : 'Обновить код'}
        </button>
        {running ? (
          <button className="btn border-bronze/50 text-bronze" onClick={() => setExplain(job.scope || { kind: 'all' })}>
            <SparkIcon className="w-4 h-4 animate-spin" style={{ animationDuration: '3s' }} />{job.what === 'walk' ? 'По шагам' : 'Объясняю'} {job.done}/{job.total}
          </button>
        ) : (
          <button className="btn-bronze" onClick={() => setExplain({ kind: 'all' })} disabled={view.counts.fresh === view.counts.total && view.layersSource === 'ai'}>
            <SparkIcon className="w-4 h-4" />Объяснить{view.counts.total - view.counts.fresh ? ` (${view.counts.total - view.counts.fresh})` : ''}
          </button>
        )}
      </header>
      <BatchBanner view={view} />
      <div className="flex-1 min-h-0 flex">
        <MapColumn view={view} ix={ix} />
        <Panel view={view} ix={ix} onExplain={setExplain} />
      </div>
      {explain && <ExplainDialog view={view} scope={explain} onClose={() => setExplain(null)} />}
    </div>
  );
}
