// Переключатель веток в шапке разбора.
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { switchBranch, createSession, toast } from '../../app/store';
import { BranchIcon, RefreshIcon } from '../../components/icons';

export default function BranchPicker({ view }) {
  const dispatch = useDispatch();
  const loading = useSelector((s) => s.app.loading);
  const job = useSelector((s) => (s.session.job?.id === view.id ? s.session.job : null));
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const current = view.source?.branch || '';

  async function load(refresh = false) {
    setBusy(true);
    try { setData(await window.mimis.branches(view.id, refresh)); } catch (e) { setData({ error: e.message, list: [] }); }
    setBusy(false);
  }
  useEffect(() => { if (open) load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, view.id]);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);

  async function pick(name) {
    setOpen(false);
    const r = await dispatch(switchBranch({ id: view.id, branch: name }));
    if (r.error) { dispatch(toast(r.error.message, 'error')); return; }
    const d = r.payload.lastUpdate;
    dispatch(toast(`Ветка ${d.toBranch}${d.offline ? ' (сохранённая копия — GitHub недоступен)' : ''}: по сравнению с ${d.fromBranch} изменено функций — ${d.changed}, новых — ${d.added}, нет в этой ветке — ${d.removed}. С пояснениями: ${d.restored} из ${r.payload.counts.total}.`));
  }
  async function openFromGithub(name) {
    setOpen(false);
    const r = await dispatch(createSession({ input: `https://github.com/${data.remote.owner}/${data.remote.repo}`, branch: name }));
    if (r.error) dispatch(toast(r.error.message, 'error'));
  }

  const s = q.trim().toLowerCase();
  const list = (data?.list || []).filter((b) => !s || b.name.toLowerCase().includes(s));
  const disabled = Boolean(loading) || job?.status === 'running';
  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost border border-hairline font-mono text-[12px] py-1 px-2 max-w-[260px]" onClick={() => setOpen((o) => !o)} disabled={disabled}
        title={job?.status === 'running' ? 'Сейчас идёт объяснение — переключить ветку можно после него' : 'Ветки репозитория'}>
        <BranchIcon className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{current || 'ветка'}</span><span className="text-mist-dim">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[420px] max-w-[80vw] card rounded-xl shadow-2xl p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-display font-semibold text-[15px]">Ветки</div>
            {data?.type === 'github' && <button className="btn-ghost text-[12px]" onClick={() => load(true)} disabled={busy}><RefreshIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />Обновить список</button>}
          </div>
          <p className="text-[12px] text-mist leading-relaxed mb-2">
            Ветка — отдельная версия кода в том же репозитории: например, <span className="font-mono">main</span> — рабочая, а в <span className="font-mono">feature-login</span> кто-то делает вход по паролю.
            Пояснения хранятся для каждой версии функции: если в двух ветках функция одинаковая, пояснение одно и то же, а при переключении туда и обратно ничего не теряется.
          </p>
          {data?.error && <div className="text-[12px] text-bronze mb-2">Не получилось спросить GitHub: {data.error} Показаны ветки, которые уже скачаны.</div>}
          {data?.type === 'local' && (
            <div className="text-[12.5px] text-stone mb-2 leading-relaxed">
              Это папка на компьютере, и разобрано то, что в ней лежит сейчас — ветка <span className="font-mono text-bronze">{data.current || '?'}</span>.
              Чтобы разобрать другую ветку, переключи её в git (например, <span className="font-mono">git switch имя</span>) и нажми «Обновить код».
              {data.remote ? <> Или открой ветку с GitHub ({data.remote.owner}/{data.remote.repo}) — получится отдельный разбор, где ветки переключаются прямо здесь.</> : null}
              {!data.git && ' В этой папке не нашлось git.'}
            </div>
          )}
          {(data?.list?.length || 0) > 8 && <input className="input py-1.5 mb-2" placeholder="Найти ветку…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus spellCheck={false} />}
          {!data && <div className="text-[13px] text-mist py-2">Спрашиваю GitHub…</div>}
          <div className="flex flex-col max-h-[50vh] overflow-y-auto scroll-thin">
            {list.map((b) => {
              const isCur = b.name === current;
              const canSwitch = data.type === 'github' && !isCur;
              return (
                <div key={b.name} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${isCur ? 'bg-panel-2' : canSwitch ? 'hover:bg-panel-2 cursor-pointer' : ''}`}
                  onClick={() => canSwitch && pick(b.name)} role={canSwitch ? 'button' : undefined}>
                  <span className={`font-mono text-[12.5px] truncate flex-1 ${isCur ? 'text-bronze' : ''}`}>{b.name}</span>
                  {b.name === data.default && <span className="text-[10.5px] text-mist border border-hairline rounded px-1">основная</span>}
                  {isCur && <span className="text-[10.5px] text-bronze border border-bronze/50 rounded px-1">открыта</span>}
                  {b.cached && !isCur && <span className="text-[10.5px] text-moss border border-moss/40 rounded px-1" title="Код этой ветки уже скачан — откроется быстро и без интернета">{b.stale ? 'скачана, есть новее' : 'скачана'}</span>}
                  {b.gone && <span className="text-[10.5px] text-mist-dim" title="На GitHub такой ветки больше нет, но сохранённая копия осталась">удалена на GitHub</span>}
                  {data.type === 'local' && !isCur && data.remote && <button className="btn-ghost text-[11.5px] py-0.5" onClick={() => openFromGithub(b.name)}>открыть с GitHub</button>}
                </div>
              );
            })}
            {data && !list.length && <div className="text-[13px] text-mist-dim py-2">Веток не найдено.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
