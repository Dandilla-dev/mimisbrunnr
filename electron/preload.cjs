// Мост между окном и главным процессом. Окно не видит Node.js целиком —
// только эти функции.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function on(channel, fn) {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('mimis', {
  state: () => call('state'),
  updateSettings: (patch) => call('settings:update', patch),
  listSessions: () => call('sessions:list'),
  createSession: (input) => call('sessions:create', input),
  updateSession: (id) => call('sessions:update', id),
  viewSession: (id) => call('sessions:view', id),
  code: (id, file) => call('sessions:code', id, file),
  deleteSession: (id) => call('sessions:delete', id),
  estimate: (id, scope) => call('explain:estimate', id, scope),
  startExplain: (id, scope) => call('explain:start', id, scope),
  stopExplain: (id) => call('explain:stop', id),
  explainState: (id) => call('explain:state', id),
  saveExplanation: (id, itemId, entry) => call('expl:save', id, itemId, entry),
  confirmExplanation: (id, itemId) => call('expl:confirm', id, itemId),
  deleteExplanation: (id, itemId) => call('expl:delete', id, itemId),
  estimateStory: (id, entry, depth) => call('story:estimate', id, entry, depth),
  runStory: (id, entry, depth) => call('story:run', id, entry, depth),
  testAi: () => call('ai:test'),
  logError: (text) => ipcRenderer.send('log:error', String(text).slice(0, 20000)),
  setGpu: (on) => call('gpu:set', on),
  pickFolder: () => call('dialog:folder'),
  openExternal: (url) => call('open:external', url),
  onProgress: (fn) => on('progress', fn),
  onExplain: (fn) => on('explain', fn),
});
