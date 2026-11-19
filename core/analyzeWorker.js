// Разбор в отдельном потоке: большой репозиторий не подвешивает окно.
import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSources } from './analyze.js';

analyzeSources(workerData.sources)
  .then((r) => parentPort.postMessage({ ok: true, r }))
  .catch((e) => parentPort.postMessage({ ok: false, error: e?.message || String(e) }));
