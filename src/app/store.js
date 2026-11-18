// Состояние интерфейса. Данные живут в главном процессе (window.mimis),
// здесь — то, что сейчас на экране.
import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const api = () => window.mimis;

export const loadState = createAsyncThunk('app/loadState', async () => {
  const [state, sessions] = await Promise.all([api().state(), api().listSessions()]);
  return { ...state, sessions };
});
export const refreshSessions = createAsyncThunk('app/refreshSessions', () => api().listSessions());
export const saveSettings = createAsyncThunk('app/saveSettings', (patch) => api().updateSettings(patch));

export const createSession = createAsyncThunk('session/create', async (input, { dispatch }) => {
  const view = await api().createSession(input);
  dispatch(refreshSessions());
  return view;
});
export const openSession = createAsyncThunk('session/open', (id) => api().viewSession(id));
export const reloadSession = createAsyncThunk('session/reload', (id) => api().viewSession(id));
export const updateSession = createAsyncThunk('session/update', async (id, { dispatch }) => {
  const view = await api().updateSession(id);
  dispatch(refreshSessions());
  return view;
});
export const runStory = createAsyncThunk('session/story', async ({ id, entry, depth }) => {
  const r = await api().runStory(id, entry, depth);
  return { ...r.view, storyResult: r.result };
});
export const deleteSession = createAsyncThunk('session/delete', async (id, { dispatch }) => {
  await api().deleteSession(id);
  dispatch(refreshSessions());
  return id;
});

let toastId = 0;
const appSlice = createSlice({
  name: 'app',
  initialState: { ready: false, settings: null, presets: [], sessions: [], screen: 'home', dataDir: '', version: '', toasts: [], loading: null, error: null },
  reducers: {
    setScreen(s, a) { s.screen = a.payload; },
    progress(s, a) { s.loading = a.payload; },
    toast: {
      reducer(s, a) { s.toasts.push(a.payload); },
      prepare(text, tone = 'info') { toastId += 1; return { payload: { id: toastId, text, tone } }; },
    },
    dismissToast(s, a) { s.toasts = s.toasts.filter((t) => t.id !== a.payload); },
  },
  extraReducers: (b) => {
    b.addCase(loadState.fulfilled, (s, a) => {
      Object.assign(s, { ready: true, settings: a.payload.settings, presets: a.payload.presets, sessions: a.payload.sessions, dataDir: a.payload.dataDir, version: a.payload.version });
      s.screen = a.payload.settings.name ? 'home' : 'welcome';
    });
    b.addCase(loadState.rejected, (s, a) => { s.ready = true; s.error = a.error.message; });
    b.addCase(refreshSessions.fulfilled, (s, a) => { s.sessions = a.payload; });
    b.addCase(saveSettings.fulfilled, (s, a) => { s.settings = a.payload; });
    for (const t of [createSession, updateSession]) {
      b.addCase(t.pending, (s) => { s.loading = 'Начинаю…'; s.error = null; });
      b.addCase(t.fulfilled, (s) => { s.loading = null; s.screen = 'session'; });
      b.addCase(t.rejected, (s, a) => { s.loading = null; s.error = a.error.message; });
    }
    b.addCase(openSession.fulfilled, (s) => { s.screen = 'session'; s.error = null; });
    b.addCase(openSession.rejected, (s, a) => { s.error = a.error.message; });
    b.addCase(deleteSession.fulfilled, (s) => { s.screen = 'home'; });
  },
});

// Навигация внутри сессии: стек экранов панели справа.
const sessionSlice = createSlice({
  name: 'session',
  initialState: { view: null, stack: [{ t: 'overview' }], job: null, lastUpdate: null },
  reducers: {
    go(s, a) { s.stack.push(a.payload); },
    back(s) { if (s.stack.length > 1) s.stack.pop(); },
    home(s) { s.stack = [{ t: 'overview' }]; },
    job(s, a) { s.job = a.payload; },
    clearJob(s) { s.job = null; },
  },
  extraReducers: (b) => {
    const setView = (s, a) => {
      const sameSession = s.view?.id === a.payload.id;
      s.view = a.payload;
      if (!sameSession) { s.stack = [{ t: 'overview' }]; s.job = null; }
      // убрать из истории то, чего больше нет
      const ids = new Set(a.payload.items.map((i) => i.id));
      const files = new Set(a.payload.files.map((f) => f.path));
      const layers = new Set(a.payload.layers.map((l) => l.id));
      s.stack = s.stack.filter((v) => (!['fn', 'scenario'].includes(v.t) || ids.has(v.id)) && (v.t !== 'file' || files.has(v.file)) && (v.t !== 'layer' || layers.has(v.id)));
      if (!s.stack.length) s.stack = [{ t: 'overview' }];
    };
    b.addCase(createSession.fulfilled, setView);
    b.addCase(openSession.fulfilled, setView);
    b.addCase(reloadSession.fulfilled, setView);
    b.addCase(runStory.fulfilled, setView);
    b.addCase(updateSession.fulfilled, (s, a) => { setView(s, a); s.lastUpdate = a.payload.lastUpdate; });
    b.addCase(deleteSession.fulfilled, (s) => { s.view = null; });
  },
});

export const { setScreen, progress, toast, dismissToast } = appSlice.actions;
export const { go, back, home, job, clearJob } = sessionSlice.actions;

export const store = configureStore({ reducer: { app: appSlice.reducer, session: sessionSlice.reducer } });
