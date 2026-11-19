// «Что внутри функции»: откуда приходят данные, какие переменные и откуда они,
// куда уходят, что возвращается и бросается. Всё это — из разбора кода, без ИИ.
// Плюс по кнопке — разбор по шагам от ИИ с подсветкой строк.
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { reloadSession, toast } from '../../app/store';
import { SparkIcon } from '../../components/icons';

const HOW = { arg: 'передаётся в', method: 'вызывается', return: 'возвращается', throw: 'бросается', response: 'уходит в ответ', next: 'передаётся в next', check: 'проверяется' };
const OUT = { return: 'возвращает', throw: 'бросает ошибку', response: 'отвечает клиенту', next: 'передаёт дальше' };
const EFF = { tx: 'транзакция', net: 'запрос в сеть', file: 'файлы' };
const flowCache = new Map();

function Line({ n, onMark }) {
  return <button className="font-mono text-[10.5px] text-mist-dim hover:text-bronze flex-shrink-0 w-12 text-left" onClick={() => onMark([n, n])} title="Показать в коде">стр. {n}</button>;
}

export default function Inside({ view, it, onMark }) {
  const dispatch = useDispatch();
  const key = `${view.id}:${view.commit?.hash}:${it.id}`;
  const [flow, setFlow] = useState(flowCache.get(key) ?? null);
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setEst(null);
    if (flowCache.has(key)) { setFlow(flowCache.get(key)); return undefined; }
    setFlow(null);
    window.mimis.flow(view.id, it.id).then((f) => { flowCache.set(key, f || false); if (alive) setFlow(f || false); }).catch(() => alive && setFlow(false));
    return () => { alive = false; };
  }, [key, view.id, it.id]);
  const walk = view.walks?.[it.id];
  const fresh = walk && walk.hash === it.hash;

  async function ask() { try { setEst(await window.mimis.estimateWalk(view.id, it.id)); } catch (e) { dispatch(toast(e.message, 'error')); } }
  async function run() {
    setBusy(true); setEst(null);
    try {
      const r = await window.mimis.runWalk(view.id, it.id);
      await dispatch(reloadSession(view.id));
      dispatch(toast(`Разобрано по шагам: ${r.result.steps}, $${r.result.cost.toFixed(4)}.`));
    } catch (e) { dispatch(toast(e.message, 'error')); }
    setBusy(false);
  }

  if (flow === null) return <div className="text-[13px] text-mist">Разбираю…</div>;
  const f = flow || { params: [], inputs: [], vars: [], reassign: [], uses: {}, outputs: [], effects: [] };
  const empty = !f.params.length && !f.inputs.length && !f.vars.length && !f.outputs.length;
  return (
    <div className="text-[13.5px]">
      {empty && <div className="text-mist-dim">Внутри нет переменных и явного результата.</div>}
      {(f.params.length > 0 || f.inputs.length > 0) && (
        <div className="mb-3">
          <div className="text-[12px] text-mist mb-1">Что приходит на вход</div>
          {f.params.map((p) => (
            <div key={`p${p.name}`} className="flex gap-2 py-0.5"><span className="font-mono text-bronze/90">{p.name}</span>
              <span className="text-mist">параметр{p.type ? <> · <span className="font-mono">{p.type}</span></> : ''}{p.deco ? <> · <span className="font-mono">{p.deco}</span></> : ''}{p.from ? ` · ${p.from}` : ''}</span></div>
          ))}
          {f.inputs.map((x) => <div key={`i${x.text}`} className="flex gap-2 py-0.5 items-baseline"><Line n={x.line} onMark={onMark} /><span className="font-mono">{x.text}</span><span className="text-mist">— берётся из запроса или окружения</span></div>)}
        </div>
      )}
      {f.vars.length > 0 && (
        <div className="mb-3">
          <div className="text-[12px] text-mist mb-1">Переменные: откуда берутся и куда уходят</div>
          <div className="flex flex-col gap-1.5">
            {f.vars.map((v) => {
              const re = f.reassign.filter((r) => r.name === v.name);
              const us = f.uses[v.name] || [];
              return (
                <div key={`${v.name}${v.line}`} className="rounded-lg bg-panel-2/60 border border-hairline-soft px-3 py-2">
                  <div className="flex gap-2 items-baseline flex-wrap"><Line n={v.line} onMark={onMark} /><span className="font-mono text-bronze/90">{v.name}</span><span className="text-mist">←</span><span className="font-mono text-[12.5px] break-all">{v.from}</span>{v.kind && v.kind !== 'const' && <span className="text-[11px] text-mist-dim">{v.kind}</span>}</div>
                  {re.map((r) => <div key={r.line} className="flex gap-2 items-baseline mt-0.5"><Line n={r.line} onMark={onMark} /><span className="text-mist">перезаписывается ←</span><span className="font-mono text-[12.5px] break-all">{r.from}</span></div>)}
                  {us.slice(0, 6).map((u, i) => <div key={i} className="flex gap-2 items-baseline mt-0.5"><Line n={u.line} onMark={onMark} /><span className="text-mist">{HOW[u.how] || u.how}</span>{u.how !== 'return' && u.how !== 'throw' && <span className="font-mono text-[12.5px] break-all">{u.to}</span>}</div>)}
                </div>
              );
            })}
          </div>
          {f.reassign.filter((r) => !f.vars.some((v) => v.name === r.name)).map((r) => (
            <div key={`r${r.line}`} className="flex gap-2 items-baseline mt-1"><Line n={r.line} onMark={onMark} /><span className="font-mono text-bronze/90">{r.name}</span><span className="text-mist">(параметр) перезаписывается ←</span><span className="font-mono text-[12.5px]">{r.from}</span></div>
          ))}
        </div>
      )}
      {f.outputs.length > 0 && (
        <div className="mb-3">
          <div className="text-[12px] text-mist mb-1">Чем заканчивается</div>
          {f.outputs.map((o, i) => (
            <div key={i} className="flex gap-2 items-baseline py-0.5"><Line n={o.line} onMark={onMark} />
              <span className={o.kind === 'throw' ? 'text-danger-soft' : 'text-mist'}>{OUT[o.kind] || o.kind}{o.status ? ` ${o.status}` : ''}</span>
              <span className="font-mono text-[12.5px] break-all">{o.text}</span></div>
          ))}
        </div>
      )}
      {f.effects.length > 0 && (
        <div className="mb-3">
          <div className="text-[12px] text-mist mb-1">Особые места</div>
          {f.effects.map((x, i) => <div key={i} className="flex gap-2 items-baseline py-0.5"><Line n={x.line} onMark={onMark} /><span className="text-mist">{EFF[x.kind] || x.kind}</span><span className="font-mono text-[12.5px]">{x.text}</span></div>)}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-hairline-soft">
        {walk && (
          <div className="mb-3">
            <div className="text-[12px] text-mist mb-1.5">Разбор по шагам {walk.model ? `· ${walk.model}` : ''}{!fresh && <span className="text-bronze"> · код изменился после разбора</span>}</div>
            <ol className="flex flex-col gap-2">
              {walk.steps.map((s, i) => (
                <li key={i}>
                  <button className="text-left w-full rounded-lg px-3 py-2 bg-panel border border-hairline-soft hover:border-bronze/60" onClick={() => onMark([s.from, s.to])}>
                    <div className="flex gap-2 items-baseline"><span className="font-mono text-[10.5px] text-mist-dim">строки {s.from}–{s.to}</span><span className="font-display font-semibold text-[14px]">{s.title}</span></div>
                    <div className="text-[13.5px] leading-relaxed mt-0.5">{s.text}</div>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {busy ? <button className="btn border-bronze/50 text-bronze" disabled><SparkIcon className="w-4 h-4 animate-spin" style={{ animationDuration: '3s' }} />Разбираю по шагам…</button>
          : est ? (
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
              <span className="text-mist">~{(est.estIn / 1000).toFixed(1)}k + {(est.estOut / 1000).toFixed(1)}k токенов{est.priced ? `, ~$${est.estCost.toFixed(4)}` : ''}</span>
              <button className="btn-bronze py-1.5" onClick={run}>Разобрать</button>
              <button className="btn-ghost" onClick={() => setEst(null)}>Отмена</button>
            </div>
          ) : (
            <button className={walk && fresh ? 'btn-ghost' : 'btn'} onClick={ask}><SparkIcon className="w-4 h-4" />{walk ? 'Разобрать по шагам заново' : 'Разобрать по шагам (ИИ)'}</button>
          )}
        {!walk && <div className="text-[11.5px] text-mist-dim mt-1.5">ИИ разделит код на смысловые куски и объяснит каждый; нажатие на шаг подсветит его строки в коде.</div>}
      </div>
    </div>
  );
}
