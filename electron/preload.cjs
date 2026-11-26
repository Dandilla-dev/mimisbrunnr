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
  createSession: (input, branch) => call('sessions:create', input, branch),
  branches: (id, refresh) => call('branches:list', id, refresh),
  switchBranch: (id, branch) => call('branches:switch', id, branch),
  peekBranches: (input) => call('branches:peek', input),
  updateSession: (id) => call('sessions:update', id),
  viewSession: (id) => call('sessions:view', id),
  code: (id, file) => call('sessions:code', id, file),
  deleteSession: (id) => call('sessions:delete', id),
  estimate: (id, scope) => call('explain:estimate', id, scope),
  startExplain: (id, scope) => call('explain:start', id, scope),
  stopExplain: (id) => call('explain:stop', id),
  startBatch: (id, scope) => call('batch:start', id, scope),
  checkBatch: (id) => call('batch:check', id),
  cancelBatch: (id, forget) => call('batch:cancel', id, forget),
  explainState: (id) => call('explain:state', id),
  saveExplanation: (id, itemId, entry) => call('expl:save', id, itemId, entry),
  confirmExplanation: (id, itemId) => call('expl:confirm', id, itemId),
  deleteExplanation: (id, itemId) => call('expl:delete', id, itemId),
  moveExplanation: (id, from, to) => call('expl:move', id, from, to),
  dismissRename: (id, from, to) => call('expl:dismissRename', id, from, to),
  deleteOrphans: (id) => call('expl:deleteOrphans', id),
  estimateStory: (id, entry, depth) => call('story:estimate', id, entry, depth),
  runStory: (id, entry, depth) => call('story:run', id, entry, depth),
  flow: (id, itemId) => call('flow:get', id, itemId),
  estimateWalk: (id, itemId) => call('walk:estimate', id, itemId),
  runWalk: (id, itemId) => call('walk:run', id, itemId),
  testAi: () => call('ai:test'),
  logError: (text) => ipcRenderer.send('log:error', String(text).slice(0, 20000)),
  setGpu: (on) => call('gpu:set', on),
  pickFolder: () => call('dialog:folder'),
  saveImage: (name, ext, data) => call('image:save', name, ext, data),
  openExternal: (url) => call('open:external', url),
  onProgress: (fn) => on('progress', fn),
  onExplain: (fn) => on('explain', fn),
});
