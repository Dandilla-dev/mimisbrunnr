// Первый запуск: приветствие, имя, ссылка на репозиторий.
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Emblem, Wordmark } from '../components/Decor';
import { saveSettings, createSession } from '../app/store';
import RepoInput from './RepoInput';

const CAN = [
  'нарисую схему проекта: из каких частей он состоит и что где лежит',
  'покажу каждую функцию вместе с её кодом',
  'объясню простыми словами, что она делает, — с помощью ИИ, которого ты выберешь',
  'сохраню разбор: возвращаться к нему можно и без интернета',
];

export default function WelcomeScreen() {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((s) => s.app);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState(null);

  async function start(e) {
    e.preventDefault();
    if (!name.trim() || !repo.trim()) return;
    await dispatch(saveSettings({ name: name.trim() }));
    dispatch(createSession({ input: repo.trim(), branch }));
  }

  return (
    <div className="relative z-10 flex-1 flex items-center justify-center px-6 overflow-y-auto scroll-thin py-10">
      <div className="w-[520px] max-w-full animate-fade-in">
        <div className="flex flex-col items-center mb-7 text-center">
          <Emblem size={64} />
          <div className="mt-6"><Wordmark size={38} /></div>
          <p className="font-display text-[20px] text-stone mt-8 leading-snug">
            Приветствую тебя.
          </p>
          <p className="text-[14.5px] text-mist mt-1.5 leading-relaxed">
            Wisdom awaits
          </p>
        </div>

        <div className="card p-5 mb-5">
          <div className="label-mono mb-3">Что я умею</div>
          <ul className="flex flex-col gap-2">
            {CAN.map((t) => (
              <li key={t} className="flex gap-2.5 text-[13.5px] text-stone leading-snug">
                <span className="text-bronze font-mono mt-[1px]">ᚨ</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={start} className="card p-6 flex flex-col gap-4">
          <label className="block" htmlFor="w-name">
            <div className="label-mono mb-1.5">Как тебя зовут?</div>
            <input id="w-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoFocus disabled={Boolean(loading)} />
          </label>
          <div>
            <div className="label-mono mb-1.5">Какой код разобрать?</div>
            <RepoInput id="w-repo" value={repo} onChange={setRepo} branch={branch} onBranch={setBranch} disabled={Boolean(loading)} />
          </div>
          {error && <div className="font-mono text-[11.5px] text-danger-soft">{error}</div>}
          <button type="submit" className="btn-bronze mt-1" disabled={!name.trim() || !repo.trim() || Boolean(loading)}>
            {loading ? loading : 'Начать разбор'}
          </button>
          <div className="font-mono text-[10px] text-mist-dim text-center leading-relaxed">
            Схему я построю сразу и бесплатно. Пояснения пишет ИИ — его подключишь в настройках.
          </div>
        </form>
      </div>
    </div>
  );
}
