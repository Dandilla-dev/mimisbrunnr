// Поле «ссылка на репозиторий или папка» + кнопка выбора папки + выбор ветки.
import { useEffect, useState } from 'react';
import { FolderIcon, BranchIcon } from '../components/icons';

const looksLikeGithub = (s) => /github\.com\/[\w.-]+\/[\w.-]+/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s.trim());
const looksLikeFolder = (s) => /^(\/|~|[A-Za-z]:[\\/])/.test(s.trim());

export default function RepoInput({ id, value, onChange, disabled, branch, onBranch }) {
  const [info, setInfo] = useState(null); // { type, list, default, current } | { error }
  async function pick() {
    const dir = await window.mimis.pickFolder();
    if (dir) onChange(dir);
  }
  // по ссылке — спрашиваем у GitHub список веток (с паузой, пока человек печатает)
  useEffect(() => {
    setInfo(null);
    onBranch?.(null);
    const v = value.trim();
    if (!v || (!looksLikeGithub(v) && !looksLikeFolder(v))) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      window.mimis.peekBranches(v)
        .then((r) => { if (alive) { setInfo(r); if (r.type === 'github') onBranch?.(r.current || r.default); } })
        .catch((e) => alive && setInfo({ error: e.message }));
    }, 600);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://github.com/владелец/репозиторий"
          disabled={disabled}
          spellCheck={false}
        />
        <button type="button" className="btn whitespace-nowrap" onClick={pick} disabled={disabled} title="Выбрать папку на этом компьютере">
          <FolderIcon className="w-4 h-4" /> Папка
        </button>
      </div>
      {info?.type === 'github' && info.list.length > 0 && (
        <div className="flex items-center gap-2 mt-2 text-[12.5px]">
          <BranchIcon className="w-4 h-4 text-mist" />
          <label htmlFor={`${id}-branch`} className="text-mist">Ветка:</label>
          <select id={`${id}-branch`} className="input py-1 w-auto max-w-[320px]" value={branch || ''} onChange={(e) => onBranch?.(e.target.value)} disabled={disabled}>
            {info.list.map((b) => <option key={b.name} value={b.name}>{b.name}{b.name === info.default ? ' — основная' : ''}</option>)}
          </select>
          <span className="text-mist-dim">{info.list.length} {info.list.length === 1 ? 'ветка' : 'веток'} в репозитории; потом можно переключаться в окне разбора</span>
        </div>
      )}
      {info?.type === 'local' && info.current && (
        <div className="flex items-center gap-2 mt-2 text-[12.5px] text-mist">
          <BranchIcon className="w-4 h-4" />Папка сейчас на ветке <span className="font-mono text-stone">{info.current}</span>
          {info.list.length > 1 ? ` (всего веток: ${info.list.length})` : ''}. Разберу то, что лежит в папке.
        </div>
      )}
      {info?.error && looksLikeGithub(value) && <div className="text-[12px] text-mist-dim mt-2">Список веток не получен: {info.error} Разберу основную ветку.</div>}
    </div>
  );
}
