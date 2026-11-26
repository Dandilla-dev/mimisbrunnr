// «Что здесь из языка и фреймворков»: заметки встроенного справочника для кода функции.
// Без ИИ и без интернета — по тому, что встречается в коде.
import { useMemo, useState } from 'react';
import { handbookFor } from '../../../core/handbook.js';

export default function HandbookNotes({ it, code, lang }) {
  const notes = useMemo(() => {
    if (code === null || code === undefined) return [];
    const own = code.split('\n').slice(it.line - 1, it.end).join('\n');
    return handbookFor(own, { fileCode: code, lang, limit: 12 });
  }, [it, code, lang]);
  const [open, setOpen] = useState(() => new Set());
  if (!notes.length) return <div className="text-[13px] text-mist-dim">Ничего особенного из языка или фреймворков здесь не встретилось.</div>;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div>
      <div className="text-[12px] text-mist mb-2 leading-relaxed">Нажми, чтобы прочитать. Это заметки встроенного справочника — они одинаковы для любого проекта; ИИ тоже получает их, когда объясняет этот код.</div>
      <div className="flex flex-col gap-1.5">
        {notes.map((e) => (
          <div key={e.id} className={`rounded-xl border ${open.has(e.id) ? 'border-hairline bg-panel-2' : 'border-hairline-soft'}`}>
            <button className="w-full text-left px-3.5 py-2 flex items-center gap-2" onClick={() => toggle(e.id)} aria-expanded={open.has(e.id)}>
              <span className="text-[10px] font-mono uppercase tracking-wide text-mist border border-hairline rounded px-1.5 py-[1px] flex-shrink-0">{e.fw}</span>
              <span className="text-[13.5px] font-medium flex-1">{e.title}</span>
              <span className="text-mist-dim text-[12px]">{open.has(e.id) ? '−' : '+'}</span>
            </button>
            {open.has(e.id) && <div className="px-3.5 pb-3 text-[13.5px] leading-relaxed text-stone">{e.text}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
