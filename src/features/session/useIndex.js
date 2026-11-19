// Индексы по данным сессии: чтобы не искать по массивам на каждом экране.
import { useMemo } from 'react';
import { sitesIndex } from '../../../core/scenario.js';

export const KIND_RU = { function: 'функция', method: 'метод', class: 'класс', component: 'компонент', hook: 'хук', route: 'маршрут', entity: 'сущность' };

export function useIndex(view) {
  return useMemo(() => {
    if (!view) return null;
    const itemById = {};
    const itemsByFile = {};
    for (const it of view.items) {
      itemById[it.id] = it;
      (itemsByFile[it.file] ||= []).push(it);
    }
    const fileByPath = Object.fromEntries(view.files.map((f) => [f.path, f]));
    const filesByLayer = {};
    for (const f of view.files) (filesByLayer[f.layer] ||= []).push(f);
    const calls = {}, callers = {};
    const edgeKind = {};
    for (const [a, b, k] of view.edges) { (calls[a] ||= []).push(b); (callers[b] ||= []).push(a); edgeKind[`${a}>${b}`] = k || 'call'; }
    const layerStats = {};
    for (const l of view.layers) {
      const items = (filesByLayer[l.id] || []).flatMap((f) => itemsByFile[f.path] || []);
      layerStats[l.id] = { files: (filesByLayer[l.id] || []).length, items: items.length, notFresh: items.filter((i) => i.status !== 'fresh').length };
    }
    return { itemById, itemsByFile, fileByPath, filesByLayer, calls, callers, edgeKind, sites: sitesIndex(view), layerStats };
  }, [view]);
}
