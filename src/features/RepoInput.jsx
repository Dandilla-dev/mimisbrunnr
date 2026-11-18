// Поле «ссылка на репозиторий или папка» + кнопка выбора папки.
import { FolderIcon } from '../components/icons';

export default function RepoInput({ id, value, onChange, disabled }) {
  async function pick() {
    const dir = await window.mimis.pickFolder();
    if (dir) onChange(dir);
  }
  return (
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
  );
}
