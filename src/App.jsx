import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadState, setScreen, job, reloadSession, refreshSessions, toast, dismissToast, progress } from './app/store';
import { NordicDefs, NordicPatternLayer, GreenGlow, Emblem } from './components/Decor';
import { ScrollIcon, SlidersIcon } from './components/icons';
import WelcomeScreen from './features/WelcomeScreen';
import HomeScreen from './features/HomeScreen';
import SettingsScreen from './features/SettingsScreen';
import SessionScreen from './features/session/SessionScreen';
import ErrorBoundary from './components/ErrorBoundary';

function NavRail() {
  const dispatch = useDispatch();
  const screen = useSelector((s) => s.app.screen);
  const hasSession = useSelector((s) => Boolean(s.session.view));
  const items = [
    { id: 'home', label: 'РАЗБОРЫ', Icon: ScrollIcon, active: screen === 'home' || screen === 'session' },
    { id: 'settings', label: 'НАСТРОЙКИ', Icon: SlidersIcon, active: screen === 'settings' },
  ];
  return (
    <nav className="relative z-20 w-24 flex-shrink-0 bg-rail-bg border-r border-hairline-soft flex flex-col items-center py-5">
      <div className="mb-6" title="Mímisbrunnr"><Emblem size={46} /></div>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => dispatch(setScreen(it.id === 'home' && screen !== 'session' && hasSession ? 'session' : it.id === 'home' && screen === 'session' ? 'home' : it.id))}
          className={`w-[72px] mt-1 px-1 pt-2.5 pb-3 flex flex-col items-center gap-1.5 rounded-xl transition-colors ${it.active ? 'bg-panel text-bronze' : 'text-mist-dim hover:bg-panel'}`}
        >
          <it.Icon className="w-[19px] h-[19px]" />
          <span className="font-mono text-[9.5px] tracking-wide text-center">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Toasts() {
  const dispatch = useDispatch();
  const toasts = useSelector((s) => s.app.toasts);
  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => dispatch(dismissToast(toasts[0].id)), 5500);
    return () => clearTimeout(t);
  }, [toasts, dispatch]);
  return (
    <div className="fixed right-5 bottom-5 z-50 flex flex-col gap-2 max-w-[420px]">
      {toasts.map((t) => (
        <button key={t.id} onClick={() => dispatch(dismissToast(t.id))} className={`text-left text-[13px] px-4 py-3 rounded-xl border shadow-2xl animate-modal-in ${t.tone === 'error' ? 'bg-panel border-danger/50 text-danger-soft' : 'bg-panel-2 border-hairline text-stone'}`}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const { ready, screen, error } = useSelector((s) => s.app);
  const viewId = useSelector((s) => s.session.view?.id);

  useEffect(() => { dispatch(loadState()); }, [dispatch]);

  // события из главного процесса: ход загрузки и ход объяснения
  useEffect(() => {
    const offP = window.mimis.onProgress((p) => dispatch(progress(p.message)));
    const offE = window.mimis.onExplain((st) => {
      dispatch(job(st));
      if (st.status !== 'running') {
        dispatch(reloadSession(st.id));
        dispatch(refreshSessions());
        if (st.status === 'done') dispatch(toast(`Готово: объяснено ${st.done} из ${st.total}.`));
        if (st.status === 'budget') dispatch(toast('Остановился по лимиту бюджета. Готовое сохранено.'));
        if (st.status === 'error') dispatch(toast(st.log?.filter(Boolean).slice(-1)[0] || 'Ошибка при объяснении', 'error'));
      }
    });
    return () => { offP(); offE(); };
  }, [dispatch]);

  let body = null;
  if (!ready) body = <div className="relative z-10 flex-1 flex items-center justify-center text-mist">Загрузка…</div>;
  else if (error && screen !== 'welcome' && screen !== 'home') body = <div className="relative z-10 flex-1 p-10 text-danger-soft">{error}</div>;
  else if (screen === 'welcome') body = <WelcomeScreen />;
  else if (screen === 'settings') body = <SettingsScreen />;
  else if (screen === 'session' && viewId) body = <SessionScreen />;
  else body = <HomeScreen />;

  return (
    <div className="relative flex h-screen bg-ink overflow-hidden">
      <NordicDefs />
      <GreenGlow />
      <NordicPatternLayer opacity={0.07} />
      {ready && screen !== 'welcome' && <NavRail />}
      <ErrorBoundary resetKey={screen} onBack={() => dispatch(setScreen('home'))}>{body}</ErrorBoundary>
      <Toasts />
    </div>
  );
}
