// Загрузка кода: публичный (или приватный с токеном) репозиторий GitHub —
// zip-архивом, без git; или папка на этом компьютере.
// Код репозитория — чужие данные: мы его только читаем, ничего не запускаем
// и не пишем на диск (архив распаковывается в память).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { grammarFor } from './parse/treesitter.js';

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', 'env', '__pycache__', '.idea', '.vscode',
  '.pytest_cache', '.mypy_cache', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.cache', 'vendor', 'release',
  // учебные мини-проекты для тестов: это не код самого проекта (иначе их сущности и маршруты смешаются с настоящими)
  'fixtures', '__fixtures__', 'testdata',
]);
const MAX_FILE = 400_000; // байт: больше — скорее сгенерированный или минифицированный файл
const MAX_FILES = 4000;
const MAX_ZIP = 200 * 1024 * 1024;

const API = () => process.env.MIMIS_GITHUB_API || 'https://api.github.com';
const CODELOAD = () => process.env.MIMIS_GITHUB_CODELOAD || 'https://codeload.github.com';

export class FetchError extends Error {}

function wanted(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p) || (p.startsWith('.') && p.length > 1))) return false;
  if (/\.min\.js$|\.d\.ts$|\.bundle\.js$/.test(rel)) return false;
  return Boolean(grammarFor(rel)) || rel.endsWith(".prisma");
}

/** Разбирает строку пользователя: ссылка GitHub, owner/repo или путь к папке. */
export function parseTarget(input) {
  const s = String(input || '').trim();
  if (!s) throw new FetchError('Укажи ссылку на репозиторий или папку.');
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('~') || s.startsWith('\\\\')) {
    const p = s.startsWith('~') ? path.join(process.env.HOME || process.env.USERPROFILE || '', s.slice(1)) : s;
    return { type: 'local', path: path.resolve(p) };
  }
  let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?(?:[?#].*)?$/i)
    || s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i)
    || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { type: 'github', owner: m[1], repo: m[2], branch: m[3] ? decodeURIComponent(m[3]) : null };
  if (/^https?:\/\//.test(s)) throw new FetchError('Пока я умею загружать только репозитории GitHub. Для других — скачай код и укажи папку.');
  throw new FetchError('Не понимаю ссылку. Пример: https://github.com/owner/repo');
}

async function getJson(fetchFn, url, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Mimisbrunnr' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetchFn(url, { headers });
  if (r.status === 404) throw new FetchError('Репозиторий не найден. Проверь ссылку; для приватного репозитория нужен токен GitHub в настройках.');
  if (r.status === 403 || r.status === 429) throw new FetchError('GitHub временно ограничил запросы (лимит без токена — 60 в час). Подожди или добавь токен GitHub в настройках.');
  if (!r.ok) throw new FetchError(`GitHub ответил ошибкой ${r.status}.`);
  return r.json();
}

/** Список веток репозитория GitHub: { default, branches: [{ name, sha }] }. */
export async function listGithubBranches(target, { fetchFn = fetch, token } = {}) {
  const { owner, repo } = target;
  const info = await getJson(fetchFn, `${API()}/repos/${owner}/${repo}`, token);
  const branches = [];
  for (let page = 1; page <= 5; page++) {
    const list = await getJson(fetchFn, `${API()}/repos/${owner}/${repo}/branches?per_page=100&page=${page}`, token);
    if (!Array.isArray(list) || !list.length) break;
    for (const b of list) branches.push({ name: b.name, sha: b.commit?.sha || '' });
    if (list.length < 100) break;
  }
  branches.sort((a, b) => (a.name === info.default_branch ? -1 : b.name === info.default_branch ? 1 : a.name.localeCompare(b.name)));
  return { default: info.default_branch, branches };
}

/** Последний коммит ветки (без скачивания кода) — чтобы понять, нужно ли качать заново. */
export async function githubHead(target, { fetchFn = fetch, token } = {}) {
  const { owner, repo } = target;
  let branch = target.branch;
  if (!branch) branch = (await getJson(fetchFn, `${API()}/repos/${owner}/${repo}`, token)).default_branch;
  const c = await getJson(fetchFn, `${API()}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token);
  return { branch, sha: c.sha };
}

/**
 * Ветки git в папке на компьютере — только чтение файлов .git, git не запускается.
 * { current, branches: [имена], remote: { owner, repo } | null }
 */
export function localGitInfo(root) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) { // worktree / submodule: «gitdir: …»
      const m = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
      if (!m) return null;
      gitDir = path.resolve(root, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const current = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null;
    const names = new Set();
    (function walkRefs(dir, prefix) {
      let list = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        if (e.isDirectory()) walkRefs(path.join(dir, e.name), `${prefix}${e.name}/`);
        else names.add(prefix + e.name);
      }
    })(path.join(gitDir, 'refs', 'heads'), '');
    try {
      for (const l of fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n')) {
        const m = l.match(/^[0-9a-f]{40} refs\/heads\/(.+)$/);
        if (m) names.add(m[1]);
      }
    } catch { /* нет packed-refs */ }
    let remote = null;
    try {
      const cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
      const m = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
      const t = m && parseTargetSafe(m[1]);
      if (t?.type === 'github') remote = { owner: t.owner, repo: t.repo };
    } catch { /* нет config */ }
    return { current, branches: [...names].sort(), remote };
  } catch { return null; }
}
const parseTargetSafe = (s) => { try { return parseTarget(s); } catch { return null; } };

export async function fetchGithub(target, { fetchFn = fetch, token, onProgress = () => {} } = {}) {
  const { owner, repo } = target;
  onProgress('Спрашиваю GitHub о репозитории…');
  let branch = target.branch;
  let commit = null;
  try {
    const info = await getJson(fetchFn, `${API()}/repos/${owner}/${repo}`, token);
    branch ||= info.default_branch;
    const c = await getJson(fetchFn, `${API()}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token);
    commit = { hash: c.sha, short: c.sha.slice(0, 7), date: (c.commit?.committer?.date || '').slice(0, 16).replace('T', ' '), subject: (c.commit?.message || '').split('\n')[0] };
  } catch (e) {
    if (!(e instanceof FetchError) || /не найден/.test(e.message)) throw e;
    onProgress(`${e.message} Пробую скачать архив напрямую…`);
  }
  const ref = commit ? commit.hash : branch ? `refs/heads/${branch}` : 'HEAD';
  onProgress('Скачиваю архив с кодом…');
  const headers = { 'User-Agent': 'Mimisbrunnr' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetchFn(`${CODELOAD()}/${owner}/${repo}/zip/${ref}`, { headers });
  if (!r.ok) throw new FetchError(`Не удалось скачать архив (${r.status}).`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_ZIP) throw new FetchError('Архив больше 200 МБ — слишком большой репозиторий.');
  onProgress('Распаковываю…');
  let entries;
  try {
    entries = unzipSync(buf, {
      // в память берём только исходники нужных языков
      filter: (f) => f.originalSize <= MAX_FILE && wanted(f.name.split('/').slice(1).join('/')),
    });
  } catch (e) {
    throw new FetchError(`Архив повреждён: ${e.message}`);
  }
  const files = [];
  for (const [name, data] of Object.entries(entries)) {
    const rel = name.split('/').slice(1).join('/'); // первая папка в архиве — owner-repo-sha
    if (!rel || rel.includes('..')) continue;
    files.push({ path: rel, text: strFromU8(data) });
    if (files.length >= MAX_FILES) break;
  }
  if (!commit) {
    const h = crypto.createHash('sha1').update(buf).digest('hex');
    commit = { hash: h, short: h.slice(0, 7), date: '', subject: 'коммит неизвестен (GitHub не ответил на запрос о коммите)' };
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    source: { type: 'github', url: `https://github.com/${owner}/${repo}`, owner, repo, branch: branch || '', label: `${owner}/${repo}` },
    commit, files,
  };
}

export async function fetchLocal(target, { onProgress = () => {} } = {}) {
  const root = target.path;
  let st;
  try { st = fs.statSync(root); } catch { throw new FetchError(`Папка не найдена: ${root}`); }
  if (!st.isDirectory()) throw new FetchError(`Это не папка: ${root}`);
  onProgress('Читаю файлы из папки…');
  const files = [];
  const hash = crypto.createHash('sha1');
  (function walkDir(dir) {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of list) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walkDir(full); continue; }
      if (!wanted(rel)) continue;
      try {
        if (fs.statSync(full).size > MAX_FILE) continue;
        const text = fs.readFileSync(full, 'utf8');
        hash.update(rel).update(text);
        files.push({ path: rel, text });
      } catch { /* нет доступа — пропускаем */ }
    }
  })(root);
  const h = hash.digest('hex');
  const now = new Date();
  return {
    source: { type: 'local', path: root, label: path.basename(root), branch: localGitInfo(root)?.current || '' },
    commit: { hash: h, short: h.slice(0, 7), date: now.toISOString().slice(0, 16).replace('T', ' '), subject: 'папка на этом компьютере' },
    files,
  };
}

export async function fetchTarget(input, opts) {
  const t = typeof input === 'string' ? parseTarget(input) : input;
  return t.type === 'local' ? fetchLocal(t, opts) : fetchGithub(t, opts);
}
