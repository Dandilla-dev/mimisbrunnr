// Объяснение с ИИ: что объясняем, сколько будет стоить, лимит, ход работы, остановка.
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { reloadSession, setScreen, clearJob, refreshSessions, toast } from '../../app/store';
import { CloseIcon, SparkIcon } from '../../components/icons';

const usd = (x) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} млн` : n >= 1e3 ? `${Math.round(n / 1e3)} тыс.` : String(n));

export default function ExplainDialog({ view, scope, onClose }) {
  const dispatch = useDispatch();
  const settings = useSelector((s) => s.app.settings);
  const job = useSelector((s) => (s.session.job?.id === view.id ? s.session.job : null));
  const [est, setEst] = useState(null);
  const [err, setErr] = useState(null);
  const [budget, setBudget] = useState(String(settings.budgetUsd));
  const [mode, setMode] = useState('now'); // now | batch
  const [sending, setSending] = useState(false);
  const running = job?.status === 'running';
  const finished = job && job.status !== 'running';
  const p = settings.provider;
  const noModel = !p.model;
  const noKey = p.type === 'anthropic' && !settings.hasApiKey;

  useEffect(() => {
    if (running) return;
    window.mimis.estimate(view.id, scope).then(setEst).catch((e) => setErr(e.message));
  }, [view.id, scope, running]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canBatch = est?.batch && !est.batch.why && est.count > 0;
  const batch = mode === 'batch' && canBatch;
  async function start() {
    setErr(null);
    const sc = { ...scope, budgetUsd: Math.max(0, Number(String(budget).replace(',', '.')) || 0) };
    if (batch) {
      setSending(true);
      try {
        await window.mimis.startBatch(view.id, sc);
        await dispatch(reloadSession(view.id));
        dispatch(toast('Пакет отправлен. Пояснения появятся, когда модель закончит — обычно в течение часа.'));
        onClose();
      } catch (e) { setErr(e.message); } finally { setSending(false); }
      return;
    }
    dispatch(clearJob());
    try {
      await window.mimis.startExplain(view.id, sc);
    } catch (e) { setErr(e.message); }
  }
  async function done() {
    await dispatch(reloadSession(view.id));
    dispatch(refreshSessions());
    dispatch(clearJob());
    onClose();
  }

  const what = scope.kind === 'all' ? 'весь проект' : scope.kind === 'file' ? `файл ${scope.file}` : `функцию ${scope.id.split('::')[1]}`;
  const pct = job?.total ? Math.round((100 * job.done) / job.total) : 0;

  return (
    <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="card w-[560px] max-w-full max-h-[90vh] overflow-y-auto scroll-thin p-6 animate-modal-in" role="dialog" aria-modal="true" aria-label="Объяснение с ИИ">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label-mono">Объяснение с ИИ</div>
            <div className="font-display font-semibold text-[19px] mt-1 break-words">Разобрать {what}</div>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть"><CloseIcon className="w-4 h-4" /></button>
        </div>

        <div className="mt-4 text-[13px] text-mist">
          Модель: <span className="font-mono text-stone">{p.model || 'не выбрана'}</span>{p.type === 'openai' && p.baseUrl ? <span className="font-mono"> · {p.baseUrl}</span> : null}
        </div>

        {(noModel || noKey) && !running && (
          <div className="mt-4 rounded-xl bg-danger-hover border border-danger/40 px-4 py-3 text-[13px]">
            {noModel ? 'Не выбрана модель ИИ.' : 'Нет ключа API для этой модели.'}{' '}
            <button className="underline text-bronze" onClick={() => { onClose(); dispatch(setScreen('settings')); }}>Открыть настройки</button>
          </div>
        )}

        {!job && est && (
          <div className="mt-5 bg-panel-2 border border-hairline-soft rounded-xl px-4 py-3.5 text-[13.5px] leading-relaxed">
            {est.count === 0 && !est.overview ? 'Здесь всё уже объяснено.' : (
              <>
                <div>Функций и классов: <b>{est.count}</b> · запросов к модели: <b>{est.requests}</b>{est.overview ? ' (последний — обзор проекта и слои)' : ''}</div>
                <div className="mt-1">Примерно {tok(est.estIn)} токенов на входе и {tok(est.estOut)} на выходе.</div>
                <div className="mt-1">
                  {est.priced ? <>Ориентировочная стоимость: <b className="text-bronze">{usd(est.estCost)}</b> <span className="text-mist">(оценка с запасом)</span></> : <span className="text-mist">Цены модели не указаны — стоимость не считаю (для локальных моделей это бесплатно).</span>}
                </div>
              </>
            )}
          </div>
        )}

        {!job && est?.batch && est.count > 0 && (
          <fieldset className="mt-4">
            <legend className="label-mono mb-1.5">Как объяснять</legend>
            <div className="grid gap-2">
              {[
                ['now', 'Сразу', 'Пояснения появляются по мере работы, за несколько минут.', est.priced ? usd(est.estCost) : '', ''],
                ['batch', 'Пакетом — вдвое дешевле', 'Все запросы уходят модели одним пакетом. Модель делает их, когда у неё есть свободные мощности, поэтому берёт вдвое меньше. Ответ — обычно в течение часа, самое долгое — 24 часа. Приложение можно закрыть: пакет запомнится, и результаты заберутся при следующем открытии разбора.', est.priced ? usd(est.batch.estCost) : '', est.batch.why],
              ].map(([id, title, text, price, why]) => (
                <label key={id} className={`flex gap-3 rounded-xl border px-3.5 py-2.5 ${why ? 'opacity-60 cursor-not-allowed border-hairline-soft' : `cursor-pointer ${mode === id ? 'border-bronze/60 bg-panel-2' : 'border-hairline-soft hover:bg-panel-2'}`}`}>
                  <input type="radio" name="ex-mode" className="mt-1 accent-bronze" checked={mode === id && !why} disabled={Boolean(why)} onChange={() => setMode(id)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3"><b className="text-[13.5px]">{title}</b>{price && <span className="font-mono text-[12px] text-bronze">≈ {price}</span>}</span>
                    <span className="block text-[12px] text-mist leading-relaxed mt-0.5">{why || text}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {!job && est?.priced && (
          <label className="block mt-4" htmlFor="ex-budget">
            <div className="label-mono mb-1.5">Лимит на этот запуск, $</div>
            <input id="ex-budget" className="input w-40" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <div className="text-[11.5px] text-mist-dim mt-1">{batch ? 'Если оценка пакета больше лимита, я его не отправлю.' : 'Дойдя до лимита, я остановлюсь; всё готовое сохранится, продолжить можно позже.'}</div>
          </label>
        )}

        {job && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-[13px]">
              <span>{running ? (job.file ? `Разбираю: ${job.file}` : 'Готовлюсь…') : job.status === 'done' ? 'Готово' : job.status === 'budget' ? 'Остановлено по лимиту' : job.status === 'stopped' ? 'Остановлено' : 'Ошибка'}</span>
              <span className="font-mono text-[12px] text-mist tabular-nums">{job.done}/{job.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-2"><div className="h-full bg-bronze transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="text-[12px] text-mist mt-2">Потрачено: {usd(job.spent || 0)} · токенов: {tok(job.inTok || 0)} + {tok(job.outTok || 0)}</div>
            {job.log?.length > 0 && (
              <div className="mt-3 bg-rail-bg border border-hairline-soft rounded-lg px-3 py-2 max-h-40 overflow-y-auto scroll-thin font-mono text-[11px] text-mist leading-relaxed">
                {job.log.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        )}

        {err && <div className="text-danger-soft text-[12.5px] mt-3">{err}</div>}

        <div className="flex justify-end gap-2 mt-6">
          {running && <button className="btn" onClick={() => window.mimis.stopExplain(view.id)}>Остановить</button>}
          {running && <button className="btn" onClick={onClose}>Свернуть</button>}
          {finished && <button className="btn-bronze" onClick={done}>Посмотреть результат</button>}
          {!job && (
            <>
              <button className="btn" onClick={onClose}>Отмена</button>
              <button className="btn-bronze" onClick={start} disabled={!est || (est.count === 0 && !est.overview) || noModel || noKey || sending}>
                <SparkIcon className="w-4 h-4" />{batch ? (sending ? 'Отправляю…' : 'Отправить пакет') : 'Начать'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
