// Повторный запуск: «С возвращением», новый разбор, список сессий.
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createSession, openSession, deleteSession, toast } from '../app/store';
import RepoInput from './RepoInput';
import { TrashIcon } from '../components/icons';

function Coverage({ fresh, total }) {
  const pct = total ? Math.round((100 * fresh) / total) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-28 rounded-full bg-hairline overflow-hidden">
        <div className="h-full bg-bronze" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-mist tabular-nums">{fresh}/{total} объяснено</span>
    </div>
  );
}

export default function HomeScreen() {
  const dispatch = useDispatch();
  const { settings, sessions, loading, error } = useSelector((s) => s.app);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  function start(e) {
    e.preventDefault();
    if (repo.trim()) dispatch(createSession({ input: repo.trim(), branch }));
  }
  async function remove(id) {
    await dispatch(deleteSession(id));
    setConfirmId(null);
    dispatch(toast('Разбор удалён'));
  }

  return (
    <div className="relative z-10 flex-1 min-w-0 overflow-y-auto scroll-thin">
      <div className="max-w-[860px] mx-auto px-8 py-9">
        <div className="font-display font-semibold text-[26px]">С возвращением, {settings.name}.</div>
        <div className="text-mist text-[14px] mt-1.5">Источник ждёт. Выбери разбор или загрузи новый код.</div>

        <form onSubmit={start} className="card p-5 mt-7">
          <div className="label-mono mb-2">Новый разбор</div>
          <RepoInput id="h-repo" value={repo} onChange={setRepo} disabled={Boolean(loading)} branch={branch} onBranch={setBranch} />
          {error && <div className="font-mono text-[11.5px] text-danger-soft mt-2.5">{error}</div>}
          <div className="flex justify-end mt-3.5">
            <button type="submit" className="btn-bronze" disabled={!repo.trim() || Boolean(loading)}>{loading || 'Разобрать'}</button>
          </div>
        </form>

        <div className="label-mono mt-9 mb-3">Мои разборы · {sessions.length}</div>
        {sessions.length === 0 && (
          <div className="text-mist text-[13.5px] card p-5">Пока пусто. Вставь ссылку на репозиторий выше — и начнём.</div>
        )}
        <div className="flex flex-col gap-2.5">
          {sessions.map((s) => (
            <div key={s.id} className="card px-5 py-4 flex items-center gap-5 hover:border-bronze/40 transition-colors">
              <button className="flex-1 min-w-0 text-left" onClick={() => dispatch(openSession(s.id))}>
                <div className="font-display font-semibold text-[16px] truncate">{s.title}</div>
                <div className="font-mono text-[11px] text-mist-dim mt-1 truncate">
                  {s.source?.type === 'local' ? s.source.path : s.source?.url}{s.source?.branch ? ` · ветка ${s.source.branch}` : ''}
                  {s.commit?.short ? ` · ${s.commit.short}` : ''} · {s.files} файлов · обновлён {s.updated}
                </div>
                <div className="mt-2.5"><Coverage fresh={s.fresh} total={s.total} /></div>
              </button>
              {confirmId === s.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] text-mist">Удалить разбор?</span>
                  <button className="btn text-danger-soft border-danger/50 hover:bg-danger-hover" onClick={() => remove(s.id)}>Удалить</button>
                  <button className="btn" onClick={() => setConfirmId(null)}>Нет</button>
                </div>
              ) : (
                <button className="btn-ghost" onClick={() => setConfirmId(s.id)} title="Удалить разбор" aria-label="Удалить разбор">
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
