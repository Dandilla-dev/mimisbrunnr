// Настройки: имя, подключение ИИ, бюджет, токен GitHub.
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { saveSettings, setGpuFlag, toast } from '../app/store';

function Row({ label, hint, children }) {
  return (
    <div className="px-4 py-3.5 bg-panel-2 border border-hairline-soft rounded-[10px] flex flex-col gap-2">
      <div>
        <div className="text-[13.5px] text-stone">{label}</div>
        {hint && <div className="text-[11.5px] text-mist-dim mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <div className="label-mono mb-2.5">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

export default function SettingsScreen() {
  const dispatch = useDispatch();
  const { settings, presets, dataDir, logFile, gpuOff, gpuFlagSet, version } = useSelector((s) => s.app);
  const [name, setName] = useState(settings.name);
  const [prov, setProv] = useState(settings.provider);
  const [key, setKey] = useState('');
  const [gh, setGh] = useState('');
  const [budget, setBudget] = useState(String(settings.budgetUsd));
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const setP = (k, v) => setProv((p) => ({ ...p, [k]: v }));
  const applyPreset = (p) => setProv({ type: p.type, baseUrl: p.baseUrl, model: p.model, priceIn: p.priceIn, priceOut: p.priceOut });
  const presetNote = presets.find((p) => p.type === prov.type && p.baseUrl === prov.baseUrl && p.model === prov.model)?.note;

  async function save() {
    const patch = {
      name: name.trim() || settings.name,
      provider: { ...prov, priceIn: Number(prov.priceIn) || 0, priceOut: Number(prov.priceOut) || 0 },
      budgetUsd: Math.max(0, Number(String(budget).replace(',', '.')) || 0),
    };
    if (key) patch.apiKey = key;
    if (gh) patch.githubToken = gh;
    await dispatch(saveSettings(patch));
    setKey(''); setGh('');
    dispatch(toast('Настройки сохранены'));
  }
  async function clearSecret(field) {
    await dispatch(saveSettings({ [field]: '' }));
    dispatch(toast(field === 'apiKey' ? 'Ключ API удалён' : 'Токен GitHub удалён'));
  }
  async function runTest() {
    setBusy(true); setTest(null);
    try {
      await save();
      const r = await window.mimis.testAi();
      setTest({ ok: true, text: `Модель ответила «${r.reply}» за ${(r.ms / 1000).toFixed(1)} с.` });
    } catch (e) { setTest({ ok: false, text: e.message }); }
    setBusy(false);
  }

  return (
    <div className="relative z-10 flex-1 min-w-0 flex flex-col">
      <div className="px-8 py-4 border-b border-hairline-soft">
        <div className="font-display font-semibold text-[17px]">Настройки</div>
        <div className="font-mono text-[10px] text-mist-dim mt-0.5">Mímisbrunnr {version}</div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-8 pt-6 pb-10">
        <div className="max-w-[620px]">
          <Section title="Ученик">
            <Row label="Имя">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Row>
          </Section>

          <Section title="ИИ для пояснений">
            <Row label="Готовые варианты" hint="Подставляют тип, адрес и модель. Цены у провайдеров меняются — сверяйтесь с их сайтом.">
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button key={p.id} type="button" className="btn text-[12px] py-1.5" onClick={() => applyPreset(p)}>{p.label}</button>
                ))}
              </div>
            </Row>
            <Row label="Формат API">
              <select className="input" value={prov.type} onChange={(e) => setP('type', e.target.value)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI-совместимый (OpenAI, Ollama, LM Studio и другие)</option>
              </select>
            </Row>
            <Row label="Адрес API" hint={prov.type === 'anthropic' ? 'Пусто — https://api.anthropic.com' : 'Например https://api.openai.com/v1 или http://localhost:11434/v1 для Ollama'}>
              <input className="input font-mono text-[12.5px]" value={prov.baseUrl} onChange={(e) => setP('baseUrl', e.target.value)} placeholder={prov.type === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} spellCheck={false} />
            </Row>
            <Row label="Модель" hint={presetNote}>
              <input className="input font-mono text-[12.5px]" value={prov.model} onChange={(e) => setP('model', e.target.value)} placeholder="название модели у провайдера" spellCheck={false} />
            </Row>
            <Row
              label="Ключ API"
              hint={settings.hasApiKey
                ? `Ключ сохранён${settings.keyEncrypted ? ' и зашифрован средствами системы' : ' (шифрование системы недоступно — хранится открытым текстом на этом компьютере)'}. Чтобы заменить — введите новый.`
                : 'Для Ollama и других локальных моделей ключ не нужен.'}
            >
              <div className="flex gap-2">
                <input className="input font-mono text-[12.5px]" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.hasApiKey ? '••••••••  (сохранён)' : 'вставьте ключ'} autoComplete="off" />
                {settings.hasApiKey && <button type="button" className="btn" onClick={() => clearSecret('apiKey')}>Удалить</button>}
              </div>
            </Row>
            <Row label="Цена за 1 млн токенов, $" hint="Для оценки стоимости и лимита. Для бесплатных и локальных моделей — 0.">
              <div className="flex gap-2">
                <label className="flex-1"><span className="text-[11px] text-mist-dim">вход</span><input className="input" inputMode="decimal" value={prov.priceIn} onChange={(e) => setP('priceIn', e.target.value)} /></label>
                <label className="flex-1"><span className="text-[11px] text-mist-dim">выход</span><input className="input" inputMode="decimal" value={prov.priceOut} onChange={(e) => setP('priceOut', e.target.value)} /></label>
              </div>
            </Row>
            <Row label="Лимит на один запуск объяснения, $" hint={`Приложение остановится, не превысив эту сумму; готовое сохранится. Потрачено в этом месяце: $${settings.monthSpend.toFixed(3)}. Дополнительно поставьте лимит в кабинете провайдера.`}>
              <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </Row>
            <div className="flex items-center gap-2 mt-2">
              <button type="button" className="btn-bronze" onClick={save}>Сохранить</button>
              <button type="button" className="btn" onClick={runTest} disabled={busy}>{busy ? 'Проверяю…' : 'Проверить подключение'}</button>
            </div>
            {test && <div className={`text-[12.5px] mt-1 ${test.ok ? 'text-moss' : 'text-danger-soft'}`}>{test.text}</div>}
            <div className="text-[11.5px] text-mist-dim leading-relaxed mt-2">
              Вы подключаете сторонний сервис. Условия его использования, в том числе доступность в вашей стране, соблюдаете вы. Код, который вы разбираете, отправляется выбранному провайдеру.
            </div>
          </Section>

          <Section title="GitHub">
            <Row label="Токен GitHub (необязательно)" hint="Нужен для приватных репозиториев и снимает лимит GitHub в 60 запросов в час. Достаточно прав только на чтение.">
              <div className="flex gap-2">
                <input className="input font-mono text-[12.5px]" type="password" value={gh} onChange={(e) => setGh(e.target.value)} placeholder={settings.hasGithubToken ? '••••••••  (сохранён)' : 'ghp_…'} autoComplete="off" />
                {settings.hasGithubToken && <button type="button" className="btn" onClick={() => clearSecret('githubToken')}>Удалить</button>}
              </div>
            </Row>
            <div><button type="button" className="btn-bronze mt-2" onClick={save}>Сохранить</button></div>
          </Section>

          <Section title="Данные">
            <Row label="Где хранятся разборы и настройки" hint="Удаление этой папки сотрёт все разборы.">
              <code className="font-mono text-[12px] text-mist break-all">{dataDir}</code>
            </Row>
            <Row label="Журнал ошибок" hint="Если окно зависло или почернело — пришлите этот файл, по нему видно, что случилось.">
              <code className="font-mono text-[12px] text-mist break-all">{logFile}</code>
            </Row>
          </Section>
          <Section title="Экран">
            <Row label="Рисовать без видеокарты" hint="Включите, если окно иногда становится чёрным (бывает на Linux с Wayland и мониторами с разным масштабом). Работает после перезапуска приложения.">
              <label className="flex items-center gap-2 text-[13.5px] cursor-pointer w-fit" htmlFor="gpu-off">
                <input id="gpu-off" type="checkbox" className="accent-[#B98D55]" checked={gpuFlagSet}
                  onChange={async (e) => { const set = await window.mimis.setGpu(!e.target.checked); dispatch(setGpuFlag(set)); dispatch(toast('Изменится после перезапуска приложения.')); }} />
                {gpuOff ? 'Сейчас окно рисуется без видеокарты' : 'Сейчас окно рисуется видеокартой'}
              </label>
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
