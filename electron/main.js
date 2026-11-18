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
  });

  handle('state', () => ({ ...core.state(), dataDir: path.join(app.getPath('userData'), 'data'), version: app.getVersion() }));
  handle('settings:update', (patch) => core.updateSettings(patch));
  handle('sessions:list', () => core.listSessions());
  handle('sessions:create', (input) => core.createSession(input, (m) => send('progress', { kind: 'load', message: m })));
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
  handle('explain:state', (id) => core.jobState(id));
  handle('expl:save', (id, itemId, entry) => core.saveExplanation(id, itemId, entry));
  handle('expl:confirm', (id, itemId) => core.confirmExplanation(id, itemId));
  handle('expl:delete', (id, itemId) => core.deleteExplanation(id, itemId));
  handle('ai:test', () => core.testConnection());
  handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Папка с кодом', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('open:external', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
