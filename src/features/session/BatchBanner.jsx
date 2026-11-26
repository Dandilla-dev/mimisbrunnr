// Пакет пояснений: отправлен, модель работает. Раз в минуту спрашиваем, готов ли;
// когда готов — пояснения записываются и появляются в окне.
import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { reloadSession, refreshSessions, toast } from '../../app/store';

const usd = (x) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const POLL_MS = 60_000;

function since(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин назад`;
}

export default function BatchBanner({ view }) {
  const dispatch = useDispatch();
  const b = view.batch;
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [, tick] = useState(0);
  const busyRef = useRef(false);

  async function check() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await window.mimis.checkBatch(view.id);
      setLost(r.state === 'lost');
      if (r.state === 'applied') {
        const x = r.result;
        dispatch(toast(`Пакет готов: ${x.what === 'walk' ? 'разобрано по шагам' : 'объяснено'} ${x.done} из ${x.total}${x.errors ? `, не получилось ${x.errors}` : ''}. Потрачено ${usd(x.spent)}.`, x.errors ? 'error' : undefined));
        dispatch(refreshSessions());
      }
      if (r.state !== 'busy') await dispatch(reloadSession(view.id));
    } catch (e) { dispatch(toast(e.message, 'error')); } finally { busyRef.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!b?.id) return undefined;
    const first = setTimeout(check, 3000);
    const t = setInterval(() => { tick((n) => n + 1); check(); }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [view.id, b?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) return null;
  const last = b.last || {};
  async function cancel(forget) {
    setConfirm(false);
    try { await window.mimis.cancelBatch(view.id, forget); await dispatch(reloadSession(view.id)); if (!forget) check(); } catch (e) { dispatch(toast(e.message, 'error')); }
  }

  return (
    <div className="px-6 py-2.5 border-b border-hairline-soft bg-panel-2 text-[13px] flex items-start gap-4" role="status">
      <div className="min-w-0 flex-1 leading-relaxed">
        <div>
          <b className="text-bronze">{b.canceling ? 'Пакет отменяется' : 'Пакет у модели'}</b>
          {' · '}{b.what === 'walk' ? 'разбор по шагам · ' : ''}{b.count} функций · отправлен {since(b.created)} · оценка {usd(b.estCost)}
          {last.total ? <> · готово запросов {last.done} из {last.total}</> : null}
        </div>
        <div className="text-mist text-[12px]">
          {lost
            ? 'Провайдер не находит этот пакет (возможно, сменился ключ API или прошло больше 29 дней). Его можно забыть и объяснить заново.'
            : b.canceling
              ? 'Что модель уже успела сделать, придёт и будет записано — за это провайдер возьмёт деньги.'
              : `Обычно пакет готов в течение часа, самое долгое — 24 часа. Проверяю раз в минуту. Приложение можно закрыть: результаты заберу, когда вы снова откроете этот разбор.${b.overview ? ' Обзор проекта и слои допишу сразу после пакета — обычным запросом.' : ''}`}
          {last.error && !lost ? <span className="text-danger-soft"> Последняя проверка: {last.error}</span> : null}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button className="btn py-1.5" onClick={check} disabled={busy}>{busy ? 'Проверяю…' : 'Проверить сейчас'}</button>
        {lost ? <button className="btn py-1.5" onClick={() => cancel(true)}>Забыть пакет</button>
          : !b.canceling && (confirm
            ? <><button className="btn py-1.5 border-danger/50" onClick={() => cancel(false)}>Да, отменить</button><button className="btn-ghost py-1.5" onClick={() => setConfirm(false)}>Нет</button></>
            : <button className="btn-ghost py-1.5" onClick={() => setConfirm(true)}>Отменить пакет</button>)}
      </div>
    </div>
  );
}
