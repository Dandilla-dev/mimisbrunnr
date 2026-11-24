// С чего начинается программа: точка запуска и что читать дальше.
// Программу не читают по файлам сверху вниз — её читают с того места,
// откуда компьютер начинает её выполнять.
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { go } from '../../app/store';
import CodeView from '../../components/CodeView';
import { PlayIcon } from '../../components/icons';
import { useCode } from './useCode';

const KIND_HINT = {
  server: 'Здесь программа запускает веб-сервер: дальше она ждёт запросов. Всё остальное — маршруты, обработчики, база — подключается до этой строки или вызывается, когда приходит запрос.',
  app: 'Здесь создаётся веб-приложение. Сам сервер запускают отдельной командой (она обычно написана в README или Dockerfile), а этот файл — его начало: к приложению подключаются маршруты и настройки.',
  ui: 'Отсюда начинается интерфейс: эта строка рисует на странице главный компонент, а он — все остальные.',
  desktop: 'Это главный процесс программы для компьютера: он запускается первым и открывает окно. Интерфейс внутри окна — отдельная часть, она начинается со своей точки.',
  script: 'Этот файл запускают напрямую. Код под этой строкой выполняется первым.',
  cli: 'Программу запускают командой в терминале, и выполнение начинается здесь.',
  manifest: 'Этот файл указан в настройках проекта как первый, который запускается.',
};

function Entry({ view, ix, e, main }) {
  const dispatch = useDispatch();
  const code = useCode(view, e.file);
  const fn = e.fn && ix.itemById[e.fn];
  const lang = ix.fileByPath[e.file]?.lang;
  const rootComponent = e.kind === 'ui' ? view.items.find((i) => i.kind === 'component' && /^App$/.test(i.name)) : null;
  const routes = view.web?.routes || [];
  const outline = e.outline || [];
  const startAt = Math.max(0, outline.findIndex((o) => o.from <= e.line && o.to >= e.line));
  const [sel, setSel] = useState(outline.length ? 0 : -1);
  const step = outline[sel];
  const fnOf = (name) => (ix.itemsByFile[e.file] || []).find((i) => i.name === name);
  return (
    <div className={`card p-5 ${main ? 'border-bronze/50' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <PlayIcon className={`w-5 h-5 ${main ? 'text-bronze' : 'text-mist'}`} />
        <span className="font-display font-semibold text-[16px]">{e.title}</span>
        {main && <span className="text-[10px] font-mono uppercase tracking-wide text-bronze border border-bronze/50 rounded px-1.5 py-[1px]">начни отсюда</span>}
      </div>
      <button className="font-mono text-[13px] mt-1.5 hover:text-bronze break-all text-left" onClick={() => dispatch(go({ t: 'file', file: e.file, line: e.line }))}>{e.file}<span className="text-mist"> · строка {e.line}</span></button>
      <p className="text-[13.5px] text-stone mt-2.5 leading-relaxed">{KIND_HINT[e.kind]}</p>
      <div className="text-[12.5px] text-mist mt-2 leading-relaxed">
        <b className="text-stone font-medium">Как я это понял:</b>
        <ul className="list-disc pl-5 mt-1">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {e.cmd && <div className="mt-1">Команда запуска: <span className="font-mono text-stone">{e.cmd}</span></div>}
      </div>
      {outline.length > 0 ? (
        <div className="mt-4">
          <div className="text-[13px] font-medium mb-1">Что происходит в этом файле, по порядку</div>
          <div className="text-[12px] text-mist mb-2 leading-relaxed">Компьютер выполняет файл сверху вниз. Функции, которые тут объявлены, сразу не выполняются — только когда их вызовут. Нажми на шаг — справа его код.</div>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
            <ol className="flex flex-col gap-0.5">
              {outline.map((o, i) => {
                const decl = o.call && fnOf(o.call);
                return (
                  <li key={o.from}>
                    <button onClick={() => setSel(i)} className={`w-full text-left rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug flex gap-2 ${i === sel ? 'bg-panel-2 ring-1 ring-bronze/60' : 'hover:bg-panel-2/70'}`}>
                      <span className="font-mono text-[10.5px] text-mist-dim w-5 text-right flex-shrink-0 pt-[1px]">{i + 1}</span>
                      <span className="min-w-0">
                        <span>{o.text}</span>
                        {i === startAt && o.to > o.from && e.line > o.from && <span className="text-bronze"> — внутри, в строке {e.line}: {e.why.split(' — ')[1] || 'запуск'}</span>}
                        <span className="font-mono text-[10.5px] text-mist-dim"> · стр. {o.from}{o.to > o.from ? `–${o.to}` : ''}</span>
                        {decl && i === sel && <span className="block mt-1"><span className="text-bronze underline text-[12px]" role="link" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); dispatch(go({ t: 'fn', id: decl.id })); }}>открыть {decl.name}</span></span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {code !== null && step && <CodeView code={code} lang={lang} from={Math.max(1, step.from - 1)} to={Math.max(step.to + 3, step.from + 8)} focus={step.from} mark={[step.from, step.to]} maxHeight="46vh" />}
          </div>
        </div>
      ) : code !== null && <div className="mt-3"><CodeView code={code} lang={lang} from={Math.max(1, e.line - 4)} to={e.line + 10} focus={e.line} mark={[e.line, e.line]} maxHeight="34vh" /></div>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn" onClick={() => dispatch(go({ t: 'file', file: e.file, line: e.line }))}>Открыть файл на этой строке</button>
        {fn && <button className="btn" onClick={() => dispatch(go({ t: 'fn', id: fn.id }))}>Функция {fn.name}</button>}
        {fn && (ix.calls[fn.id] || []).length > 0 && <button className="btn-bronze" onClick={() => dispatch(go({ t: 'scenario', id: fn.id }))}>Пройти по шагам отсюда</button>}
        {rootComponent && <button className="btn-bronze" onClick={() => dispatch(go({ t: 'fn', id: rootComponent.id }))}>Дальше — главный компонент {rootComponent.name}</button>}
        {(e.kind === 'server' || e.kind === 'app') && routes.length > 0 && <button className="btn-bronze" onClick={() => dispatch(go({ t: 'scenarios' }))}>Дальше — маршруты ({routes.length})</button>}
      </div>
    </div>
  );
}

export default function StartView({ view, ix }) {
  const list = (view.entries || []).filter((e) => ix.fileByPath[e.file]);
  const kinds = new Set(list.map((e) => e.kind));
  const several = list.length > 1 && (kinds.has('ui') || kinds.has('desktop')) && (kinds.has('server') || kinds.has('app') || kinds.has('desktop'));
  return (
    <div className="max-w-[980px]">
      <div className="label-mono mb-1.5 flex items-center gap-2"><PlayIcon className="w-3.5 h-3.5" />С чего начать</div>
      <h1 className="font-display font-semibold text-[22px]">Откуда программа начинает работать</h1>
      <p className="text-[13.5px] text-mist mt-1.5 leading-relaxed max-w-[760px]">
        Код не читают по файлам сверху вниз. У программы есть точка запуска — место, с которого компьютер начинает её выполнять. Отсюда и стоит начинать разбор: смотришь, что здесь вызывается, и идёшь дальше по цепочке.
      </p>
      {view.entries === null && <div className="rounded-xl bg-bronze-dim border border-bronze/30 px-4 py-3 mt-4 text-[13px]">Этот разбор сделан прошлой версией Mímisbrunnr — точку запуска в нём ещё не искали. Нажми «Обновить код» вверху.</div>}
      {view.entries && !list.length && (
        <div className="card px-4 py-3 mt-4 text-[13.5px] leading-relaxed">
          Явной точки запуска не нашёл: нет <span className="font-mono">app.listen</span>, <span className="font-mono">uvicorn.run</span>, <span className="font-mono">if __name__ == "__main__"</span>, команды в package.json и т. п. Возможно, это библиотека — её не запускают, а подключают в другие программы. Тогда начинай с «Сценариев»: там функции, которые никто в проекте не вызывает, — это и есть «двери» библиотеки.
        </div>
      )}
      {several && <div className="text-[13.5px] text-stone mt-4 leading-relaxed">В этом проекте <b>несколько программ</b>, они запускаются отдельно: {list.map((e) => e.title.toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).join(' и ')}. Обычно интерфейс работает в браузере (или в окне), а сервер — отдельно, и общаются они запросами.</div>}
      <div className="flex flex-col gap-4 mt-5">
        {list.map((e, i) => <Entry key={e.file} view={view} ix={ix} e={e} main={i === 0} />)}
      </div>
    </div>
  );
}
