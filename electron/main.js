// Главный процесс Electron: окно, меню, мост между интерфейсом и ядром.
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, net, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MimisCore } from '../core/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.MIMIS_DEV === '1';
let win = null;
let core = null;

// для автотестов: отдельная папка данных
if (process.env.MIMIS_USER_DATA) app.setPath('userData', process.env.MIMIS_USER_DATA);

// ---- журнал: userData/logs/mimisbrunnr.log (последние ~1 МБ) ----
const logDir = path.join(app.getPath('userData'), 'logs');
const logFile = path.join(logDir, 'mimisbrunnr.log');
function log(...parts) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1_000_000) fs.renameSync(logFile, `${logFile}.old`);
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  } catch { /* журнал не обязателен */ }
}
process.on('uncaughtException', (e) => log('main: uncaughtException', e));
process.on('unhandledRejection', (e) => log('main: unhandledRejection', e));

// ---- видеокарта ----
// На некоторых связках Linux + Wayland (в том числе COSMIC) и при мониторах с разным
// масштабом окно Chromium может стать чёрным. Тогда помогает рисовать без видеокарты.
// Флаг ставится в настройках или сам — после повторных сбоев видеопроцесса.
const gpuFlag = path.join(app.getPath('userData'), 'gpu-off');
const gpuOff = fs.existsSync(gpuFlag) || process.env.MIMIS_NO_GPU === '1';
if (gpuOff) app.disableHardwareAcceleration();
let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  log('child-process-gone', d);
  if (d.type === 'GPU' && d.reason !== 'clean-exit') {
    gpuCrashes += 1;
    if (gpuCrashes >= 2 && !gpuOff) {
      try { fs.writeFileSync(gpuFlag, 'после сбоев видеопроцесса\n'); } catch { /* */ }
      log('gpu: видеопроцесс падал несколько раз — со следующего запуска рисую без видеокарты');
    }
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#111713',
    title: 'Mímisbrunnr',
    icon: path.join(here, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // окно упало или зависло — пишем в журнал и поднимаем заново, а не оставляем чёрным
  win.webContents.on('render-process-gone', (_e, d) => {
    log('render-process-gone', d);
    if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 500);
  });
  win.on('unresponsive', () => log('window: unresponsive'));
  win.on('responsive', () => log('window: responsive again'));
  win.webContents.on('preload-error', (_e, p, err) => log('preload-error', p, err));
  // Внешние ссылки — только в системный браузер, и только http(s).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(DEV ? 'http://localhost:5173' : 'file://')) e.preventDefault();
  });
  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));
}

// Каждый вызов из окна: ошибки возвращаем как { error }, чтобы показать их по-человечески.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

app.whenReady().then(() => {
  Menu.setApplicationMenu(DEV ? Menu.getApplicationMenu() : null);
  // данные первой версии лежали в папке «Магистр» — переносим один раз
  const dataDir = path.join(app.getPath('userData'), 'data');
  const oldDir = path.join(app.getPath('appData'), 'Магистр', 'data');
  if (!fs.existsSync(dataDir) && fs.existsSync(oldDir)) {
    try { fs.cpSync(oldDir, dataDir, { recursive: true }); } catch { /* не вышло — начнём с чистого листа */ }
  }
  core = new MimisCore(dataDir, {
    crypt: {
      available: safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
    },
    // net.fetch идёт через сетевой стек Chromium: учитывает системный прокси.
    fetchFn: (url, opts) => net.fetch(url, opts),
    log,
  });

  handle('state', () => ({ ...core.state(), dataDir: path.join(app.getPath('userData'), 'data'), logFile, gpuOff, gpuFlagSet: fs.existsSync(gpuFlag), version: app.getVersion() }));
  handle('gpu:set', (on) => { if (on) fs.rmSync(gpuFlag, { force: true }); else fs.writeFileSync(gpuFlag, 'выключено в настройках\n'); return fs.existsSync(gpuFlag); });
  ipcMain.on('log:error', (_e, text) => log('window:', text));
  log(`start ${app.getVersion()} · ${process.platform} · ${process.env.XDG_SESSION_TYPE || ''} ${process.env.XDG_CURRENT_DESKTOP || ''} · gpu ${gpuOff ? 'off' : 'on'}`);
  handle('settings:update', (patch) => core.updateSettings(patch));
  handle('sessions:list', () => core.listSessions());
  handle('sessions:create', (input, branch) => core.createSession(input, (m) => send('progress', { kind: 'load', message: m }), branch || null));
  handle('branches:list', (id, refresh) => core.branches(id, refresh));
  handle('branches:switch', (id, branch) => core.switchBranch(id, branch, (m) => send('progress', { kind: 'load', message: m })));
  handle('branches:peek', (input) => core.peekBranches(input));
  handle('sessions:update', (id) => core.updateSession(id, (m) => send('progress', { kind: 'load', message: m })));
  handle('sessions:view', (id) => core.view(id));
  handle('sessions:code', (id, file) => core.code(id, file));
  handle('sessions:delete', (id) => core.deleteSession(id));
  handle('explain:estimate', (id, scope) => core.estimate(id, scope));
  handle('explain:start', async (id, scope) => {
    const { promise } = await core.startExplain(id, scope, (st) => send('explain', { id, ...st }));
    promise.catch(() => {});
    return true;
  });
  handle('explain:stop', (id) => core.stopExplain(id));
  handle('batch:start', (id, scope) => core.startBatch(id, scope));
  handle('batch:check', (id) => core.checkBatch(id));
  handle('batch:cancel', (id, forget) => core.cancelBatch(id, forget));
  handle('explain:state', (id) => core.jobState(id));
  handle('expl:save', (id, itemId, entry) => core.saveExplanation(id, itemId, entry));
  handle('expl:confirm', (id, itemId) => core.confirmExplanation(id, itemId));
  handle('expl:delete', (id, itemId) => core.deleteExplanation(id, itemId));
  handle('story:estimate', (id, entry, depth) => core.estimateStory(id, entry, depth));
  handle('story:run', (id, entry, depth) => core.runStory(id, entry, depth));
  handle('flow:get', (id, itemId) => core.flow(id, itemId));
  handle('walk:estimate', (id, itemId) => core.estimateWalk(id, itemId));
  handle('walk:run', (id, itemId) => core.runWalk(id, itemId));
  handle('ai:test', () => core.testConnection());
  handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Папка с кодом', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  // схема картинкой: png приходит как base64, svg — текстом
  handle('image:save', async (name, ext, data) => {
    const safe = String(name || 'схема').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    let file;
    if (process.env.MIMIS_SAVE_DIR) file = path.join(process.env.MIMIS_SAVE_DIR, `${safe}.${ext}`);
    else {
      const r = await dialog.showSaveDialog(win, { title: 'Сохранить схему', defaultPath: path.join(app.getPath('pictures'), `${safe}.${ext}`), filters: [ext === 'png' ? { name: 'Картинка PNG', extensions: ['png'] } : { name: 'Векторная картинка SVG', extensions: ['svg'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    fs.writeFileSync(file, ext === 'png' ? Buffer.from(String(data), 'base64') : String(data));
    return file;
  });
  handle('open:external', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
