// Сценарии: путь от точки входа по вызовам, шаг за шагом.
// Цепочку строит код (места вызовов из разбора), рассказ по желанию пишет ИИ.
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { go, runStory, toast } from '../../app/store';
import CodeView from '../../components/CodeView';
import { BackIcon, NextIcon, PathIcon, SparkIcon } from '../../components/icons';
import { entryPoints, buildScenario, ROLE_RU } from '../../../core/scenario.js';
import { useCode } from './useCode';
import { KIND_RU } from './useIndex';
import { layerColor } from './MapColumn';

const DEPTHS = [2, 3, 4, 6];
// цвет роли шага на пути запроса
const ROLE_TONE = {
  request: 'text-stone border-mist-dim', router: 'text-mist border-hairline', middleware: 'text-[#9AA5C9] border-[#9AA5C9]/40',
  auth: 'text-[#D98787] border-[#D98787]/40', validate: 'text-[#C8B27A] border-[#C8B27A]/40', dependency: 'text-[#9AA5C9] border-[#9AA5C9]/40',
  controller: 'text-bronze border-bronze/50', service: 'text-[#7FA08A] border-[#7FA08A]/40', repository: 'text-[#8FB59A] border-[#8FB59A]/40',
  entity: 'text-[#A9C2D8] border-[#A9C2D8]/40', data: 'text-mist border-hairline', schema: 'text-[#C8B27A] border-[#C8B27A]/40', response: 'text-[#7FA08A] border-[#7FA08A]/50', 'error-branch': 'text-[#D98787] border-[#D98787]/40', error: 'text-[#D98787] border-[#D98787]/40',
};
export const RoleChip = ({ role }) => (role ? <span className={`text-[9.5px] font-mono uppercase tracking-wide border rounded px-1 py-[1px] flex-shrink-0 ${ROLE_TONE[role] || 'text-mist border-hairline'}`}>{ROLE_RU[role] || role}</span> : null);
const DEFAULT_DEPTH = 4;
// router.post("/chat", response_model=…) → POST /chat
export function routeLabel(it) {
  if (it.kind === 'route') return it.name;
  const m = (it.route || '').match(/\.(get|post|put|patch|delete|websocket|api_route|route)\(\s*[rf]?["']([^"']*)/i);
  return m ? `${m[1] === 'websocket' ? 'WS' : m[1].toUpperCase()} ${m[2]}` : '';
}
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

// ---------------------------------------------------------------- список
export function ScenarioList({ view, ix }) {
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const groups = useMemo(() => entryPoints(view), [view]);
  const stories = useMemo(() => Object.fromEntries((view.stories || []).map((s) => [s.entry, s])), [view]);
  const s = q.trim().toLowerCase();
  const total = groups.reduce((a, g) => a + g.ids.length, 0);
  return (
    <div className="max-w-[980px]">
      <h1 className="font-display font-semibold text-[22px]">Сценарии</h1>
      <p className="text-[13.5px] text-mist mt-1.5 leading-relaxed max-w-[760px]">
        Сценарий — путь выполнения: с чего всё начинается и что вызывается дальше, шаг за шагом, в том порядке, в каком вызовы стоят в коде.
        Выбери начало. Цепочку строит разбор кода — бесплатно; связный рассказ по шагам можно попросить у ИИ.
      </p>
      {!ix.sites.ordered && (
        <div className="rounded-xl bg-bronze-dim border border-bronze/30 px-4 py-3 mt-4 text-[13px] leading-relaxed">
          Этот разбор сделан прошлой версией Mímisbrunnr: порядок вызовов и условия (if / else) в нём не сохранены. Нажми «Обновить код» вверху — сценарии станут точнее.
        </div>
      )}
      <div className="mt-5 mb-4 w-[340px] max-w-full">
        <label htmlFor="sc-q" className="sr-only">Найти начало сценария</label>
        <input id="sc-q" className="input py-2" placeholder={`Найти среди ${total}…`} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      {(view.web?.routes || []).length > 0 && (() => {
        const rs = view.web.routes.filter((r) => !s || `${r.method} ${r.path} ${ix.itemById[r.chain.find((c) => c.role === 'handler')?.id || r.id]?.name || ''}`.toLowerCase().includes(s));
        if (!rs.length) return null;
        const limit = open.__routes || s ? rs.length : 16;
        return (
          <section className="mt-6">
            <div className="flex items-baseline gap-2"><h2 className="font-display font-semibold text-[16px]">Запросы к приложению</h2><span className="font-mono text-[11px] text-mist-dim">{rs.length}</span></div>
            <div className="text-[12.5px] text-mist mt-0.5 mb-2.5">Что происходит с запросом от прихода до ответа: промежуточные обработчики, проверки доступа и данных, обработчик, сервисы, база данных, ответ и ошибки.</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {rs.slice(0, limit).map((r) => {
                const h = ix.itemById[r.chain.find((c) => c.role === 'handler')?.id] || ix.itemById[r.id];
                const st = stories[r.id];
                return (
                  <button key={`${r.method} ${r.path} ${r.id}`} onClick={() => dispatch(go({ t: 'scenario', id: r.id, method: r.method }))}
                    className="text-left card px-3.5 py-2.5 hover:border-bronze/60 transition-colors" style={{ borderLeft: `3px solid ${layerColor(view, ix.fileByPath[h?.file]?.layer)}` }}>
                    {st?.title && <div className="font-display text-[14px] text-stone leading-snug">{st.title}</div>}
                    <div className="font-mono text-[12.5px] truncate"><span className="text-bronze/90">{r.method}</span> {r.path}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">{r.chain.map((c, i) => <RoleChip key={i} role={c.role === 'handler' ? 'controller' : c.role} />)}</div>
                    <div className="font-mono text-[10.5px] text-mist-dim truncate mt-1">{h ? `${h.name} · ${h.file}` : r.file}</div>
                  </button>
                );
              })}
            </div>
            {rs.length > limit && <button className="btn-ghost mt-2" onClick={() => setOpen((o) => ({ ...o, __routes: true }))}>Показать все {rs.length}</button>}
          </section>
        );
      })()}
      {groups.length === 0 && <div className="text-[13.5px] text-mist">В этом коде не нашлось точек входа: маршрутов, обработчиков, main. Сценарий можно начать с любой функции — кнопка «Пройти сценарий отсюда» на её странице.</div>}
      {groups.map((g0) => {
        const g = g0.title === 'Маршруты API' && view.web?.routes?.length ? { ...g0, title: 'Другие маршруты', ids: g0.ids.filter((id) => !view.web.routes.some((r) => r.id === id)) } : g0;
        const ids = s ? g.ids.filter((id) => ix.itemById[id].name.toLowerCase().includes(s) || (ix.itemById[id].route || '').toLowerCase().includes(s)) : g.ids;
        if (!ids.length) return null;
        const limit = open[g.title] || s ? ids.length : 12;
        return (
          <section key={g.title} className="mt-6">
            <div className="flex items-baseline gap-2"><h2 className="font-display font-semibold text-[16px]">{g.title}</h2><span className="font-mono text-[11px] text-mist-dim">{ids.length}</span></div>
            <div className="text-[12.5px] text-mist mt-0.5 mb-2.5">{g.hint}</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {ids.slice(0, limit).map((id) => {
                const it = ix.itemById[id];
                const st = stories[id];
                const n = (ix.calls[id] || []).length;
                return (
                  <button key={id} onClick={() => dispatch(go({ t: 'scenario', id }))}
                    className="text-left card px-3.5 py-2.5 hover:border-bronze/60 transition-colors"
                    style={{ borderLeft: `3px solid ${layerColor(view, ix.fileByPath[it.file]?.layer)}` }}>
                    {st?.title && <div className="font-display text-[14px] text-stone leading-snug">{st.title}</div>}
                    <div className="font-mono text-[12.5px] truncate">{routeLabel(it) && it.kind !== 'route' ? <span className="text-bronze/90">{routeLabel(it)} · </span> : ''}{it.name}</div>
                    <div className="font-mono text-[10.5px] text-mist-dim truncate mt-0.5">{it.file}:{it.line} · {n} {plural(n, 'вызов', 'вызова', 'вызовов')}{it.phrase ? ` · ${it.phrase}` : ''}</div>
                  </button>
                );
              })}
            </div>
            {ids.length > limit && <button className="btn-ghost mt-2" onClick={() => setOpen((o) => ({ ...o, [g.title]: true }))}>Показать все {ids.length}</button>}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- один сценарий
function StepRow({ step, it, active, onClick, story }) {
  return (
    <button onClick={onClick} data-step={step.n}
      className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${active ? 'bg-panel-2 ring-1 ring-bronze/60' : 'hover:bg-panel-2/70'}`}
      style={{ paddingLeft: 10 + step.depth * 16 }}>
      {step.ctx && <div className="font-mono text-[10.5px] text-bronze/80 truncate">{step.ctx}</div>}
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10.5px] text-mist-dim w-6 flex-shrink-0 text-right">{step.n}</span>
        <RoleChip role={step.role} />
        <span className={`font-mono text-[12.5px] truncate ${step.repeat || step.synthetic ? 'text-mist' : ''} ${step.role === 'request' ? 'text-stone' : ''}`}>
          {step.synthetic ? step.label : step.label && step.label !== it?.name ? <>{step.label} <span className="text-mist-dim">→ {it?.name}</span></> : it?.name}
        </span>
        {step.kind === 'ref' && <span className="text-[10px] text-mist border border-dashed border-mist-dim rounded px-1 flex-shrink-0">передаётся</span>}
        {step.repeat && <span className="text-[10.5px] text-mist-dim flex-shrink-0">↩ было выше</span>}
        {step.cut && <span className="text-[10.5px] text-mist-dim flex-shrink-0">… дальше</span>}
        {story && <span className="w-1.5 h-1.5 rounded-full bg-bronze flex-shrink-0" title="есть рассказ" />}
      </div>
    </button>
  );
}

function StoryButton({ view, id, depth, story, fresh }) {
  const dispatch = useDispatch();
  const job = useSelector((s) => (s.session.job?.id === view.id ? s.session.job : null));
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEst(null); }, [id, depth]);
  async function ask() {
    try { setEst(await window.mimis.estimateStory(view.id, id, depth)); } catch (e) { dispatch(toast(e.message, 'error')); }
  }
  async function run() {
    setBusy(true);
    const r = await dispatch(runStory({ id: view.id, entry: id, depth }));
    setBusy(false); setEst(null);
    if (r.error) dispatch(toast(r.error.message, 'error'));
    else dispatch(toast(`Рассказ готов: ${r.payload.storyResult.steps} из ${r.payload.storyResult.total} шагов, $${r.payload.storyResult.cost.toFixed(4)}.`));
  }
  if (busy) return <button className="btn border-bronze/50 text-bronze" disabled><SparkIcon className="w-4 h-4 animate-spin" style={{ animationDuration: '3s' }} />Пишу рассказ…</button>;
  if (est) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
        <span className="text-mist">{est.steps} {plural(est.steps, 'шаг', 'шага', 'шагов')}, ~{(est.estIn / 1000).toFixed(1)}k + {(est.estOut / 1000).toFixed(1)}k токенов{est.priced ? `, ~$${est.estCost.toFixed(3)}` : ''}</span>
        <button className="btn-bronze py-1.5" onClick={run}>Рассказать</button>
        <button className="btn-ghost" onClick={() => setEst(null)}>Отмена</button>
      </div>
    );
  }
  return (
    <button className={story && fresh ? 'btn' : 'btn-bronze py-2'} onClick={ask} disabled={job?.status === 'running'} title={job?.status === 'running' ? 'Сейчас идёт объяснение' : undefined}>
      <SparkIcon className="w-4 h-4" />{story ? (fresh ? 'Рассказать заново' : 'Рассказать по новому коду') : 'Рассказать сценарий (ИИ)'}
    </button>
  );
}

export function ScenarioView({ view, ix, id, method }) {
  const dispatch = useDispatch();
  const [depth, setDepth] = useState(() => (view.stories || []).find((s) => s.entry === id)?.depth || DEFAULT_DEPTH);
  const sc = useMemo(() => buildScenario(view, id, { depth, index: ix.sites, method }), [view, id, depth, ix, method]);
  const story = (view.stories || []).find((s) => s.entry === id && s.depth === depth);
  const fresh = story && story.hash === sc.hash;
  const [cur, setCur] = useState(1);
  const [where, setWhere] = useState(false);
  useEffect(() => { setCur(1); }, [id, depth]);
  useEffect(() => { setWhere(false); }, [cur]);
  const step = sc.steps[cur - 1] || sc.steps[0];
  const it = ix.itemById[step.id];
  const parent = step.parent ? sc.steps[step.parent - 1] : null;
  const pit = parent && ix.itemById[parent.id];
  const children = sc.steps.filter((s) => s.parent === step.n);
  const entry = ix.itemById[id];
  const showIt = where && pit ? pit : it;
  const codeFile = step.synthetic ? (step.file || entry.file) : showIt.file;
  const code = useCode(view, codeFile);
  const lang = ix.fileByPath[codeFile]?.lang;
  const route = sc.route;

  useEffect(() => {
    const h = (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setCur((c) => Math.min(sc.steps.length, c + 1)); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setCur((c) => Math.max(1, c - 1)); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sc.steps.length]);
  useEffect(() => {
    document.querySelector(`[data-step="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const text = fresh || story ? story?.texts?.[step.n] : null;
  const expl = view.expl[step.id];
  return (
    <div>
      <div className="label-mono mb-1.5 flex items-center gap-2"><PathIcon className="w-3.5 h-3.5" />Сценарий</div>
      <h1 className="font-display font-semibold text-[22px] leading-snug">{story?.title || (route ? <span className="font-mono">{route.method} {route.path}</span> : entry.name)}</h1>
      <div className="font-mono text-[11px] text-mist-dim mt-1">
        {route ? `путь запроса · ${{ express: 'Express', fastify: 'Fastify', nest: 'NestJS', fastapi: 'FastAPI', flask: 'Flask' }[route.fw] || route.fw} · ` : ''}
        {story?.title && !route ? `${entry.name} · ` : ''}{entry.file}:{entry.line}{routeLabel(entry) && entry.kind !== 'route' && !route ? ` · ${routeLabel(entry)}` : ''}
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <span className="text-[12px] text-mist">Глубина:</span>
        {DEPTHS.map((d) => (
          <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-1 rounded-md text-[12px] border ${depth === d ? 'border-bronze text-bronze' : 'border-hairline text-mist hover:text-stone'}`}>{d}</button>
        ))}
        <span className="text-[12px] text-mist-dim ml-1">{sc.steps.length} {plural(sc.steps.length, 'шаг', 'шага', 'шагов')}</span>
        <div className="flex-1" />
        <StoryButton view={view} id={id} depth={depth} story={story} fresh={fresh} />
      </div>

      {!sc.ordered && <div className="text-[12.5px] text-bronze mt-3">Порядок шагов приблизительный: разбор сделан прошлой версией. Нажми «Обновить код», чтобы увидеть точный порядок и условия.</div>}
      {sc.truncated && <div className="text-[12.5px] text-mist mt-3">Показаны первые {sc.steps.length} шагов. Уменьши глубину или начни сценарий с шага поглубже.</div>}
      {story?.summary && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-[14px] leading-relaxed border ${fresh ? 'bg-panel border-hairline' : 'bg-bronze-dim border-bronze/30'}`}>
          {!fresh && <div className="text-[12px] text-bronze mb-1">Код изменился после этого рассказа — текст может не совпадать с шагами.</div>}
          {story.summary}
          <div className="text-[11px] text-mist-dim mt-2">Рассказ: {story.model} · {story.updated}</div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] gap-6 mt-5 items-start">
        <div className="card p-1.5 max-h-[72vh] overflow-y-auto scroll-thin xl:sticky xl:top-0">
          {sc.steps.map((s) => <StepRow key={s.n} step={s} it={ix.itemById[s.id]} active={s.n === step.n} onClick={() => setCur(s.n)} story={story?.texts?.[s.n]} />)}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button className="btn-ghost border border-hairline" disabled={cur <= 1} onClick={() => setCur(cur - 1)}><BackIcon className="w-3.5 h-3.5" />Назад</button>
            <span className="font-mono text-[11.5px] text-mist">шаг {step.n} из {sc.steps.length}</span>
            <button className="btn-ghost border border-hairline" disabled={cur >= sc.steps.length} onClick={() => setCur(cur + 1)}>Дальше<NextIcon className="w-3.5 h-3.5" /></button>
            <span className="text-[11px] text-mist-dim hidden md:inline">или стрелки на клавиатуре</span>
          </div>

          {step.synthetic ? (
            <>
              <div className="mt-4 flex items-center gap-2 flex-wrap"><RoleChip role={step.role} /><h2 className="font-mono text-[17px] break-all">{step.label}</h2></div>
              {step.about && <div className="text-[13.5px] text-stone mt-2 leading-relaxed whitespace-pre-wrap">{step.about}</div>}
              {step.role === 'request' && route && <div className="text-[13px] text-mist mt-2 leading-relaxed">Дальше по шагам — всё, через что пройдёт запрос: {route.chain.map((c) => ROLE_RU[c.role === 'handler' ? 'controller' : c.role]).join(' → ')}{route.errors?.length ? ', а при ошибке — обработчик ошибок' : ''}.</div>}
            </>
          ) : (
            <>
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <RoleChip role={step.role} />
                <span className="font-mono text-[9.5px] uppercase tracking-wide text-mist-dim border border-hairline rounded px-1.5 py-[1px]">{KIND_RU[it.kind] || it.kind}</span>
                <h2 className="font-mono text-[17px] break-all">{step.label && step.label !== it.name ? <>{step.label} <span className="text-mist">→ {it.name}</span></> : it.name}</h2>
              </div>
              <div className="font-mono text-[11px] text-mist-dim mt-1">{it.file}:{it.line}–{it.end}</div>
              {step.about && <div className="text-[13px] text-mist mt-1.5">{step.about}</div>}
              {parent && step.line > 0 && pit && (
                <div className="text-[13px] text-mist mt-2 leading-relaxed">
                  {step.kind === 'ref' ? 'Передаётся из ' : 'Вызывается из '}
                  <button className="font-mono text-stone hover:text-bronze" onClick={() => setCur(parent.n)}>{pit.name}</button>
                  {step.line ? <>, строка {step.line}</> : null}
                  {step.ctx && <> — внутри <span className="font-mono text-bronze/90">{step.ctx}</span></>}
                  {step.kind === 'ref' && '. Здесь функция не вызывается сразу: её отдают дальше (в onClick, аргументом, в список), и вызовут позже.'}
                </div>
              )}
            </>
          )}
          {step.repeat && <div className="text-[13px] text-mist mt-2">Эта функция уже встречалась выше — второй раз её шаги не раскрываются.</div>}
          {step.cut && <div className="text-[13px] text-mist mt-2">Дальше есть вызовы, но глубина сценария закончилась. Увеличь глубину или пройди сценарий отсюда.</div>}

          {text && <div className="mt-3 rounded-xl bg-panel border border-bronze/30 px-4 py-3 text-[14px] leading-relaxed">{text}</div>}
          {!text && !step.synthetic && (expl?.what || it.phrase) && <div className="mt-3 text-[13.5px] leading-relaxed text-stone">{expl?.what || it.phrase}</div>}

          {step.synthetic ? (step.file && step.line > 0 && code !== null && (
            <div className="mt-4"><CodeView code={code} lang={lang} from={Math.max(1, step.line - 2)} to={step.line + 8} focus={step.line} mark={[step.line, step.line]} maxHeight="40vh" /></div>
          )) : (<>
          <div className="flex items-center gap-2 mt-4 mb-2 flex-wrap">
            {parent && step.line > 0 && pit && (
              <div className="flex rounded-lg border border-hairline overflow-hidden text-[12px]">
                <button className={`px-2.5 py-1 ${!where ? 'bg-panel-2 text-bronze' : 'text-mist hover:text-stone'}`} onClick={() => setWhere(false)}>Код шага</button>
                <button className={`px-2.5 py-1 ${where ? 'bg-panel-2 text-bronze' : 'text-mist hover:text-stone'}`} onClick={() => setWhere(true)}>Где вызывается</button>
              </div>
            )}
            {!where && children.length > 0 && <span className="text-[11.5px] text-mist-dim">Точкой слева отмечены строки, откуда идут следующие шаги.</span>}
            <div className="flex-1" />
            <button className="btn-ghost" onClick={() => dispatch(go({ t: 'fn', id: showIt.id }))}>Открыть функцию</button>
            {step.n > 1 && (ix.calls[step.id] || []).length > 0 && <button className="btn-ghost" onClick={() => dispatch(go({ t: 'scenario', id: step.id }))}>Сценарий отсюда</button>}
          </div>
          {code === null ? <div className="text-mist text-[13px]">Загружаю код…</div> : where && pit
            ? <CodeView code={code} lang={lang} from={pit.line} to={pit.end} focus={step.line} maxHeight="60vh" />
            : <CodeView code={code} lang={lang} from={it.line} to={it.end} points={new Set(children.map((c) => c.line).filter(Boolean))} maxHeight="60vh" />}
          {!where && children.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[12px] text-mist mr-1 self-center">Дальше:</span>
              {children.map((c) => (
                <button key={c.n} onClick={() => setCur(c.n)} className={`font-mono text-[12px] px-2 py-1 rounded-md border bg-panel-2 hover:border-bronze hover:text-bronze ${c.kind === 'ref' ? 'border-dashed border-mist-dim' : 'border-hairline'}`}>
                  {c.n}. {ix.itemById[c.id]?.name}{c.line ? <span className="text-mist-dim"> · стр. {c.line}</span> : null}
                </button>
              ))}
            </div>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}
