// Prisma: сущности описаны в schema.prisma — простой текстовый формат, разбираем построчно.
import crypto from 'node:crypto';

const SCALAR = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);

export function parsePrisma(file, text) {
  const items = [], entities = [];
  const lines = text.split('\n');
  const models = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const l = raw.replace(/\/\/.*$/, '').trim();
    const m = l.match(/^(model|view)\s+(\w+)\s*\{/);
    if (m) { cur = { name: m[2], start: i + 1, fields: [], table: '', body: [] }; return; }
    if (!cur) return;
    if (l === '}') { cur.end = i + 1; models.push(cur); cur = null; return; }
    cur.body.push(raw);
    const map = l.match(/^@@map\(\s*"([^"]+)"/);
    if (map) { cur.table = map[1]; return; }
    const f = l.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
    if (f && !l.startsWith('@@')) cur.fields.push({ name: f[1], type: f[2] + (f[3] || ''), base: f[2], list: Boolean(f[3]), optional: Boolean(f[4]), attrs: f[5] || '', line: i + 1 });
  });
  const names = new Set(models.map((m) => m.name));
  for (const m of models) {
    const id = `${file}::${m.name}`;
    const doc = (lines[m.start - 2] || '').trim().startsWith('///') ? lines[m.start - 2].trim().replace(/^\/\/\/\s?/, '') : '';
    items.push({
      id, file, name: m.name, kind: 'entity', line: m.start, end: m.end,
      sig: `model ${m.name}`, route: '', doc,
      hash: crypto.createHash('sha1').update(m.body.map((x) => x.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n')).digest('hex'),
    });
    const fields = [], relations = [];
    for (const f of m.fields) {
      const rel = names.has(f.base);
      const fld = { name: f.name, type: f.type, validate: [] };
      if (/@id\b/.test(f.attrs)) fld.pk = true;
      if (/@unique\b/.test(f.attrs)) fld.unique = true;
      if (!f.optional && !f.list && !/@default/.test(f.attrs) && !rel) fld.required = true;
      const def = f.attrs.match(/@default\(([^)]*\)?)\)/);
      if (def) { fld.default = def[1]; if (/autoincrement|uuid|cuid/.test(def[1])) fld.auto = true; }
      if (rel) {
        fld.relation = true;
        const fk = f.attrs.match(/fields:\s*\[([^\]]+)\]/);
        relations.push({ kind: f.list ? 'hasMany' : fk ? 'belongsTo' : 'hasOne', to: `${file}::${f.base}`, as: f.name, fk: fk ? fk[1].trim() : '', line: f.line, file });
      } else if (!SCALAR.has(f.base)) fld.type = `${f.type} (перечисление)`;
      fields.push(fld);
    }
    // многие-ко-многим: список с обеих сторон без fields
    entities.push({ id, orm: 'prisma', model: m.name, table: m.table || m.name, fields, relations, hooks: [] });
  }
  for (const e of entities) {
    for (const r of e.relations) {
      if (r.kind !== 'hasMany') continue;
      const back = entities.find((x) => x.id === r.to)?.relations.find((x) => x.to === e.id);
      if (back?.kind === 'hasMany') { r.kind = 'belongsToMany'; r.through = 'скрытая таблица Prisma'; }
    }
  }
  return { items, entities };
}
