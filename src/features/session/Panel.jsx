// Правая панель: обзор, слой, файл (функции и весь код), функция (код + пояснение),
// «требует внимания», словарь.
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { go, back, home, reloadSession, toast } from '../../app/store';
import CodeView from '../../components/CodeView';
import { BackIcon, SparkIcon, CodeIcon, PathIcon } from '../../components/icons';
import { ScenarioList, ScenarioView } from './Scenarios';
import { useCode } from './useCode';
import ErrorBoundary from '../../components/ErrorBoundary';
import { KIND_RU } from './useIndex';
import { layerColor } from './MapColumn';
import { ProjectDiagram, LayerDiagram, FnDiagram } from './Diagrams';

export const Badge = ({ status }) => status === 'fresh'
  ? <span className="font-mono text-[10px] text-moss">● разбор</span>
  : status === 'stale'
    ? <span className="font-mono text-[10px] text-bronze">⚠ код изменился</span>
    : <span className="font-mono text-[10px] text-mist-dim">○ нет пояснения</span>;

export const KindTag = ({ kind }) => (
  <span className="font-mono text-[9.5px] uppercase tracking-wide text-mist-dim border border-hairline rounded px-1.5 py-[1px]">{KIND_RU[kind] || kind}</span>
);

function FnLink({ ix, id, passed }) {
  const dispatch = useDispatch();
  const it = ix.itemById[id];
  if (!it) return null;
  return (
    <button onClick={() => dispatch(go({ t: 'fn', id }))} className={`font-mono text-[12px] px-2 py-1 rounded-md border bg-panel-2 hover:border-bronze hover:text-bronze transition-colors text-left ${passed ? 'border-dashed border-mist-dim' : 'border-hairline'}`}
      title={passed ? 'Не вызывается напрямую, а передаётся (в onClick, аргументом, в список) — вызовется позже' : undefined}>
      {it.name}<span className="text-mist-dim"> · {it.file.split('/').pop()}{passed ? ' · передаётся' : ''}</span>
    </button>
  );
}

function Crumbs({ view, ix }) {
  const dispatch = useDispatch();
  const stack = useSelector((s) => s.session.stack);
  const top = stack[stack.length - 1];
  const parts = [<button key="o" className="hover:text-stone" onClick={() => dispatch(home())}>Обзор</button>];
  const layerName = (id) => view.layers.find((l) => l.id === id)?.name || '';
  const add = (label, v) => parts.push(<span key={`s${parts.length}`} className="text-hairline">›</span>, v
    ? <button key={`p${parts.length}`} className="hover:text-stone truncate max-w-[260px]" onClick={() => dispatch(go(v))}>{label}</button>
    : <span key={`p${parts.length}`} className="text-stone truncate max-w-[300px]">{label}</span>);
  if (top.t === 'layer') add(layerName(top.id));
  if (top.t === 'file') { add(layerName(ix.fileByPath[top.file]?.layer), { t: 'layer', id: ix.fileByPath[top.file]?.layer }); add(top.file); }
  if (top.t === 'fn') {
    const it = ix.itemById[top.id];
    const lay = ix.fileByPath[it.file]?.layer;
    add(layerName(lay), { t: 'layer', id: lay }); add(it.file, { t: 'file', file: it.file }); add(it.name);
  }
  if (top.t === 'scenarios') add('Сценарии');
  if (top.t === 'scenario') { add('Сценарии', { t: 'scenarios' }); add(ix.itemById[top.id]?.name || ''); }
  if (top.t === 'todo') add('Требует внимания');
  if (top.t === 'terms') add('Словарь');
  return (
    <div className="flex items-center gap-3 mb-5 text-[12.5px] text-mist">
      <button className="btn-ghost -ml-2 border border-hairline" disabled={stack.length < 2} onClick={() => dispatch(back())}><BackIcon className="w-3.5 h-3.5" />Назад</button>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">{parts}</div>
    </div>
  );
}

// ---------------------------------------------------------------- обзор
function Overview({ view, ix, onExplain }) {
  const dispatch = useDispatch();
  const c = view.counts;
  const pct = c.total ? Math.round((100 * c.fresh) / c.total) : 0;
  const lu = view.lastUpdate;
  return (
    <div className="max-w-[1100px]">
      <div className="label-mono mb-1.5">Обзор проекта</div>
      <h1 className="font-display font-semibold text-[24px] leading-tight">{view.title}</h1>
      <div className="font-mono text-[11px] text-mist-dim mt-1.5 break-all">
        {view.source?.type === 'local' ? view.source.path : view.source?.url}{view.source?.branch ? ` · ветка ${view.source.branch}` : ''}
      </div>
      {view.summary
        ? <p className="text-[14.5px] leading-relaxed mt-5 text-stone">{view.summary}</p>
        : <p className="text-[14px] leading-relaxed mt-5 text-mist">Пока я разложил файлы по папкам. Когда ты запустишь объяснение, я опишу проект целиком и разложу его по смысловым слоям.</p>}

      <div className="mt-6">
        <div className="font-display font-semibold text-[16px] mb-2.5">Схема взаимодействия</div>
        <ProjectDiagram view={view} ix={ix} />
      </div>

      {lu && (
        <div className="card px-4 py-3 mt-5 text-[13px]">
          Последнее обновление {lu.at}: коммит <span className="font-mono">{lu.from}</span> → <span className="font-mono">{lu.to}</span>. Изменено функций: {lu.changed}, новых: {lu.added}, удалено: {lu.removed}.
        </div>
      )}

      <div className="card p-5 mt-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[14px]">Объяснено <b className="tabular-nums">{c.fresh}</b> из {c.total}</div>
            <div className="text-[12px] text-mist mt-1">Код изменился: {c.stale} · Без пояснения: {c.none}{view.usage?.cost ? ` · потрачено на этот разбор $${view.usage.cost.toFixed(3)}` : ''}</div>
          </div>
          {c.fresh < c.total && <button className="btn-bronze" onClick={() => onExplain({ kind: 'all' })}><SparkIcon className="w-4 h-4" />Объяснить ({c.total - c.fresh})</button>}
        </div>
        <div className="h-1.5 rounded-full bg-hairline overflow-hidden mt-4"><div className="h-full bg-bronze" style={{ width: `${pct}%` }} /></div>
        {(c.stale > 0 || view.orphans.length > 0) && <button className="btn-ghost mt-3 -ml-2.5" onClick={() => dispatch(go({ t: 'todo' }))}>Показать, что требует внимания →</button>}
      </div>

      <div className="mt-6 text-[13.5px] text-mist leading-relaxed">
        Слева — схема: части проекта. Открой часть, затем файл — увидишь все его функции и весь код. Открой функцию — рядом с её кодом будет пояснение: что она делает, что получает и возвращает, кто её вызывает, пример и подводные камни.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- слой
function LayerView({ view, ix, id }) {
  const dispatch = useDispatch();
  const l = view.layers.find((x) => x.id === id);
  const files = ix.filesByLayer[id] || [];
  return (
    <div className="max-w-[1100px]">
      <div className="label-mono mb-1.5 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: layerColor(view, id) }} />Часть проекта</div>
      <h1 className="font-display font-semibold text-[23px]">{l?.name}</h1>
      {l?.description && <p className="text-[14px] text-mist mt-2 leading-relaxed">{l.description}</p>}
      <div className="mt-6">
        <div className="font-display font-semibold text-[16px] mb-2.5">Схема взаимодействия</div>
        <LayerDiagram view={view} ix={ix} layerId={id} />
      </div>
      <div className="font-display font-semibold text-[16px] mt-8 mb-1">Файлы</div>
      <div className="flex flex-col gap-1 mt-2">
        {files.map((f) => {
          const items = ix.itemsByFile[f.path] || [];
          const nf = items.filter((i) => i.status !== 'fresh').length;
          return (
            <button key={f.path} onClick={() => dispatch(go({ t: 'file', file: f.path }))} className="text-left px-3.5 py-3 rounded-xl hover:bg-panel-2 transition-colors">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[13px] break-all">{f.path}</span>
                <span className="font-mono text-[10.5px] text-mist-dim whitespace-nowrap">{f.lines} стр. · {items.length} функц.{nf ? ` · ${nf} без разбора` : ''}</span>
              </div>
              <div className="text-[12.5px] text-mist mt-1 leading-snug">{f.purpose || f.doc || 'Назначение файла ещё не описано.'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- файл
function FileView({ view, ix, file, onExplain }) {
  const dispatch = useDispatch();
  const f = ix.fileByPath[file];
  const items = ix.itemsByFile[file] || [];
  const [tab, setTab] = useState(items.length ? 'fns' : 'code');
  const code = useCode(view, file);
  const nf = items.filter((i) => i.status !== 'fresh').length;
  return (
    <div>
      <div className="label-mono mb-1.5">Файл · {f.lines} строк · {f.lang}</div>
      <h1 className="font-mono text-[18px] break-all">{file}</h1>
      <p className="text-[14px] text-mist mt-2 leading-relaxed max-w-[760px]">{f.purpose || f.doc || 'Назначение файла ещё не описано.'}</p>
      {f.error && <div className="text-danger-soft text-[13px] mt-2">{f.error}</div>}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <div className="flex bg-panel-2 border border-hairline rounded-xl p-1">
          {[['fns', `Функции (${items.length})`], ['code', 'Весь код']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${tab === k ? 'bg-bronze text-[#1A1409]' : 'text-mist hover:text-stone'}`}>{label}</button>
          ))}
        </div>
        <div className="flex-1" />
        {nf > 0 && <button className="btn" onClick={() => onExplain({ kind: 'file', file })}><SparkIcon className="w-4 h-4" />Объяснить файл ({nf})</button>}
      </div>
      {tab === 'fns' ? (
        <div className="flex flex-col gap-0.5 max-w-[900px]">
          {items.map((it) => (
            <button key={it.id} onClick={() => dispatch(go({ t: 'fn', id: it.id }))} className={`text-left px-3.5 py-2.5 rounded-xl hover:bg-panel-2 transition-colors ${it.name.includes('.') && it.kind !== 'route' ? 'pl-8' : ''}`}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-mono text-[13px]">{it.name.includes('.') ? it.name.split('.').slice(1).join('.') : it.name}</span>
                <KindTag kind={it.kind} />
                <Badge status={it.status} />
                <span className="flex-1" />
                <span className="font-mono text-[10.5px] text-mist-dim tabular-nums">{it.line}–{it.end}</span>
              </div>
              {it.phrase && <div className="text-[12.5px] text-mist mt-1 leading-snug">{it.phrase}</div>}
            </button>
          ))}
        </div>
      ) : code === null ? <div className="text-mist text-[13px]">Загружаю код…</div> : (
        <CodeView code={code} lang={f.lang} maxHeight="calc(100vh - 290px)" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- функция
function Editor({ view, it, expl, onDone }) {
  const dispatch = useDispatch();
  const [v, setV] = useState({ phrase: expl?.phrase || '', what: expl?.what || '', io: expl?.io || '', example: expl?.example || '', watch: expl?.watch || '' });
  const field = (k, label, hint, rows = 3) => (
    <label className="block" htmlFor={`ed-${k}`}>
      <div className="text-[13px] font-semibold mt-3">{label}</div>
      {hint && <div className="text-[11.5px] text-mist-dim">{hint}</div>}
      {k === 'phrase'
        ? <input id={`ed-${k}`} className="input mt-1" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        : <textarea id={`ed-${k}`} rows={rows} className="input mt-1 resize-y leading-relaxed" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </label>
  );
  async function save() {
    try {
      await window.mimis.saveExplanation(view.id, it.id, v);
      await dispatch(reloadSession(view.id));
      dispatch(toast('Пояснение сохранено'));
      onDone();
    } catch (e) { dispatch(toast(e.message, 'error')); }
  }
  return (
    <div>
      {field('phrase', 'Коротко, одной фразой', 'Показывается в списке функций файла.')}
      {field('what', '1. Что делает', 'Сначала идея, потом детали.', 4)}
      {field('io', '2. Что на входе и что на выходе')}
      {field('example', '4. Пример')}
      {field('watch', '5. На что обратить внимание')}
      <div className="text-[11.5px] text-mist-dim mt-2">Связи (раздел 3) строятся из кода автоматически.</div>
      <div className="flex gap-2 mt-4"><button className="btn-bronze" onClick={save}>Сохранить</button><button className="btn" onClick={onDone}>Отмена</button></div>
    </div>
  );
}

function Sec({ n, title, children }) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-2 mb-1.5"><span className="font-mono text-[11px] text-mist-dim">{n}</span><span className="font-display font-semibold text-[15px]">{title}</span></div>
      {children}
    </div>
  );
}

function FnView({ view, ix, id, onExplain }) {
  const dispatch = useDispatch();
  const it = ix.itemById[id];
  const f = ix.fileByPath[it.file];
  const expl = view.expl[id];
  const code = useCode(view, it.file);
  const [editing, setEditing] = useState(false);
  const [whole, setWhole] = useState(false);
  useEffect(() => { setEditing(false); setWhole(false); }, [id]);
  const callers = ix.callers[id] || [];
  const calls = ix.calls[id] || [];

  async function confirm() {
    await window.mimis.confirmExplanation(view.id, id);
    await dispatch(reloadSession(view.id));
    dispatch(toast('Пояснение отмечено как актуальное'));
  }

  const links = (arr, kindOf) => (arr.length ? <div className="flex flex-wrap gap-1.5">{arr.map((x) => <FnLink key={x} ix={ix} id={x} passed={kindOf(x) === 'ref'} />)}</div> : <div className="text-[13px] text-mist-dim">Нет в коде проекта.</div>);

  return (
    <div>
      <div className="label-mono mb-1.5 flex items-center gap-2"><KindTag kind={it.kind} /><Badge status={it.status} /></div>
      <h1 className="font-mono text-[19px] break-all">{it.name}</h1>
      <div className="font-mono text-[11px] text-mist-dim mt-1">{it.file} · строки {it.line}–{it.end}{it.route ? ` · ${it.route}` : ''}</div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-6 mt-5 items-start">
        {/* код функции — всегда на виду */}
        <div className="min-w-0 2xl:sticky 2xl:top-0">
          <div className="flex items-center justify-between mb-2">
            <div className="label-mono flex items-center gap-1.5"><CodeIcon className="w-3.5 h-3.5" />{whole ? 'Весь файл' : 'Код функции'}</div>
            <button className="btn-ghost" onClick={() => setWhole((w) => !w)}>{whole ? 'Только функция' : 'Показать в файле'}</button>
          </div>
          {code === null ? <div className="text-mist text-[13px]">Загружаю код…</div> : whole
            ? <CodeView code={code} lang={f.lang} mark={[it.line, it.end]} focus={it.line} maxHeight="70vh" />
            : <CodeView code={code} lang={f.lang} from={it.line} to={it.end} maxHeight="70vh" />}
        </div>

        <div className="min-w-0">
          {it.status === 'stale' && !editing && (
            <div className="rounded-xl bg-bronze-dim border border-bronze/30 px-4 py-3 mb-4 text-[13px] leading-relaxed">
              <b>Код изменился</b> после того, как написано это пояснение (коммит {expl.commit_short || '?'}, сейчас {view.commit?.short}). Проверь текст по коду.
              <div className="flex flex-wrap gap-2 mt-2.5">
                <button className="btn" onClick={confirm}>Пояснение всё ещё верно</button>
                <button className="btn" onClick={() => setEditing(true)}>Исправить вручную</button>
                <button className="btn-bronze py-2" onClick={() => onExplain({ kind: 'item', id })}><SparkIcon className="w-4 h-4" />Объяснить заново</button>
              </div>
            </div>
          )}
          {editing ? <Editor view={view} it={it} expl={expl} onDone={() => setEditing(false)} /> : (
            <>
              {!expl && (
                <div className="rounded-xl border border-dashed border-hairline px-4 py-4 text-[13.5px] text-mist">
                  Пояснение ещё не написано. Подпись, строки и связи взяты из кода.
                  <div className="flex gap-2 mt-3">
                    <button className="btn-bronze py-2" onClick={() => onExplain({ kind: 'item', id })}><SparkIcon className="w-4 h-4" />Объяснить с ИИ</button>
                    <button className="btn" onClick={() => setEditing(true)}>Написать самому</button>
                  </div>
                </div>
              )}
              {expl?.phrase && <p className="font-display text-[16.5px] leading-snug">{expl.phrase}</p>}
              {expl && <Sec n="1" title="Что делает"><p className="text-[14px] leading-relaxed">{expl.what}</p></Sec>}
              {expl && <Sec n="2" title="Что на входе и что на выходе"><p className="text-[14px] leading-relaxed">{expl.io}</p></Sec>}
              <Sec n="3" title="Связи">
                <FnDiagram view={view} ix={ix} id={id} />
                <div className="text-[12px] text-mist mb-1.5 mt-4">Кто вызывает</div>{links(callers, (x) => ix.edgeKind[`${x}>${id}`])}
                <div className="text-[12px] text-mist mb-1.5 mt-3">Кого вызывает</div>{links(calls, (x) => ix.edgeKind[`${id}>${x}`])}
                {calls.length > 0 && (
                  <button className="btn mt-4" onClick={() => dispatch(go({ t: 'scenario', id }))}><PathIcon className="w-4 h-4" />Пройти сценарий отсюда</button>
                )}
              </Sec>
              {expl && <Sec n="4" title="Пример"><div className="text-[13.5px] leading-relaxed bg-panel-2 border border-hairline-soft rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">{expl.example}</div></Sec>}
              {expl && <Sec n="5" title="На что обратить внимание"><div className="text-[13.5px] leading-relaxed bg-bronze-dim border border-bronze/25 rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">{expl.watch}</div></Sec>}
              {expl && (
                <div className="flex items-center gap-3 mt-5 text-[11.5px] text-mist-dim flex-wrap">
                  <span>{expl.edited ? 'Исправлено вручную' : `Написано: ${expl.model || 'ИИ'}`} · коммит {expl.commit_short} · {expl.updated}</span>
                  <button className="btn-ghost" onClick={() => setEditing(true)}>Редактировать</button>
                  {it.status === 'fresh' && <button className="btn-ghost" onClick={() => onExplain({ kind: 'item', id, force: true })}>Объяснить заново</button>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- требует внимания / словарь
function Todo({ view, ix }) {
  const dispatch = useDispatch();
  const stale = view.items.filter((i) => i.status === 'stale');
  const none = view.items.filter((i) => i.status === 'none');
  async function drop(id) {
    await window.mimis.deleteExplanation(view.id, id);
    dispatch(reloadSession(view.id));
  }
  const list = (arr) => (arr.length ? <div className="flex flex-wrap gap-1.5">{arr.map((i) => <FnLink key={i.id} ix={ix} id={i.id} />)}</div> : <div className="text-[13px] text-mist-dim">Нет.</div>);
  return (
    <div className="max-w-[900px]">
      <h1 className="font-display font-semibold text-[22px]">Требует внимания</h1>
      <Sec n="⚠" title={`Код изменился после пояснения (${stale.length})`}>{list(stale)}</Sec>
      <Sec n="○" title={`Нет пояснения (${none.length})`}>{list(none.slice(0, 300))}{none.length > 300 && <div className="text-[12px] text-mist-dim mt-2">…и ещё {none.length - 300}</div>}</Sec>
      <Sec n="×" title={`Пояснения к удалённым функциям (${view.orphans.length})`}>
        {view.orphans.length ? view.orphans.map((o) => (
          <div key={o} className="flex items-center gap-3 mb-1.5"><span className="font-mono text-[12px] break-all">{o}</span><button className="btn-ghost" onClick={() => drop(o)}>Удалить пояснение</button></div>
        )) : <div className="text-[13px] text-mist-dim">Нет.</div>}
        {view.orphans.length > 0 && <div className="text-[12px] text-mist-dim mt-1">Функция могла быть переименована — тогда новая появится в списке «Нет пояснения».</div>}
      </Sec>
    </div>
  );
}

function Terms({ view }) {
  return (
    <div className="max-w-[760px]">
      <h1 className="font-display font-semibold text-[22px]">Словарь терминов</h1>
      <p className="text-[13.5px] text-mist mt-1.5">Термины, которые встретились в этом коде, простыми словами.</p>
      {view.terms.length === 0 && <div className="text-[13.5px] text-mist mt-5">Словарь пополняется, когда ИИ объясняет код.</div>}
      <dl className="mt-5 flex flex-col gap-3">
        {view.terms.map((t) => (
          <div key={t.term} className="card px-4 py-3"><dt className="font-display font-semibold text-[15px]">{t.term}</dt><dd className="text-[13.5px] text-stone mt-1 leading-relaxed">{t.definition}</dd></div>
        ))}
      </dl>
    </div>
  );
}

export default function Panel({ view, ix, onExplain }) {
  const dispatch = useDispatch();
  const depth = useSelector((s) => s.session.stack.length);
  const top = useSelector((s) => s.session.stack[s.session.stack.length - 1]);
  let body;
  if (top.t === 'layer') body = <LayerView view={view} ix={ix} id={top.id} />;
  else if (top.t === 'file' && ix.fileByPath[top.file]) body = <FileView key={top.file} view={view} ix={ix} file={top.file} onExplain={onExplain} />;
  else if (top.t === 'fn' && ix.itemById[top.id]) body = <FnView view={view} ix={ix} id={top.id} onExplain={onExplain} />;
  else if (top.t === 'scenarios') body = <ScenarioList view={view} ix={ix} />;
  else if (top.t === 'scenario' && ix.itemById[top.id]) body = <ScenarioView key={top.id} view={view} ix={ix} id={top.id} />;
  else if (top.t === 'todo') body = <Todo view={view} ix={ix} />;
  else if (top.t === 'terms') body = <Terms view={view} />;
  else body = <Overview view={view} ix={ix} onExplain={onExplain} />;
  return (
    <main className="flex-1 min-w-0 overflow-y-auto scroll-thin px-8 py-6">
      <Crumbs view={view} ix={ix} />
      <ErrorBoundary resetKey={`${depth}:${JSON.stringify(top)}`} onBack={() => dispatch(back())}>{body}</ErrorBoundary>
    </main>
  );
}
