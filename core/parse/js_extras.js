// Дополнения к разбору JS/TS, которые собираются, пока дерево живо:
//  - сущности (Sequelize, Mongoose, TypeORM, DTO с class-validator) и связи между ними;
//  - веб-обвязка: app/router, app.use, маршруты, хуки Fastify, NestJS-контроллеры и guard'ы;
//  - «что внутри функции»: параметры, переменные и откуда они, куда уходят, что возвращается.
import { field, walk } from './treesitter.js';

const FUNC = new Set(['arrow_function', 'function_expression', 'function', 'generator_function', 'function_declaration', 'generator_function_declaration', 'method_definition']);
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const MOUNT = new Set([...HTTP, 'use', 'route', 'register', 'addHook', 'setErrorHandler', 'useGlobalGuards', 'useGlobalPipes', 'useGlobalFilters', 'useGlobalInterceptors', 'setGlobalPrefix']);
const short = (t, n = 60) => { const c = String(t || '').replace(/\s+/g, ' ').trim(); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };
const key = (n) => `${n.startIndex}:${n.endIndex}`;
const line = (n) => n.startPosition.row + 1;
const strValue = (n) => {
  if (!n) return null;
  if (n.type === 'string') return n.text.slice(1, -1);
  if (n.type === 'template_string' && !n.text.includes('${')) return n.text.slice(1, -1);
  return null;
};
const pairs = (obj) => (obj?.type === 'object' ? obj.namedChildren.filter((p) => p.type === 'pair' || p.type === 'shorthand_property_identifier') : []);
const keyOf = (p) => (p.type === 'shorthand_property_identifier' ? p.text : (field(p, 'key')?.text || '').replace(/^['"]|['"]$/g, ''));
const valOf = (p) => (p.type === 'shorthand_property_identifier' ? p : field(p, 'value'));
const prop = (obj, k) => { const p = pairs(obj).find((x) => keyOf(x) === k); return p ? valOf(p) : null; };

// ---------------------------------------------------------------- декораторы
/** Декораторы узла: [{ name, args: [узлы], text }]. Для класса, метода, поля, параметра. */
export function decoratorsOf(node) {
  if (!node) return [];
  const list = [];
  const take = (d) => {
    const e = d.namedChild(0);
    if (!e) return;
    if (e.type === 'call_expression') list.push({ name: field(e, 'function')?.text || '', args: field(e, 'arguments')?.namedChildren || [], text: d.text });
    else list.push({ name: e.text, args: [], text: d.text });
  };
  for (const c of node.namedChildren) if (c.type === 'decorator') take(c);
  if (node.type === 'class_declaration' || node.type === 'class') {
    if (node.parent?.type === 'export_statement') for (const c of node.parent.namedChildren) if (c.type === 'decorator') take(c);
  }
  if (node.type === 'method_definition') {
    // декораторы метода — соседи перед ним в теле класса
    const before = [];
    for (let p = node.previousNamedSibling; p && p.type === 'decorator'; p = p.previousNamedSibling) before.unshift(p);
    before.forEach(take);
  }
  return list;
}
const decoName = (d) => d.name.split('.').pop();

// ---------------------------------------------------------------- сущности
const cleanType = (t) => String(t || '').replace(/^(DataTypes|Sequelize|Schema\.Types|mongoose\.Schema\.Types|mongoose\.Types|Types)\./, '');

function sequelizeFields(obj) {
  const out = [];
  for (const p of pairs(obj)) {
    const name = keyOf(p), v = valOf(p);
    const f = { name, type: '', validate: [] };
    if (v?.type === 'object') {
      const t = prop(v, 'type');
      f.type = cleanType(t?.text);
      if (prop(v, 'primaryKey')?.text === 'true') f.pk = true;
      if (prop(v, 'allowNull')?.text === 'false') f.required = true;
      if (prop(v, 'unique') && prop(v, 'unique').text !== 'false') f.unique = true;
      if (prop(v, 'autoIncrement')?.text === 'true') f.auto = true;
      if (prop(v, 'defaultValue')) f.default = short(prop(v, 'defaultValue').text, 40);
      const ref = prop(v, 'references');
      if (ref) f.ref = { model: prop(ref, 'model')?.text?.replace(/['"]/g, '') || '', key: strValue(prop(ref, 'key')) || '' };
      const val = prop(v, 'validate');
      if (val?.type === 'object') f.validate = pairs(val).map((x) => short(x.type === 'pair' ? `${keyOf(x)}: ${valOf(x)?.text}` : x.text, 40));
      if (prop(v, 'comment')) f.comment = strValue(prop(v, 'comment')) || '';
    } else f.type = cleanType(v?.text);
    out.push(f);
  }
  return out;
}

function mongooseFields(obj, prefix = '') {
  const out = [];
  for (const p of pairs(obj)) {
    const name = prefix + keyOf(p), v = valOf(p);
    const f = { name, type: '', validate: [] };
    let base = v, arr = false;
    if (v?.type === 'array') { arr = true; base = v.namedChild(0); }
    if (base?.type === 'object' && prop(base, 'type')) {
      f.type = cleanType(prop(base, 'type').text) + (arr ? '[]' : '');
      if (prop(base, 'required') && prop(base, 'required').text !== 'false') f.required = true;
      if (prop(base, 'unique')?.text === 'true') f.unique = true;
      if (prop(base, 'default')) f.default = short(prop(base, 'default').text, 40);
      const ref = strValue(prop(base, 'ref'));
      if (ref) f.ref = { model: ref, key: '_id' };
      for (const k of ['enum', 'min', 'max', 'minlength', 'maxlength', 'match', 'lowercase', 'trim', 'validate']) if (prop(base, k)) f.validate.push(short(`${k}: ${prop(base, k).text}`, 40));
    } else if (base?.type === 'object') {
      out.push(...mongooseFields(base, `${name}.`)); // вложенный объект — поля через точку
      continue;
    } else f.type = cleanType(base?.text) + (arr ? '[]' : '');
    out.push(f);
  }
  return out;
}

/** sequelize.define('Book', {...}, { tableName }) */
export function entityFromDefine(call) {
  const f = field(call, 'function');
  if (f?.type !== 'member_expression' || field(f, 'property')?.text !== 'define') return null;
  const args = field(call, 'arguments')?.namedChildren || [];
  const model = strValue(args[0]);
  if (model === null || args[1]?.type !== 'object') return null;
  const opts = args[2];
  return {
    orm: 'sequelize', model, table: strValue(prop(opts, 'tableName')) || '',
    fields: sequelizeFields(args[1]), relations: [], hooks: [],
    timestamps: prop(opts, 'timestamps')?.text !== 'false',
  };
}

/** mongoose.model('User', userSchema) */
export function entityFromMongoose(call, schemas) {
  const f = field(call, 'function');
  const callee = f?.text || '';
  if (!/^(mongoose\.)?model$/.test(callee)) return null;
  const args = field(call, 'arguments')?.namedChildren || [];
  const model = strValue(args[0]);
  if (model === null || !args[1]) return null;
  let schema = args[1];
  if (schema.type === 'identifier') schema = schemas[schema.text];
  const obj = schema?.type === 'new_expression' ? field(schema, 'arguments')?.namedChild(0) : null;
  const opts = schema?.type === 'new_expression' ? field(schema, 'arguments')?.namedChild(1) : null;
  return {
    orm: 'mongoose', model, table: strValue(args[2]) || '', schemaVar: args[1].type === 'identifier' ? args[1].text : '',
    fields: obj ? mongooseFields(obj) : [], relations: [], hooks: [],
    timestamps: prop(opts, 'timestamps')?.text === 'true',
  };
}

const TYPEORM_COLS = /^(Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|ObjectIdColumn)$/;
const TYPEORM_REL = { OneToMany: 'hasMany', ManyToOne: 'belongsTo', OneToOne: 'hasOne', ManyToMany: 'belongsToMany' };
const VALIDATOR = /^(Is[A-Z]\w*|Min|Max|MinLength|MaxLength|Length|Matches|Contains|ArrayMinSize|ArrayMaxSize|ValidateNested|Equals|NotEquals|Allow)$/;

/** Класс-сущность: TypeORM @Entity, «extends Model» (Sequelize), DTO с проверками class-validator. */
export function entityFromClass(node) {
  const decos = decoratorsOf(node);
  const body = field(node, 'body');
  const heritage = node.namedChildren.find((c) => c.type === 'class_heritage')?.text || '';
  const fieldsNodes = (body?.namedChildren || []).filter((m) => m.type === 'public_field_definition' || m.type === 'field_definition');
  const ent = decos.find((d) => decoName(d) === 'Entity' || decoName(d) === 'Schema');
  const fieldInfo = (m) => {
    const nm = field(m, 'name') || field(m, 'property');
    const typ = field(m, 'type')?.text?.replace(/^:\s*/, '') || '';
    return { nm: nm?.text || '', typ, decos: decoratorsOf(m) };
  };
  if (ent) {
    const fields = [], relations = [];
    for (const m of fieldsNodes) {
      const { nm, typ, decos: ds } = fieldInfo(m);
      for (const d of ds) {
        const dn = decoName(d);
        const opts = d.args.find((a) => a.type === 'object');
        if (TYPEORM_COLS.test(dn) || dn === 'Prop') {
          const f = { name: nm, type: typ || strValue(d.args[0]) || '', validate: [] };
          if (/^Primary|ObjectId/.test(dn)) f.pk = true;
          if (dn === 'PrimaryGeneratedColumn') f.auto = true;
          if (/^(Create|Update|Delete)DateColumn$/.test(dn)) f.default = dn.replace('Column', '').replace('Date', ' — дата');
          if (prop(opts, 'nullable')?.text === 'false' || prop(opts, 'required')?.text === 'true') f.required = true;
          if (prop(opts, 'unique')?.text === 'true') f.unique = true;
          if (prop(opts, 'default')) f.default = short(prop(opts, 'default').text, 40);
          if (prop(opts, 'length')) f.validate.push(`length: ${prop(opts, 'length').text}`);
          fields.push(f);
        } else if (TYPEORM_REL[dn]) {
          const t = d.args[0];
          const target = t && FUNC.has(t.type) ? field(t, 'body')?.text : strValue(t) || t?.text;
          relations.push({ kind: TYPEORM_REL[dn], to: (target || '').replace(/[()\s]/g, ''), as: nm, line: line(m) });
          fields.push({ name: nm, type: typ, relation: true, validate: [] });
        } else if (dn === 'JoinTable') {
          const r = relations[relations.length - 1];
          if (r) r.through = strValue(prop(d.args[0], 'name')) || 'таблица-связка';
        }
      }
    }
    return { orm: decoName(ent) === 'Schema' ? 'mongoose' : 'typeorm', model: field(node, 'name')?.text || '', table: strValue(ent.args[0]) || strValue(prop(ent.args[0], 'name')) || '', fields, relations, hooks: [] };
  }
  if (/extends\s+(Sequelize\.)?Model\b/.test(heritage)) {
    return { orm: 'sequelize', model: field(node, 'name')?.text || '', table: '', fields: [], relations: [], hooks: [], needsInit: true };
  }
  // DTO: поля с проверками class-validator
  const checked = fieldsNodes.map(fieldInfo).filter((f) => f.decos.some((d) => VALIDATOR.test(decoName(d))));
  if (checked.length) {
    return {
      orm: 'dto', model: field(node, 'name')?.text || '', table: '', relations: [], hooks: [],
      fields: fieldsNodes.map(fieldInfo).map((f) => ({ name: f.nm, type: f.typ, required: !f.decos.some((d) => decoName(d) === 'IsOptional'), validate: f.decos.map((d) => short(d.text.replace(/^@/, ''), 40)) })),
    };
  }
  return null;
}

// ---------------------------------------------------------------- обработчики в вызовах
function describe(a, nodeItem) {
  if (!a) return null;
  switch (a.type) {
    case 'identifier': return { t: 'name', name: a.text };
    case 'member_expression': {
      const o = field(a, 'object');
      return { t: 'member', obj: o?.type === 'identifier' ? o.text : o?.text || '', name: field(a, 'property')?.text || '', text: a.text };
    }
    case 'call_expression': {
      const f = field(a, 'function');
      return { t: 'call', callee: describe(f, nodeItem), text: short(a.text, 50), args: (field(a, 'arguments')?.namedChildren || []).filter((x) => x.type === 'identifier').map((x) => x.text) };
    }
    case 'new_expression': return { t: 'new', name: field(a, 'constructor')?.text || '', text: short(a.text, 50) };
    case 'array': return { t: 'array', items: a.namedChildren.map((x) => describe(x, nodeItem)).filter(Boolean) };
    case 'object': {
      const hooks = [];
      for (const k of ['onRequest', 'preParsing', 'preValidation', 'preHandler', 'preSerialization']) {
        const v = prop(a, k);
        if (!v) continue;
        const d = describe(v, nodeItem);
        (d?.t === 'array' ? d.items : [d]).forEach((x) => x && hooks.push({ ...x, hook: k }));
      }
      return { t: 'opts', hooks, schema: Boolean(prop(a, 'schema')), text: short(a.text, 50) };
    }
    default:
      if (FUNC.has(a.type)) {
        const params = field(a, 'parameters')?.namedChildren || [];
        return { t: 'inline', id: nodeItem.get(key(a)) || null, params: params.length };
      }
      return null;
  }
}

// ---------------------------------------------------------------- поток данных внутри функции
const INPUT_RE = /^(req|request|ctx\.request|ctx)\.(params|body|query|headers|cookies|user|file|files|session|ip)\b|^process\.env\.\w+/;
const RES_OBJ = /^(res|reply|response)\b/;
const TX_RE = /(^|\.)(transaction|commit|rollback|startSession|startTransaction|commitTransaction|abortTransaction|beginTransaction)$/;
const NET_RE = /^(fetch|axios(\.\w+)?|http\.request|https\.request|got)$/;

function descr(n) {
  if (!n) return '';
  switch (n.type) {
    case 'await_expression': return `await ${descr(n.namedChild(0))}`;
    case 'call_expression': return `${short(field(n, 'function')?.text, 50)}(…)`;
    case 'new_expression': return `new ${short(field(n, 'constructor')?.text, 40)}(…)`;
    case 'array': return n.namedChildCount ? 'список […]' : 'пустой список []';
    case 'object': return n.namedChildCount ? 'объект {…}' : 'пустой объект {}';
    case 'string': case 'template_string': return `строка ${short(n.text, 40)}`;
    case 'number': return `число ${n.text}`;
    default: return short(n.text, 60);
  }
}

function paramNames(fn) {
  const ps = field(fn, 'parameters') || (field(fn, 'parameter') ? { namedChildren: [field(fn, 'parameter')] } : null);
  const out = [];
  for (const p of ps?.namedChildren || []) {
    const pat = p.type === 'required_parameter' || p.type === 'optional_parameter' ? field(p, 'pattern') : p.type === 'assignment_pattern' ? field(p, 'left') : p;
    const typ = field(p, 'type')?.text?.replace(/^:\s*/, '') || '';
    const deco = decoratorsOf(p).map((d) => d.text.replace(/^@/, '')).join(' ');
    if (pat?.type === 'identifier') out.push({ name: pat.text, type: typ, deco });
    else if (pat?.type === 'object_pattern') {
      for (const c of pat.namedChildren) {
        const nm = c.type === 'shorthand_property_identifier_pattern' ? c.text : c.type === 'pair_pattern' ? field(c, 'value')?.text : null;
        if (nm) out.push({ name: nm, type: '', deco, from: `{ ${nm} } из параметра` });
      }
    } else if (pat?.type === 'rest_pattern') out.push({ name: pat.namedChild(0)?.text || '', type: typ, deco, rest: true });
  }
  return out;
}

function flowOf(fn, body, skip) {
  const params = fn ? paramNames(fn) : [];
  const known = new Set(params.map((p) => p.name));
  const vars = [], reassign = [], inputs = [], outputs = [], effects = [];
  const uses = {};
  const seenInput = new Set();
  const use = (name, u) => { const l = (uses[name] ||= []); if (l.length < 12 && !l.some((x) => x.how === u.how && x.to === u.to && x.line === u.line)) l.push(u); };
  const declare = (name, n, from, kind = 'const') => { known.add(name); vars.push({ name, line: line(n), from, kind }); };

  function visit(n) {
    if (!n) return;
    if (n !== body && skip(n)) return; // вложенная функция со своим разбором
    switch (n.type) {
      case 'variable_declarator': {
        const nm = field(n, 'name'), v = field(n, 'value');
        if (nm?.type === 'identifier') declare(nm.text, n, v ? descr(v) : 'без значения');
        else if (nm?.type === 'object_pattern') {
          for (const c of nm.namedChildren) {
            const k = c.type === 'shorthand_property_identifier_pattern' ? c.text : c.type === 'pair_pattern' ? field(c, 'key')?.text : null;
            const local = c.type === 'pair_pattern' ? field(c, 'value')?.text : k;
            if (local) declare(local, c, `${short(v?.text, 40)}.${k}`, 'из объекта');
          }
        } else if (nm?.type === 'array_pattern') {
          nm.namedChildren.forEach((c, i) => { if (c.type === 'identifier') declare(c.text, c, `${short(v?.text, 40)}[${i}]`, 'из списка'); });
        }
        visit(v);
        return;
      }
      case 'for_in_statement': {
        const l = field(n, 'left'), r = field(n, 'right');
        if (l?.type === 'identifier') declare(l.text, l, `каждый элемент ${short(r?.text, 40)}`, 'цикл');
        visit(r); visit(field(n, 'body'));
        return;
      }
      case 'catch_clause': {
        const p = field(n, 'parameter');
        if (p?.type === 'identifier') declare(p.text, p, 'ошибка из блока try', 'ошибка');
        visit(field(n, 'body'));
        return;
      }
      case 'assignment_expression': {
        const l = field(n, 'left'), r = field(n, 'right');
        if (l?.type === 'identifier' && known.has(l.text)) reassign.push({ name: l.text, line: line(n), from: descr(r) });
        visit(r);
        if (l?.type !== 'identifier') visit(l);
        return;
      }
      case 'return_statement': {
        const v = n.namedChild(0);
        const vt = (v?.type === 'await_expression' ? v.namedChild(0) : v);
        const ct = vt?.type === 'call_expression' ? field(vt, 'function')?.text || '' : '';
        // return res.json(...) / return next(err) — это уже «ответ» и «дальше», отдельный return не нужен
        if (!(RES_OBJ.test(ct) || ct === 'next')) outputs.push({ kind: 'return', text: v ? short(v.text, 70) : '(ничего)', line: line(n) });
        if (v?.type === 'identifier' && known.has(v.text)) use(v.text, { how: 'return', to: 'return', line: line(n) });
        visit(v);
        return;
      }
      case 'throw_statement': {
        const v = n.namedChild(0);
        let msg = short(v?.text, 80);
        if (v?.type === 'new_expression') {
          const a0 = field(v, 'arguments')?.namedChild(0);
          if (a0 && (a0.type === 'string' || a0.type === 'template_string')) msg = `${field(v, 'constructor')?.text}: ${short(a0.text.slice(1, -1), 80)}`;
        }
        outputs.push({ kind: 'throw', text: msg, line: line(n) });
        if (v?.type === 'identifier' && known.has(v.text)) use(v.text, { how: 'throw', to: 'throw', line: line(n) });
        visit(v);
        return;
      }
      case 'if_statement': {
        const c = field(n, 'condition');
        // «проверяется» — только если переменная стоит в самом условии, а не в аргументах вызова внутри него
        const inArgs = (id) => { for (let p = id.parent; p && p !== c; p = p.parent) if (p.type === 'arguments') return true; return false; };
        for (const id of walk(c)) if (id.type === 'identifier' && known.has(id.text) && !inArgs(id)) use(id.text, { how: 'check', to: short(c.text.replace(/^\(|\)$/g, ''), 50), line: line(n) });
        for (const ch of n.namedChildren) visit(ch);
        return;
      }
      case 'member_expression': {
        const t = n.text;
        const p = n.parent;
        const extended = p?.type === 'member_expression' && field(p, 'object') === n && !(p.parent?.type === 'call_expression' && field(p.parent, 'function') === p);
        if (!extended && INPUT_RE.test(t) && !seenInput.has(t)) { seenInput.add(t); inputs.push({ text: short(t, 60), line: line(n) }); }
        break;
      }
      case 'call_expression': {
        const f = field(n, 'function');
        const ft = f?.text || '';
        const args = field(n, 'arguments')?.namedChildren || [];
        // ответ клиенту: res.status(404).json(...) — берём самый внешний вызов цепочки
        const outer = !(n.parent?.type === 'member_expression' && field(n.parent, 'object') === n);
        if (RES_OBJ.test(ft) && outer) {
          const status = (n.text.match(/\.(?:status|code)\((\d{3})\)/) || n.text.match(/sendStatus\((\d{3})\)/) || [])[1] || '';
          const method = f?.type === 'member_expression' ? field(f, 'property')?.text : '';
          outputs.push({ kind: 'response', status, method, text: short(n.text, 80), line: line(n) });
          for (const a of args) if (a.type === 'identifier' && known.has(a.text)) use(a.text, { how: 'response', to: short(ft, 40), line: line(n) });
        } else if (ft === 'next' && known.has('next')) {
          outputs.push({ kind: 'next', text: args.length ? `next(${short(args[0].text, 30)})` : 'next()', line: line(n) });
          if (args[0]?.type === 'identifier' && known.has(args[0].text)) use(args[0].text, { how: 'next', to: 'next', line: line(n) });
        } else {
          for (const a of args) {
            if (a.type === 'identifier' && known.has(a.text)) use(a.text, { how: 'arg', to: short(ft, 50), line: line(n) });
            if (a.type === 'object') for (const p of pairs(a)) { const v = valOf(p); if (v?.type === 'identifier' && known.has(v.text)) use(v.text, { how: 'arg', to: `${short(ft, 40)}({ ${keyOf(p)} })`, line: line(n) }); }
          }
          if (f?.type === 'member_expression') {
            const o = field(f, 'object');
            if (o?.type === 'identifier' && known.has(o.text)) use(o.text, { how: 'method', to: `${o.text}.${field(f, 'property')?.text}()`, line: line(n) });
          }
        }
        if (TX_RE.test(ft)) effects.push({ kind: 'tx', text: short(ft, 50), line: line(n) });
        else if (NET_RE.test(ft)) effects.push({ kind: 'net', text: short(ft, 50), line: line(n) });
        else if (/^fs\.|^fsPromises\./.test(ft)) effects.push({ kind: 'file', text: short(ft, 50), line: line(n) });
        break;
      }
      default: break;
    }
    for (const ch of n.namedChildren) visit(ch);
  }
  if (body && body.type !== 'statement_block' && body.type !== 'class_body') {
    outputs.push({ kind: 'return', text: short(body.text, 70), line: line(body) });
  }
  visit(body);
  return { params, inputs, vars, reassign, uses, outputs, effects };
}

// ---------------------------------------------------------------- всё вместе
export function jsExtras(root, ctx) {
  const { nodeItem, entities, ranges } = ctx;
  const mounts = []; // app.use / router.get / fastify.register …
  const vars = {}; // имя → { kind: 'app'|'router', fw }
  const assoc = []; // Book.belongsTo(Publisher, {...})
  const inits = {}; // User.init({...}, { tableName })
  const schemaHooks = {}; // userSchema.pre('save', …) → имя схемы → […]
  const nest = []; // классы NestJS: контроллеры, guard'ы, pipe'ы
  const params = {}; // id → число параметров (обработчик ошибок Express — 4)

  const ownerRanges = [...ranges].sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const ownerOf = (n) => ownerRanges.find((r) => r.start <= n.startIndex && n.endIndex <= r.end) || null;
  for (const r of ranges) if (r.fn) params[r.id] = (field(r.fn, 'parameters')?.namedChildren || []).length;

  for (const n of walk(root)) {
    if (n.type === 'variable_declarator') {
      const nm = field(n, 'name'), v0 = field(n, 'value');
      const v = v0?.type === 'await_expression' ? v0.namedChild(0) : v0;
      if (nm?.type === 'identifier' && v?.type === 'call_expression') {
        const c = field(v, 'function')?.text || '';
        if (/^express$/.test(c) || /^require\(['"]express['"]\)$/.test(c)) vars[nm.text] = { kind: 'app', fw: 'express' };
        else if (/^(express\.)?Router$/.test(c)) vars[nm.text] = { kind: 'router', fw: 'express' };
        else if (/^(Fastify|fastify)$/.test(c) || /^require\(['"]fastify['"]\)$/.test(c)) vars[nm.text] = { kind: 'app', fw: 'fastify' };
        else if (/^NestFactory\.create$/.test(c)) vars[nm.text] = { kind: 'app', fw: 'nest' };
        else if (/^new Koa$/.test(c)) vars[nm.text] = { kind: 'app', fw: 'koa' };
      }
      continue;
    }
    if (n.type !== 'call_expression') continue;
    const f = field(n, 'function');
    if (f?.type !== 'member_expression') continue;
    const method = field(f, 'property')?.text;
    const args = field(n, 'arguments')?.namedChildren || [];
    const objNode = field(f, 'object');
    // связи Sequelize
    if (['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(method) && objNode?.type === 'identifier' && args[0]?.type === 'identifier') {
      const o = args[1];
      assoc.push({ from: objNode.text, to: args[0].text, kind: method, as: strValue(prop(o, 'as')) || '', fk: strValue(prop(o, 'foreignKey')) || prop(o, 'foreignKey')?.text || '', otherKey: strValue(prop(o, 'otherKey')) || '', through: prop(o, 'through') ? (strValue(prop(o, 'through')) || prop(o, 'through').text) : '', line: line(n) });
      continue;
    }
    if (method === 'init' && objNode?.type === 'identifier' && args[0]?.type === 'object') {
      inits[objNode.text] = { fields: sequelizeFields(args[0]), table: strValue(prop(args[1], 'tableName')) || '' };
      continue;
    }
    if (['pre', 'post'].includes(method) && objNode?.type === 'identifier' && ctx.mongooseSchemas[objNode.text]) {
      (schemaHooks[objNode.text] ||= []).push(`${method === 'pre' ? 'перед' : 'после'} «${strValue(args[0]) || '?'}»`);
      continue;
    }
    if (!MOUNT.has(method)) continue;
    // цепочка router.route('/x').get(a) — разбор маршрута уже создал «функцию» на каждый сегмент
    let base = objNode, path = null, rest = args;
    if (objNode?.type === 'call_expression' && field(field(objNode, 'function'), 'property')?.text === 'route') {
      let b = field(field(objNode, 'function'), 'object');
      path = strValue(field(objNode, 'arguments')?.namedChild(0));
      while (b?.type === 'call_expression') b = field(field(b, 'function'), 'object');
      base = b;
    } else if (objNode?.type === 'call_expression') {
      // .get(a).post(b) — средний сегмент цепочки
      let b = objNode, p = null;
      while (b?.type === 'call_expression') {
        const ff = field(b, 'function');
        if (field(ff, 'property')?.text === 'route') p = strValue(field(b, 'arguments')?.namedChild(0));
        b = field(ff, 'object');
      }
      if (p === null) continue;
      base = b; path = p;
    } else if (typeof strValue(args[0]) === 'string') { path = strValue(args[0]); rest = args.slice(1); }
    if (base?.type !== 'identifier' && base?.type !== 'this') continue;
    const selfId = nodeItem.get(key(n));
    const owner = ownerRanges.find((r) => r.id !== selfId && r.start <= n.startIndex && n.endIndex <= r.end) || null;
    const ownerFn = owner?.fn;
    const firstParam = ownerFn ? (field(ownerFn, 'parameters')?.namedChildren || [])[0] : null;
    mounts.push({
      obj: base.text, method, path, line: line(n),
      routeId: HTTP.has(method) || (method === 'route' && args[0]?.type === 'object') ? nodeItem.get(key(n)) || null : null,
      container: owner?.id || null,
      objIsParam: Boolean(firstParam && (firstParam.text === base.text || field(firstParam, 'pattern')?.text === base.text)),
      handlers: (method === 'route' && args[0]?.type === 'object' ? [prop(args[0], 'preHandler'), prop(args[0], 'handler')].filter(Boolean) : rest).map((a) => describe(a, nodeItem)).filter(Boolean),
      opts: method === 'route' && args[0]?.type === 'object' ? describe(args[0], nodeItem) : null,
      text: short(n.text, 80),
    });
  }

  // NestJS: контроллеры, guard'ы, pipe'ы, interceptor'ы, фильтры
  for (const n of walk(root)) {
    if (n.type !== 'class_declaration' && n.type !== 'class') continue;
    const outer = n.parent?.type === 'export_statement' ? n.parent : n;
    const id = nodeItem.get(key(outer));
    if (!id) continue;
    const decos = decoratorsOf(n);
    const names = decos.map(decoName);
    const heritage = n.namedChildren.find((c) => c.type === 'class_heritage')?.text || '';
    const role = names.includes('Controller') ? 'controller'
      : /implements[^{]*\bCanActivate\b/.test(heritage) ? 'guard'
        : /implements[^{]*\bPipeTransform\b/.test(heritage) ? 'pipe'
          : /implements[^{]*\bNestInterceptor\b/.test(heritage) ? 'interceptor'
            : /implements[^{]*\bNestMiddleware\b/.test(heritage) ? 'middleware'
              : names.includes('Catch') || /implements[^{]*\bExceptionFilter\b/.test(heritage) ? 'filter'
                : names.includes('Injectable') ? 'provider' : null;
    if (!role) continue;
    const listArgs = (ds, nm) => ds.filter((d) => decoName(d) === nm).flatMap((d) => d.args.map((a) => describe(a, nodeItem))).filter(Boolean);
    const ctl = decos.find((d) => decoName(d) === 'Controller');
    const entry = {
      id, role, name: field(n, 'name')?.text || '',
      prefix: ctl ? strValue(ctl.args[0]) || strValue(prop(ctl.args[0], 'path')) || '' : '',
      guards: listArgs(decos, 'UseGuards'), pipes: listArgs(decos, 'UsePipes'), interceptors: listArgs(decos, 'UseInterceptors'), filters: listArgs(decos, 'UseFilters'),
      methods: [],
    };
    for (const m of field(n, 'body')?.namedChildren || []) {
      if (m.type !== 'method_definition') continue;
      const ds = decoratorsOf(m);
      const http = ds.find((d) => ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'].includes(decoName(d)));
      const mid = nodeItem.get(key(m));
      if (!mid) continue;
      entry.methods.push({
        id: mid, name: field(m, 'name')?.text, http: http ? decoName(http).toUpperCase() : null,
        path: http ? strValue(http.args[0]) || '' : null, line: line(m),
        guards: listArgs(ds, 'UseGuards'), pipes: listArgs(ds, 'UsePipes'), interceptors: listArgs(ds, 'UseInterceptors'), filters: listArgs(ds, 'UseFilters'),
        params: paramNames(m).filter((p) => p.deco),
      });
    }
    nest.push(entry);
  }

  // сущности: дополняем связями, init() и хуками схем
  for (const e of entities) {
    const name = e.id.split('::')[1];
    if (e.needsInit && inits[name]) { e.fields = inits[name].fields; e.table = inits[name].table; }
    if (e.schemaVar && schemaHooks[e.schemaVar]) e.hooks = schemaHooks[e.schemaVar];
  }

  // поток данных — для каждой функции файла
  const flows = {};
  const own = new Set(ranges.map((r) => r.fn && key(r.fn)).filter(Boolean));
  for (const r of ranges) {
    if (!r.fn && !r.body) continue;
    const fnKey = r.fn && key(r.fn);
    flows[r.id] = flowOf(r.fn, r.body, (x) => own.has(key(x)) && key(x) !== fnKey);
  }
  return { web: { mounts, vars, nest }, assoc, params, flows, entities };
}
