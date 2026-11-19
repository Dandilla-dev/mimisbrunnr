// Сущности (модели данных): схема связей и карточки с полями.
import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { go } from '../../app/store';
import Graph from '../../components/Graph';
import { layerColor } from './MapColumn';

export const ORM_RU = {
  sequelize: 'Sequelize', mongoose: 'Mongoose', typeorm: 'TypeORM', prisma: 'Prisma', sqlalchemy: 'SQLAlchemy',
  sqlmodel: 'SQLModel', django: 'Django', pydantic: 'Pydantic', dataclass: 'dataclass', dto: 'DTO',
};
const DB_ORM = new Set(['sequelize', 'mongoose', 'typeorm', 'prisma', 'sqlalchemy', 'sqlmodel', 'django']);
const GROUPS = [
  ['db', 'Таблицы базы данных', 'Сущности, которые хранятся в базе: у каждой своя таблица (или коллекция), поля и связи с другими.'],
  ['check', 'Схемы проверки данных', 'Описания того, какие данные должны прийти в запросе или уйти в ответе. По ним фреймворк проверяет данные сам.'],
  ['plain', 'Структуры данных', 'Классы, которые просто хранят набор полей внутри программы (dataclass).'],
];
const groupOf = (e) => (DB_ORM.has(e.orm) ? 'db' : e.orm === 'pydantic' || e.orm === 'dto' ? 'check' : 'plain');
const REL = {
  belongsTo: ['принадлежит', 'N — 1'], hasOne: ['имеет одну', '1 — 1'], hasMany: ['имеет много', '1 — N'], belongsToMany: ['многие-ко-многим', 'N — N'],
};
const short = (id) => String(id || '').split('::').pop();

/** «У Book много Reader (как readers) через loans» */
export function relationText(e, r, ix) {
  const to = ix.itemById[r.to]?.name || short(r.to);
  const through = r.through ? ` через ${ix.itemById[r.throughId || r.through]?.name || short(r.through)}` : '';
  if (r.kind === 'belongsTo') return `${e.model} принадлежит ${to}${r.fk ? ` (по полю ${r.fk})` : ''}`;
  if (r.kind === 'hasOne') return `У ${e.model} одна запись ${to}`;
  if (r.kind === 'hasMany') return `У ${e.model} много ${to}`;
  return `${e.model} и ${to} — многие-ко-многим${through}`;
}

export function FieldsTable({ e }) {
  if (!e.fields.length) return <div className="text-[13px] text-mist-dim">Поля не найдены в коде.</div>;
  return (
    <div className="overflow-x-auto scroll-thin rounded-xl border border-hairline-soft">
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-mist-dim font-mono text-[10.5px] uppercase tracking-wide">
          <th className="px-3 py-2 font-normal">поле</th><th className="px-3 py-2 font-normal">тип</th><th className="px-3 py-2 font-normal">правила</th>
        </tr></thead>
        <tbody>
          {e.fields.map((f) => {
            const rules = [f.pk && 'ключ', f.auto && 'заполняется сам', f.required && 'обязательное', f.unique && 'уникальное', f.default && `по умолчанию ${f.default}`, f.ref && `ссылка на ${f.ref.model || f.ref.table}${f.ref.key ? `.${f.ref.key}` : ''}`, f.relation && 'связь', ...(f.validate || [])].filter(Boolean);
            return (
              <tr key={f.name} className="border-t border-hairline-soft align-top">
                <td className={`px-3 py-1.5 font-mono ${f.pk ? 'text-bronze' : ''}`}>{f.name}</td>
                <td className="px-3 py-1.5 font-mono text-mist">{f.type || '—'}</td>
                <td className="px-3 py-1.5 text-stone">{rules.join(' · ') || <span className="text-mist-dim">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Сведения о сущности на странице функции/класса. */
export function EntityInfo({ view, ix, e }) {
  const dispatch = useDispatch();
  const users = useMemo(() => {
    const seen = new Map();
    for (const [a, b, , , , label] of view.sites || []) if (b === e.id && !seen.has(`${a}|${label}`)) seen.set(`${a}|${label}`, { a, label });
    return [...seen.values()];
  }, [view, e.id]);
  const back = (view.entities || []).flatMap((o) => o.relations.filter((r) => r.to === e.id).map((r) => ({ o, r })));
  return (
    <div className="mb-2">
      <div className="text-[13px] text-mist">
        {ORM_RU[e.orm] || e.orm}{e.table ? <> · таблица <span className="font-mono text-stone">{e.table}</span></> : null}
        {e.timestamps && DB_ORM.has(e.orm) && e.orm === 'sequelize' ? ' · поля createdAt и updatedAt добавляются сами' : ''}
      </div>
      <div className="mt-3"><FieldsTable e={e} /></div>
      {(e.relations.length > 0 || back.length > 0) && (
        <div className="mt-4">
          <div className="text-[12px] text-mist mb-1.5">Связи</div>
          <div className="flex flex-col gap-1.5">
            {e.relations.map((r, i) => (
              <div key={i} className="text-[13.5px]">
                <button className="hover:text-bronze text-left" onClick={() => ix.itemById[r.to] && dispatch(go({ t: 'fn', id: r.to }))}>{relationText(e, r, ix)}</button>
                {r.as && <span className="text-mist"> · поле <span className="font-mono">{r.as}</span></span>}
                {r.methods?.length > 0 && <div className="text-[11.5px] text-mist-dim font-mono mt-0.5">методы от связи: {r.methods.slice(0, 6).join(', ')}{r.methods.length > 6 ? '…' : ''}</div>}
              </div>
            ))}
            {back.map(({ o, r }, i) => (
              <div key={`b${i}`} className="text-[13px] text-mist">
                <button className="hover:text-bronze" onClick={() => dispatch(go({ t: 'fn', id: o.id }))}>{relationText(o, r, ix)}</button> — связь описана у {o.model}
              </div>
            ))}
          </div>
        </div>
      )}
      {e.hooks?.length > 0 && <div className="mt-3 text-[12.5px] text-mist">Хуки и проверки: {e.hooks.join('; ')}</div>}
      {users.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] text-mist mb-1.5">Где с ней работают</div>
          <div className="flex flex-wrap gap-1.5">
            {users.slice(0, 40).map(({ a, label }) => (
              <button key={`${a}|${label}`} onClick={() => dispatch(go({ t: 'fn', id: a }))} className="font-mono text-[12px] px-2 py-1 rounded-md border border-hairline bg-panel-2 hover:border-bronze hover:text-bronze text-left">
                {ix.itemById[a]?.name}{label ? <span className="text-bronze/80"> · {label}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EntitiesView({ view, ix }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState({});
  const ents = view.entities || [];
  const groups = GROUPS.map(([k, title, hint]) => ({ k, title, hint, list: ents.filter((e) => groupOf(e) === k) })).filter((g) => g.list.length);
  // схема: сущности базы данных и те, у кого есть связи
  const { nodes, edges } = useMemo(() => {
    const shown = ents.filter((e) => groupOf(e) === 'db' || e.relations.length);
    const ids = new Set(shown.map((e) => e.id));
    const ns = shown.map((e) => ({ id: e.id, label: e.model, sub: `${e.table || ORM_RU[e.orm]} · ${e.fields.length} пол.`, color: layerColor(view, ix.fileByPath[e.id.split('::')[0]]?.layer), mono: true, title: e.fields.map((f) => f.name).join(', ') }));
    const es = [];
    const seen = new Set();
    for (const e of shown) {
      for (const r of e.relations) {
        if (!ids.has(r.to)) continue;
        const pair = [e.id, r.to].sort().join('|');
        if (r.kind === 'belongsToMany' && seen.has(`m:${pair}`)) continue;
        if (seen.has(`${pair}:${r.kind === 'belongsTo' ? 'hasMany' : r.kind === 'hasMany' ? 'belongsTo' : r.kind}`)) continue; // пара hasMany/belongsTo — одна стрелка
        seen.add(`${pair}:${r.kind}`); if (r.kind === 'belongsToMany') seen.add(`m:${pair}`);
        const [from, to] = r.kind === 'belongsTo' ? [r.to, e.id] : [e.id, r.to];
        es.push({ id: `${e.id}>${r.to}:${r.as}`, source: from, target: to, label: REL[r.kind]?.[1] || r.kind, dashed: r.kind === 'belongsToMany' });
      }
    }
    return { nodes: ns, edges: es };
  }, [ents, view, ix]);
  return (
    <div className="max-w-[1100px]">
      <h1 className="font-display font-semibold text-[22px]">Сущности</h1>
      <p className="text-[13.5px] text-mist mt-1.5 leading-relaxed max-w-[780px]">
        Сущность — это описание того, какие данные хранит программа: книга, автор, пользователь. У неё есть поля (что именно хранится и с какими правилами) и связи с другими сущностями.
      </p>
      {ents.length === 0 && <div className="text-[13.5px] text-mist mt-5">В этом коде не нашлось моделей данных. Mímisbrunnr узнаёт Sequelize, Mongoose, TypeORM, Prisma, SQLAlchemy, SQLModel, Django, Pydantic, dataclass и DTO с class-validator.</div>}
      {nodes.length > 0 && (
        <section className="mt-5">
          <h2 className="font-display font-semibold text-[16px] mb-2">Схема связей</h2>
          <Graph nodes={nodes} edges={edges} height={nodes.length > 8 ? 480 : 340} onNodeClick={(n) => dispatch(go({ t: 'fn', id: n.id }))} emptyText="Связей нет." />
          <div className="text-[12px] text-mist-dim mt-2">1 — N: у одной записи слева много записей справа. N — N (пунктир): многие-ко-многим, обычно через отдельную таблицу-связку.</div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.k} className="mt-7">
          <div className="flex items-baseline gap-2"><h2 className="font-display font-semibold text-[16px]">{g.title}</h2><span className="font-mono text-[11px] text-mist-dim">{g.list.length}</span></div>
          <div className="text-[12.5px] text-mist mt-0.5 mb-3">{g.hint}</div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {g.list.slice(0, open[g.k] ? undefined : 12).map((e) => (
              <button key={e.id} onClick={() => dispatch(go({ t: 'fn', id: e.id }))} className="text-left card px-4 py-3 hover:border-bronze/60 transition-colors" style={{ borderLeft: `3px solid ${layerColor(view, ix.fileByPath[e.id.split('::')[0]]?.layer)}` }}>
                <div className="flex items-baseline gap-2"><span className="font-mono text-[14px]">{e.model}</span><span className="text-[11px] text-mist-dim">{ORM_RU[e.orm]}{e.table ? ` · ${e.table}` : ''}</span></div>
                <div className="font-mono text-[11.5px] text-mist mt-1 leading-relaxed">{e.fields.slice(0, 8).map((f) => `${f.name}${f.pk ? ' (ключ)' : ''}`).join(' · ')}{e.fields.length > 8 ? ' …' : ''}</div>
                {e.relations.length > 0 && <div className="text-[12px] text-stone mt-1.5">{e.relations.map((r) => relationText(e, r, ix)).join('; ')}</div>}
                {ix.itemById[e.id]?.phrase && <div className="text-[12px] text-mist mt-1.5">{ix.itemById[e.id].phrase}</div>}
              </button>
            ))}
          </div>
          {g.list.length > 12 && !open[g.k] && <button className="btn-ghost mt-2" onClick={() => setOpen((o) => ({ ...o, [g.k]: true }))}>Показать все {g.list.length}</button>}
        </section>
      ))}
    </div>
  );
}
