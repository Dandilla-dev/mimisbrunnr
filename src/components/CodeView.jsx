// Код с номерами строк и подсветкой синтаксиса (highlight.js, работает без интернета).
import { useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);

// highlight.js возвращает HTML, где <span> может тянуться через несколько строк.
// Режем по строкам и закрываем/переоткрываем незакрытые теги на границах.
function splitLines(html) {
  const out = [];
  let open = [];
  for (const line of html.split('\n')) {
    let cur = open.join('');
    const re = /<span[^>]*>|<\/span>/g;
    let m;
    const stack = [...open];
    while ((m = re.exec(line))) {
      if (m[0] === '</span>') stack.pop(); else stack.push(m[0]);
    }
    cur += line + '</span>'.repeat(stack.length);
    out.push(cur);
    open = stack;
  }
  return out;
}

/**
 * code — текст; from/to — какие строки файла показать (по умолчанию все);
 * mark — [начало, конец] подсвеченного диапазона; focus — строка, к которой прокрутить;
 * points — отдельные строки, отмеченные точкой слева (места вызовов в сценарии).
 */
export default function CodeView({ code, lang, from = 1, to, mark, focus, points, maxHeight = '60vh' }) {
  const ref = useRef(null);
  const lines = useMemo(() => {
    const all = code.split('\n');
    const last = Math.min(to || all.length, all.length);
    const slice = all.slice(from - 1, last).join('\n');
    let html;
    try {
      html = hljs.highlight(slice, { language: lang === 'python' ? 'python' : lang === 'typescript' ? 'typescript' : 'javascript', ignoreIllegals: true }).value;
    } catch {
      html = slice.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    }
    return splitLines(html);
  }, [code, lang, from, to]);

  useEffect(() => {
    if (!focus || !ref.current) return;
    const row = ref.current.querySelector(`[data-line="${focus}"]`);
    // прокручиваем только сам блок кода, а не всю страницу
    if (row) ref.current.scrollTop = Math.max(0, row.offsetTop - ref.current.clientHeight / 3);
  }, [focus, lines]);

  return (
    <div ref={ref} className="code-view relative bg-rail-bg border border-hairline-soft rounded-xl overflow-auto scroll-thin" style={{ maxHeight }}>
      <table className="border-collapse min-w-full">
        <tbody>
          {lines.map((html, i) => {
            const n = from + i;
            const inMark = mark && n >= mark[0] && n <= mark[1];
            return (
              <tr key={n} data-line={n} className={`${n === focus ? 'focus' : inMark ? 'hl' : ''} ${points?.has(n) ? 'pt' : ''}`}>
                <td className="ln align-top">{n}</td>
                {/* html — вывод highlight.js: исходный код в нём уже экранирован */}
                <td className="pr-4 whitespace-pre text-stone" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
