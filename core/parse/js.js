// Разбор JavaScript / TypeScript / JSX: функции, стрелочные функции,
// классы и методы, React-компоненты и хуки, вложенные обработчики,
// методы в объектах (createSlice, module.exports), маршруты Express.
import path from 'node:path';
import { parse, field, walk, codeHash, headText, collapse } from './treesitter.js';
import { decoratorsOf, entityFromDefine, entityFromMongoose, entityFromClass, jsExtras } from './js_extras.js';
import { jsWeb, ORM_INSTANCE } from './js_web.js';

const FUNC = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const JSX = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment']);
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const WRAPPERS = new Set(['memo', 'forwardRef', 'useCallback', 'useMemo', 'React.memo', 'React.forwardRef', 'observer', 'withRouter', 'connect']);

function hasJsx(node) {
  for (const n of walk(node)) if (JSX.has(n.type)) return true;
  return false;
}

function kindOf(name, fnNode, base) {
  const short = name.split('.').pop();
  if (/^use[A-Z0-9]/.test(short)) return 'hook';
  if (/^[A-Z]/.test(short) && fnNode && hasJsx(fnNode)) return 'component';
  return base;
}

function cleanComment(text) {
  const lines = text.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\/\/\s?/gm, '').split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter((l) => l && !l.startsWith('@') && !/^eslint|^prettier|^@ts-/.test(l));
  return lines[0] || '';
}

function commentBefore(node) {
  let prev = node.previousSibling;
  if (!prev && node.parent?.type === 'export_statement') prev = node.parent.previousSibling;
  return prev?.type === 'comment' ? cleanComment(prev.text) : '';
}

function strValue(n) {
  if (!n) return null;
  if (n.type === 'string') return n.text.slice(1, -1);
  if (n.type === 'template_string' && !n.text.includes('${')) return n.text.slice(1, -1);
  return null;
}

function firstFunctionArg(call) {
  const args = field(call, 'arguments');
  return args?.namedChildren.find((a) => FUNC.has(a.type)) || null;
}

export function parseJs(file, source, grammar) {
  const tree = parse(grammar, source);
  const root = tree.rootNode;
  const items = [];
  const ranges = []; // { id, start, end, short } — для привязки вызовов к функции
  const taken = new Set();
  const stem = path.basename(file).replace(/\.[^.]+$/, '');

  const nodeItem = new Map(); // «начало:конец» узла → id (для привязки маршрутов, сущностей, потока данных)
  const entities = []; // { id, orm, ...описание } — собирается, пока дерево живо
  function add({ name, kind, outer, fn, sigNode, body, doc, route = '', skipHash }) {
    let id = `${file}::${name}`;
    if (taken.has(id)) id = `${file}::${name}#${outer.startPosition.row + 1}`;
    taken.add(id);
    const item = {
      id, file, name: id.split('::')[1],
      kind: kindOf(name, fn, kind),
      line: outer.startPosition.row + 1,
      end: outer.endPosition.row + 1,
      sig: headText(sigNode || outer, body, source),
      route,
      doc: doc ?? commentBefore(outer),
      hash: codeHash(outer, skipHash),
    };
    items.push(item);
    nodeItem.set(`${outer.startIndex}:${outer.endIndex}`, id);
    if (fn) nodeItem.set(`${fn.startIndex}:${fn.endIndex}`, id);
    ranges.push({ id, start: outer.startIndex, end: outer.endIndex, short: name.split('.').pop(), fn: fn || null, body: body || null });
    return item;
  }

  // Методы в объекте: { a() {}, b: () => {}, reducers: { c(state) {} } }
  function objectMethods(obj, prefix, depth = 0) {
    if (!obj || obj.type !== 'object' || depth > 3) return;
    for (const p of obj.namedChildren) {
      if (p.type === 'method_definition') {
        const nm = `${prefix}.${field(p, 'name').text}`;
        add({ name: nm, kind: 'method', outer: p, fn: p, body: field(p, 'body') });
        visit(field(p, 'body'), nm);
      } else if (p.type === 'pair') {
        const key = field(p, 'key'), val = field(p, 'value');
        const k = key?.type === 'string' ? key.text.slice(1, -1) : key?.text;
        if (val && FUNC.has(val.type)) {
          const nm = `${prefix}.${k}`;
          add({ name: nm, kind: 'method', outer: p, fn: val, sigNode: p, body: field(val, 'body') });
          visit(field(val, 'body'), nm);
        } else if (val?.type === 'object') {
          // reducers: {...} — служебный уровень, его пропускаем; sendMessage: { reducer, prepare } — оставляем
          objectMethods(val, ['reducers', 'extraReducers', 'methods', 'actions', 'endpoints'].includes(k) ? prefix : `${prefix}.${k}`, depth + 1);
        }
      }
    }
  }

  function declarator(d, prefix) {
    const nameNode = field(d, 'name');
    const val = field(d, 'value');
    if (!nameNode || nameNode.type !== 'identifier' || !val) { if (val) visit(val, prefix); return; }
    const nm = prefix ? `${prefix}.${nameNode.text}` : nameNode.text;
    const outer = d.parent?.type === 'lexical_declaration' || d.parent?.type === 'variable_declaration'
      ? (d.parent.namedChildCount === 1 ? d.parent : d) : d;
    if (FUNC.has(val.type)) {
      add({ name: nm, kind: 'function', outer, fn: val, sigNode: outer, body: field(val, 'body') });
      visit(field(val, 'body'), nm);
      return;
    }
    if (val.type === 'call_expression' && !prefix) {
      // сущности: sequelize.define('Book', {...}) и mongoose.model('User', userSchema)
      const ent = entityFromDefine(val) || entityFromMongoose(val, mongooseSchemas);
      if (ent) {
        const it = add({ name: nm, kind: 'entity', outer, sigNode: outer, body: null });
        entities.push({ id: it.id, ...ent });
        return;
      }
    }
    if (val.type === 'new_expression' && /(^|\.)Schema$/.test(field(val, 'constructor')?.text || '') && !prefix) {
      mongooseSchemas[nameNode.text] = val; // new Schema({...}) — поля для mongoose.model(...)
    }
    if (val.type === 'call_expression') {
      const callee = field(val, 'function')?.text || '';
      const fnArg = firstFunctionArg(val);
      if (fnArg && (WRAPPERS.has(callee) || /^[A-Z]/.test(nameNode.text))) {
        add({ name: nm, kind: 'function', outer, fn: fnArg, sigNode: outer, body: field(fnArg, 'body') });
        visit(field(fnArg, 'body'), nm);
        return;
      }
      const objArg = field(val, 'arguments')?.namedChildren.find((a) => a.type === 'object');
      if (objArg && !prefix) { objectMethods(objArg, nm); return; }
    }
    if (val.type === 'object' && !prefix) { objectMethods(val, nm); return; }
    visit(val, prefix);
  }

  function klass(node, prefix) {
    const nameNode = field(node, 'name');
    const cname = nameNode ? nameNode.text : stem;
    const nm = prefix ? `${prefix}.${cname}` : cname;
    const body = field(node, 'body');
    // TypeORM @Entity, Sequelize «extends Model», DTO с проверками class-validator
    const ent = entityFromClass(node);
    const cls = add({
      name: nm, kind: ent ? 'entity' : 'class', outer: node.parent?.type === 'export_statement' ? node.parent : node,
      sigNode: node, body,
      skipHash: (n) => n.type === 'method_definition' || (n.type === 'field_definition' && FUNC.has(field(n, 'value')?.type)),
    });
    if (ent) entities.push({ id: cls.id, ...ent });
    for (const m of body?.namedChildren || []) {
      if (m.type === 'method_definition') {
        const mn = `${nm}.${field(m, 'name').text}`;
        add({ name: mn, kind: 'method', outer: m, fn: m, body: field(m, 'body') });
        visit(field(m, 'body'), mn);
      } else if (m.type === 'field_definition' || m.type === 'public_field_definition') {
        const prop = field(m, 'property') || field(m, 'name');
        const val = field(m, 'value');
        if (prop && val && FUNC.has(val.type)) {
          const mn = `${nm}.${prop.text}`;
          add({ name: mn, kind: 'method', outer: m, fn: val, sigNode: m, body: field(val, 'body') });
          visit(field(val, 'body'), mn);
        }
      }
    }
  }

  // Маршруты и промежуточные обработчики:
  //   app.get('/x', auth, controller.getX)      — обработчики по имени
  //   router.post('/x', (req, res) => {…})      — обработчик прямо в вызове
  //   router.route('/x').get(a).post(b)          — цепочка
  //   fastify.get('/x', { preHandler }, handler) / fastify.route({ method, url, handler })
  //   app.use((req, res, next) => {…})           — безымянный middleware → своя «функция»
  function routeCall(call, prefix) {
    const fn = field(call, 'function');
    if (fn?.type !== 'member_expression') return false;
    const method = field(fn, 'property')?.text;
    const obj = field(fn, 'object');
    const args = field(call, 'arguments')?.namedChildren || [];
    const line = call.startPosition.row + 1;
    if (method === 'use' || method === 'addHook' || method === 'register') {
      let found = false;
      args.forEach((a) => {
        if (!FUNC.has(a.type)) return;
        add({ name: `${obj.text.split('.').pop()}.${method}@${a.startPosition.row + 1}`, kind: 'function', outer: a, fn: a, body: field(a, 'body'), sigNode: a });
        visit(field(a, 'body'), prefix);
        found = true;
      });
      return found;
    }
    if (method === 'route' && args[0]?.type === 'object') {
      // fastify.route({ method: 'GET', url: '/x', handler })
      const prop = (k) => args[0].namedChildren.find((p) => p.type === 'pair' && field(p, 'key')?.text.replace(/['"]/g, '') === k);
      const m = strValue(field(prop('method'), 'value')), u = strValue(field(prop('url'), 'value'));
      const h = field(prop('handler'), 'value');
      if (m === null || u === null) return false;
      const inline = h && FUNC.has(h.type) ? h : null;
      add({ name: `${m.toUpperCase()} ${u}`, kind: 'route', outer: call, fn: inline, body: inline && field(inline, 'body'), route: `${obj.text}.route('${u}')`, sigNode: call });
      if (inline) visit(field(inline, 'body'), prefix);
      return true;
    }
    // цепочка router.route('/x').get(a).post(b)
    const segs = [];
    let cur = call;
    while (cur?.type === 'call_expression' && field(cur, 'function')?.type === 'member_expression') {
      const f = field(cur, 'function');
      segs.unshift({ method: field(f, 'property')?.text, args: field(cur, 'arguments')?.namedChildren || [], call: cur });
      cur = field(f, 'object');
    }
    let base = null, path = null;
    if (segs.length > 1 && segs[0].method === 'route' && cur) { base = cur; path = strValue(segs[0].args[0]); segs.shift(); }
    else if (segs.length === 1) { base = obj; path = strValue(args[0]); segs[0].args = args.slice(1); }
    if (path === null || !base || !segs.every((g) => HTTP.has(g.method))) return false;
    if (!segs.some((g) => g.args.length)) return false;
    for (const g of segs) {
      const last = g.args[g.args.length - 1];
      const inline = last && FUNC.has(last.type) ? last : null;
      const outer = segs.length === 1 ? call : g.call;
      add({ name: `${g.method.toUpperCase()} ${path}`, kind: 'route', outer, fn: inline, body: inline && field(inline, 'body'), route: `${base.text}.${g.method}('${path}')`, sigNode: outer });
      g.args.forEach((a, i) => {
        if (a !== inline && FUNC.has(a.type)) add({ name: `${g.method.toUpperCase()} ${path} · шаг ${i + 1}`, kind: 'function', outer: a, fn: a, body: field(a, 'body'), sigNode: a });
      });
      for (const a of g.args) if (FUNC.has(a.type)) visit(field(a, 'body'), prefix);
    }
    void line;
    return true;
  }

  // prefix — имя внешней функции для вложенных (Компонент.обработчик)
  function visit(node, prefix) {
    if (!node) return;
    switch (node.type) {
      case 'function_declaration':
      case 'generator_function_declaration': {
        const n = field(node, 'name');
        const nm = prefix ? `${prefix}.${n.text}` : n.text;
        const outer = node.parent?.type === 'export_statement' ? node.parent : node;
        add({ name: nm, kind: 'function', outer, fn: node, sigNode: node, body: field(node, 'body') });
        visit(field(node, 'body'), nm);
        return;
      }
      case 'class_declaration':
        if (!prefix) { klass(node, prefix); return; }
        break;
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const d of node.namedChildren) if (d.type === 'variable_declarator') declarator(d, prefix);
        return;
      case 'export_statement': {
        const decl = field(node, 'declaration');
        if (decl) { visit(decl, prefix); return; }
        const val = field(node, 'value') || node.namedChildren.find((c) => FUNC.has(c.type) || c.type === 'class');
        if (val && FUNC.has(val.type)) {
          add({ name: stem, kind: 'function', outer: node, fn: val, sigNode: node, body: field(val, 'body') });
          visit(field(val, 'body'), stem);
          return;
        }
        if (val?.type === 'class') { klass(val, prefix); return; }
        break;
      }
      case 'expression_statement': {
        const e = node.namedChild(0);
        if (e?.type === 'call_expression' && routeCall(e, prefix)) return;
        if (e?.type === 'await_expression' && e.namedChild(0)?.type === 'call_expression' && routeCall(e.namedChild(0), prefix)) return;
        if (e?.type === 'assignment_expression') {
          const left = field(e, 'left'), right = field(e, 'right');
          // exports.x = function / module.exports.x = () => {}
          if (left?.type === 'member_expression' && /^(module\.)?exports\./.test(left.text) && right && FUNC.has(right.type)) {
            const nm = field(left, 'property').text;
            add({ name: nm, kind: 'function', outer: node, fn: right, sigNode: node, body: field(right, 'body') });
            visit(field(right, 'body'), nm);
            return;
          }
          if (left?.text === 'module.exports' && right?.type === 'object') { objectMethods(right, stem); return; }
        }
        break;
      }
      default:
        break;
    }
    for (const ch of node.namedChildren) visit(ch, prefix);
  }

  const mongooseSchemas = {};
  visit(root, null);
  const facts = collectFacts(root, ranges, stem);
  Object.assign(facts, jsExtras(root, { file, source, items, ranges, nodeItem, entities, mongooseSchemas, decoratorsOf }));
  const doc = root.namedChild(0)?.type === 'comment' ? collapse(cleanComment(root.namedChild(0).text), 200) : '';
  tree.delete();
  return { items, doc, facts };
}

// ---- факты для графа: импорты, экспорты, вызовы и JSX-ссылки ----
function collectFacts(root, ranges, stem) {
  const imports = {}; // локальное имя → { source, name: 'default'|'*'|имя }
  const exportsMap = {}; // экспортируемое имя → локальное имя
  for (const n of root.namedChildren) {
    if (n.type === 'import_statement') {
      const src = strValue(field(n, 'source'));
      const clause = n.namedChildren.find((c) => c.type === 'import_clause');
      if (!src || !clause) continue;
      for (const c of clause.namedChildren) {
        if (c.type === 'identifier') imports[c.text] = { source: src, name: 'default' };
        else if (c.type === 'namespace_import') imports[c.namedChild(0).text] = { source: src, name: '*' };
        else if (c.type === 'named_imports') {
          for (const s of c.namedChildren) {
            if (s.type !== 'import_specifier') continue;
            const nm = field(s, 'name').text, al = field(s, 'alias')?.text;
            imports[al || nm] = { source: src, name: nm };
          }
        }
      }
    }
    if (n.type === 'export_statement') {
      const decl = field(n, 'declaration');
      const isDefault = n.children.some((c) => c.type === 'default');
      if (decl) {
        const names = [];
        if (field(decl, 'name')) names.push(field(decl, 'name').text);
        for (const d of decl.namedChildren) {
          if (d.type !== 'variable_declarator') continue;
          const dn = field(d, 'name');
          if (dn?.type === 'identifier') names.push(dn.text);
          else if (dn?.type === 'object_pattern') for (const p of dn.namedChildren) if (p.type === 'shorthand_property_identifier_pattern') names.push(p.text);
        }
        for (const nm of names) exportsMap[isDefault ? 'default' : nm] = nm;
      } else if (isDefault) {
        const v = field(n, 'value') || n.namedChildren[0];
        exportsMap.default = v?.type === 'identifier' ? v.text : stem;
      }
      const clause = n.namedChildren.find((c) => c.type === 'export_clause');
      for (const s of clause?.namedChildren || []) {
        if (s.type !== 'export_specifier') continue;
        const nm = field(s, 'name').text, al = field(s, 'alias')?.text;
        exportsMap[al || nm] = nm;
      }
    }
  }
  // require и module.exports — в любом месте файла
  for (const n of walk(root)) {
    if (n.type === 'variable_declarator') {
      const val = field(n, 'value');
      if (val?.type === 'call_expression' && field(val, 'function')?.text === 'require') {
        const src = strValue(field(val, 'arguments')?.namedChild(0));
        const nm = field(n, 'name');
        if (!src || !nm) continue;
        if (nm.type === 'identifier') imports[nm.text] = { source: src, name: '*' };
        else if (nm.type === 'object_pattern') {
          for (const p of nm.namedChildren) {
            if (p.type === 'shorthand_property_identifier_pattern') imports[p.text] = { source: src, name: p.text };
            else if (p.type === 'pair_pattern') imports[field(p, 'value').text] = { source: src, name: field(p, 'key').text };
          }
        }
      }
    }
    if (n.type === 'assignment_expression') {
      const left = field(n, 'left'), right = field(n, 'right');
      if (left?.text === 'module.exports') {
        if (right?.type === 'identifier') exportsMap.default = right.text;
        if (right?.type === 'object') {
          for (const p of right.namedChildren) {
            if (p.type === 'shorthand_property_identifier') exportsMap[p.text] = p.text;
            else if (p.type === 'pair' && field(p, 'value')?.type === 'identifier') exportsMap[field(p, 'key').text] = field(p, 'value').text;
            else if (p.type === 'pair' || p.type === 'method_definition') exportsMap[(field(p, 'key') || field(p, 'name')).text] = `${stem}.${(field(p, 'key') || field(p, 'name')).text}`;
          }
        }
      } else if (left?.type === 'member_expression' && /^(module\.)?exports\.\w+$/.test(left.text)) {
        const nm = field(left, 'property').text;
        exportsMap[nm] = right?.type === 'identifier' ? right.text : nm;
      }
    }
  }

  // Места связей по каждой функции: вызовы, <Компонент/>, функции, переданные
  // аргументом или в JSX-атрибут (onClick={handle}), с номером строки и условием
  // вокруг (if / else / ?: / && / for / try / .map(…)). Плюс локальные переменные
  // и тип результата — чтобы узнать, чей метод вызывается: s = new Store(); s.add().
  const rangeAt = new Map(ranges.map((r) => [`${r.start}:${r.end}`, r]));
  const sites = []; // { from, line, kind, ctx, target }
  const aliases = {}; // короткое имя → полное имя в этом файле (см. createSlice actions)
  const locals = {}; // id функции | '' (уровень файла) → { имя: spec }
  const fnInfo = {}; // id → { retAnn, ret }
  const classAttrs = {}; // класс → { поле: { ann } | { spec, owner } }
  const parentOf = {};
  for (const r of ranges) {
    const p = ranges.filter((q) => q !== r && q.start <= r.start && r.end <= q.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    parentOf[r.id] = p?.id || '';
    fnInfo[r.id] = { retAnn: field(r.fn, 'return_type')?.text?.replace(/^:\s*/, '') || null, ret: null };
    if (r.body && r.body.type !== 'statement_block' && r.body.type !== 'class_body') fnInfo[r.id].ret = jsSpec(r.body);
  }
  const short = (t, n = 48) => { const c = (t || '').replace(/\s+/g, ' ').trim(); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };
  const add = (n, owner, ctx, kind, target) => { if (owner) sites.push({ from: owner, line: n.startPosition.row + 1, kind, ctx: ctx.slice(-2).join(' › '), target }); };
  const bind = (owner, name, spec) => { const m = (locals[owner || ''] ||= {}); if (spec && !(name in m)) m[name] = spec; };
  const refOf = (n) => {
    if (n.type === 'identifier') return { t: 'name', name: n.text };
    if (n.type === 'member_expression') {
      const o = field(n, 'object'), p = field(n, 'property')?.text;
      if (o?.type === 'this') return { t: 'this', name: p };
      return { t: 'member', obj: o?.type === 'identifier' ? o.text : null, objSpec: jsSpec(o), name: p, text: n.text.length < 80 ? n.text : '' };
    }
    return null;
  };
  const isRefNode = (n) => n && (n.type === 'identifier' || (n.type === 'member_expression' && ['this', 'identifier'].includes(field(n, 'object')?.type)));

  function v(n, ctx, owner) {
    if (!n) return;
    const r = rangeAt.get(`${n.startIndex}:${n.endIndex}`);
    if (r && r.id !== owner) { owner = r.id; ctx = []; }
    switch (n.type) {
      case 'call_expression': case 'new_expression': {
        const f = field(n, 'function') || field(n, 'constructor');
        const ref = f && refOf(f);
        if (ref) add(n, owner, ctx, 'call', ref);
        if (f && f.type === 'member_expression') v(field(f, 'object'), ctx, owner);
        else if (f && !ref) v(f, ctx, owner);
        const label = `${short(f?.text || '', 28)}(…)`;
        const own = r && r.id === owner; // маршрут app.get('/x', (req, res) => …) — это сама функция, не «внутри вызова»
        for (const a of field(n, 'arguments')?.namedChildren || []) {
          if (isRefNode(a)) add(a, owner, ctx, 'ref', refOf(a));
          else if (FUNC.has(a.type) && !rangeAt.has(`${a.startIndex}:${a.endIndex}`)) v(a, own ? ctx : [...ctx, label], owner);
          else v(a, ctx, owner);
        }
        return;
      }
      case 'jsx_opening_element': case 'jsx_self_closing_element': {
        const nm = field(n, 'name');
        if (nm?.type === 'identifier' && /^[A-Z]/.test(nm.text)) add(n, owner, ctx, 'call', { t: 'name', name: nm.text });
        else if (nm?.type === 'member_expression') add(n, owner, ctx, 'call', { t: 'member', obj: field(nm, 'object').text, objSpec: jsSpec(field(nm, 'object')), name: field(nm, 'property').text });
        for (const c of n.namedChildren) if (c !== nm) v(c, ctx, owner);
        return;
      }
      case 'jsx_expression': {
        const e = n.namedChild(0);
        if (isRefNode(e)) { add(e, owner, ctx, 'ref', refOf(e)); return; }
        break;
      }
      case 'pair': {
        const val = field(n, 'value');
        if (isRefNode(val)) { add(val, owner, ctx, 'ref', refOf(val)); return; }
        break;
      }
      case 'array': {
        for (const c of n.namedChildren) if (isRefNode(c) && c.type === 'identifier') add(c, owner, ctx, 'ref', refOf(c)); else v(c, ctx, owner);
        return;
      }
      case 'variable_declarator': {
        const nm = field(n, 'name'), typ = field(n, 'type'), val = field(n, 'value');
        // const { addItem } = cartSlice.actions → addItem это редьюсер cartSlice.addItem
        if (nm?.type === 'object_pattern' && val?.type === 'member_expression' && field(val, 'property')?.text === 'actions' && field(val, 'object')?.type === 'identifier') {
          for (const p of nm.namedChildren) if (p.type === 'shorthand_property_identifier_pattern') aliases[p.text] = `${field(val, 'object').text}.${p.text}`;
        }
        if (nm?.type === 'identifier') bind(owner, nm.text, typ ? { k: 'ann', text: typ.text.replace(/^:\s*/, '') } : jsSpec(val));
        if (isRefNode(val) && val.type === 'identifier') add(val, owner, ctx, 'ref', refOf(val));
        else v(val, ctx, owner);
        return;
      }
      case 'required_parameter': case 'optional_parameter': {
        const pat = field(n, 'pattern'), typ = field(n, 'type');
        if (pat?.type === 'identifier' && typ) bind(owner, pat.text, { k: 'ann', text: typ.text.replace(/^:\s*/, '') });
        // constructor(private readonly booksService: BooksService) — поле класса (внедрение зависимостей)
        if (pat?.type === 'identifier' && typ && owner && /\.constructor$/.test(owner) && n.namedChildren.some((c) => c.type === 'accessibility_modifier' || c.text === 'readonly')) {
          const cls = owner.split('::')[1].split('.')[0];
          (classAttrs[cls] ||= {})[pat.text] = { ann: typ.text.replace(/^:\s*/, '') };
        }
        v(field(n, 'value'), ctx, owner);
        return;
      }
      case 'assignment_expression': {
        const l = field(n, 'left'), rt = field(n, 'right');
        if (l?.type === 'member_expression' && field(l, 'object')?.type === 'this' && owner) {
          const cls = owner.split('::')[1].split('.')[0];
          const attrs = (classAttrs[cls] ||= {});
          attrs[field(l, 'property').text] ??= { spec: jsSpec(rt), owner };
        }
        if (l?.type === 'identifier') bind(owner, l.text, jsSpec(rt)); // book = await repo.addBook(...) — тип для book.setAuthors()
        if (isRefNode(rt) && rt.type === 'identifier') add(rt, owner, ctx, 'ref', refOf(rt));
        else v(rt, ctx, owner);
        v(l, ctx, owner);
        return;
      }
      case 'public_field_definition': case 'field_definition': {
        const nm = field(n, 'name') || field(n, 'property'), typ = field(n, 'type');
        const cls = n.parent?.parent && field(n.parent.parent, 'name')?.text;
        if (cls && nm && typ) ((classAttrs[cls] ||= {})[nm.text] = { ann: typ.text.replace(/^:\s*/, '') });
        break;
      }
      case 'return_statement': {
        const e = n.namedChild(0);
        if (owner && e && !fnInfo[owner].ret) fnInfo[owner].ret = jsSpec(e);
        if (isRefNode(e) && e.type === 'identifier') { add(e, owner, ctx, 'ref', refOf(e)); return; }
        break;
      }
      case 'if_statement': {
        v(field(n, 'condition'), ctx, owner);
        v(field(n, 'consequence'), [...ctx, `if ${short(field(n, 'condition')?.text)}`], owner);
        v(field(n, 'alternative'), [...ctx, 'else'], owner);
        return;
      }
      case 'ternary_expression': {
        const c = short(field(n, 'condition')?.text, 36);
        v(field(n, 'condition'), ctx, owner);
        v(field(n, 'consequence'), [...ctx, `${c} ?`], owner);
        v(field(n, 'alternative'), [...ctx, `${c} ? … :`], owner);
        return;
      }
      case 'binary_expression': {
        const op = n.children.find((c) => !c.isNamed)?.text;
        if (op === '&&' || op === '||' || op === '??') {
          v(field(n, 'left'), ctx, owner);
          v(field(n, 'right'), [...ctx, `${short(field(n, 'left')?.text, 36)} ${op}`], owner);
          return;
        }
        break;
      }
      case 'for_statement': case 'for_in_statement': case 'while_statement': case 'do_statement': {
        const body = field(n, 'body');
        for (const c of n.namedChildren) if (c !== body) v(c, ctx, owner);
        const head = n.type === 'for_in_statement' ? `for (${short(field(n, 'left')?.text, 16)} of ${short(field(n, 'right')?.text, 28)})` : n.type === 'for_statement' ? 'for (…)' : `while ${short(field(n, 'condition')?.text, 36)}`;
        v(body, [...ctx, head], owner);
        return;
      }
      case 'try_statement':
        v(field(n, 'body'), [...ctx, 'try'], owner);
        v(field(n, 'handler'), [...ctx, 'catch'], owner);
        v(field(n, 'finalizer'), [...ctx, 'finally'], owner);
        return;
      case 'switch_case': {
        const val = field(n, 'value');
        for (const c of n.namedChildren) if (c !== val) v(c, [...ctx, `case ${short(val?.text, 30)}:`], owner);
        return;
      }
      case 'switch_default':
        for (const c of n.namedChildren) v(c, [...ctx, 'default:'], owner);
        return;
      default: break;
    }
    for (const c of n.namedChildren) v(c, ctx, owner);
  }
  v(root, [], null);
  for (const [k, full] of Object.entries(aliases)) if (exportsMap[k] === k) exportsMap[k] = full;
  return { imports, exportsMap, sites, locals, fnInfo, classAttrs, parentOf, aliases };
}

// выражение → простое описание для вывода типа
function jsSpec(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': return { k: 'var', name: n.text };
    case 'this': return { k: 'this' };
    case 'new_expression': { const c = field(n, 'constructor'); return c?.type === 'identifier' ? { k: 'new', name: c.text } : null; }
    case 'call_expression': {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { k: 'call', name: f.text };
      if (f?.type === 'member_expression') return { k: 'mcall', obj: jsSpec(field(f, 'object')), attr: field(f, 'property')?.text };
      return null;
    }
    case 'member_expression': return { k: 'attr', obj: jsSpec(field(n, 'object')), attr: field(n, 'property')?.text };
    case 'await_expression': case 'parenthesized_expression': case 'as_expression': case 'non_null_expression': case 'satisfies_expression':
      return jsSpec(n.namedChild(0));
    default: return null;
  }
}

// ---- граф для всех JS-файлов ----
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

/**
 * Места связей для всех JS-файлов: { src, tgt, line, kind: 'call'|'ref', ctx }.
 */
export function jsSites(jsFiles, itemsByFile, kinds, extraEntities = []) {
  const files = new Set(Object.keys(jsFiles));
  const resolveSource = (from, src) => {
    if (!src.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), src));
    for (const e of EXTS) if (files.has(base + e)) return base + e;
    return null;
  };
  const byName = {}; // file → { полное имя → id }
  for (const [f, items] of Object.entries(itemsByFile)) {
    const m = {};
    for (const it of items) m[it.name] = it.id;
    byName[f] = m;
  }
  const exportedLocal = (file, name) => {
    const ex = jsFiles[file]?.exportsMap || {};
    return name === 'default' ? ex.default : ex[name] || name;
  };
  // экспорт с учётом реэкспорта: export { Book } from / import Book …; export { Book }
  const exported = (file, name, depth = 0) => {
    const l = exportedLocal(file, name);
    if (!l) return null;
    if (byName[file]?.[l]) return byName[file][l];
    const imp = depth < 4 && jsFiles[file]?.imports[l];
    if (imp) { const tf = resolveSource(file, imp.source); if (tf) return exported(tf, imp.name === '*' ? 'default' : imp.name, depth + 1); }
    return null;
  };
  const nameOf = (id) => id.split('::')[1].replace(/#\d+$/, '');

  // имя в функции owner файла file → id (сначала вложенные, потом файл, потом импорт)
  function resolveName(file, owner, name) {
    const names = byName[file] || {};
    const parts = owner ? nameOf(owner).split('.') : [];
    for (let i = parts.length; i >= 0; i--) { const id = names[[...parts.slice(0, i), name].join('.')]; if (id) return id; }
    const al = jsFiles[file]?.aliases?.[name];
    if (al && names[al]) return names[al];
    const imp = jsFiles[file]?.imports[name];
    if (imp) { const tf = resolveSource(file, imp.source); if (tf) return exported(tf, imp.name === '*' ? 'default' : imp.name); }
    return null;
  }
  const classMethod = (clsId, m) => {
    if (!clsId) return null;
    const [f, cls] = clsId.split('::');
    return byName[f]?.[`${cls}.${m}`] || null;
  };
  const isClass = (id) => id && (kinds.get(id) === 'class' || kinds.get(id) === 'entity');
  function annType(file, owner, text) {
    if (!text) return null;
    const words = (text.match(/[A-Za-z_$][\w$]*/g) || []).filter((w) => !['Promise', 'Array', 'Readonly', 'Partial', 'ReadonlyArray', 'undefined', 'null', 'typeof'].includes(w));
    for (const w of words) { const id = resolveName(file, owner, w); if (isClass(id)) return id; }
    return null;
  }
  const retMemo = new Map();
  function retType(id, depth) {
    if (!id || depth > 6) return null;
    if (retMemo.has(id)) return retMemo.get(id);
    retMemo.set(id, null);
    const file = id.split('::')[0];
    const info = jsFiles[file]?.fnInfo[id];
    const t = info ? annType(file, id, info.retAnn) || typeOf(info.ret, file, id, depth + 1) : null;
    retMemo.set(id, t);
    return t;
  }
  function localSpec(file, owner, name) {
    const facts = jsFiles[file];
    for (let o = owner || ''; ; o = facts.parentOf[o] || '') {
      const m = facts.locals[o];
      if (m && name in m) return { spec: m[name], owner: o };
      if (!o) return null;
    }
  }
  function typeOf(spec, file, owner, depth = 0) {
    if (!spec || depth > 8) return null;
    switch (spec.k) {
      case 'this': { const cls = owner && nameOf(owner).split('.')[0]; const id = cls && byName[file]?.[cls]; return isClass(id) ? id : null; }
      case 'var': {
        const l = localSpec(file, owner, spec.name);
        if (l && l.spec !== spec) return typeOf(l.spec, file, l.owner || null, depth + 1);
        if (!l) {
          // имя самой сущности (Book.findByPk) — «статический» вызов модели
          const id = resolveName(file, owner, spec.name);
          if (id && kinds.get(id) === 'entity') return `static:${id}`;
        }
        const imp = jsFiles[file].imports[spec.name];
        if (imp) {
          const tf = resolveSource(file, imp.source);
          const local = tf && exportedLocal(tf, imp.name === '*' ? 'default' : imp.name);
          const m = local && jsFiles[tf].locals[''];
          if (m && local in m) return typeOf(m[local], tf, null, depth + 1);
        }
        return null;
      }
      case 'ann': return annType(file, owner, spec.text);
      case 'new': { const id = resolveName(file, owner, spec.name); return isClass(id) ? id : null; }
      case 'call': return retType(resolveName(file, owner, spec.name), depth);
      case 'mcall': {
        const t = typeOf(spec.obj, file, owner, depth + 1);
        if (t?.startsWith('static:')) return ORM_INSTANCE.has(spec.attr) ? t.slice(7) : null; // Book.create() → объект Book
        if (t && kinds.get(t) === 'entity' && /^(get|create)[A-Z]/.test(spec.attr || '')) return entityOfAssoc(t, spec.attr);
        if (t) return retType(classMethod(t, spec.attr), depth);
        if (spec.obj?.k === 'var') {
          const imp = jsFiles[file].imports[spec.obj.name];
          const tf = imp && resolveSource(file, imp.source);
          if (tf) return retType(exported(tf, spec.attr), depth);
        }
        return null;
      }
      case 'attr': {
        const t = typeOf(spec.obj, file, owner, depth + 1);
        if (!t || t.startsWith('static:')) return null;
        const [cf, cls] = t.split('::');
        const x = jsFiles[cf]?.classAttrs[cls]?.[spec.attr];
        if (x?.ann) return annType(cf, null, x.ann);
        if (x?.spec) return typeOf(x.spec, cf, x.owner, depth + 1);
        return null;
      }
      default: return null;
    }
  }

  // ---- сущности: связи (Sequelize associations, TypeORM-декораторы, ref в Mongoose) ----
  const entities = [];
  const entByModel = {};
  for (const [file, facts] of Object.entries(jsFiles)) for (const e of facts.entities || []) { entities.push({ ...e, file }); entByModel[e.model] ??= e.id; }
  const entById = Object.fromEntries(entities.map((e) => [e.id, e]));
  // Prisma: prisma.user.findMany() → сущность User
  const prismaByLower = Object.fromEntries(extraEntities.map((e) => [e.model[0].toLowerCase() + e.model.slice(1), e.id]));
  const sing = (w) => w.replace(/ies$/, 'y').replace(/s$/, '');
  const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
  for (const [file, facts] of Object.entries(jsFiles)) {
    for (const a of facts.assoc || []) {
      const from = resolveName(file, null, a.from), to = resolveName(file, null, a.to);
      if (!entById[from] || !entById[to]) continue;
      const through = a.through && (resolveName(file, null, a.through) || entities.find((e) => e.table === a.through || e.model === a.through)?.id || a.through);
      const as = a.as || (a.kind === 'hasMany' || a.kind === 'belongsToMany' ? `${entById[to].model.toLowerCase()}s` : entById[to].model.toLowerCase());
      const many = a.kind === 'hasMany' || a.kind === 'belongsToMany';
      const methods = many
        ? ['get', 'set', 'add', 'remove', 'has', 'count'].map((m) => `${m}${cap(as)}`).concat(['add', 'remove', 'has', 'create'].map((m) => `${m}${cap(sing(as))}`))
        : ['get', 'set', 'create'].map((m) => `${m}${cap(as)}`);
      entById[from].relations.push({ kind: a.kind, to, as, fk: a.fk, otherKey: a.otherKey, through, file, line: a.line, methods: [...new Set(methods)] });
    }
  }
  for (const e of entities) {
    for (const r of e.relations) if (r.to && !entById[r.to]) { const id = resolveName(e.file, null, r.to) || entByModel[r.to]; if (id) r.to = id; }
    for (const f of e.fields) {
      if (e.orm === 'mongoose' && f.ref?.model && entByModel[f.ref.model] && !e.relations.some((r) => r.as === f.name)) {
        e.relations.push({ kind: f.type.endsWith('[]') ? 'hasMany' : 'belongsTo', to: entByModel[f.ref.model], as: f.name, fk: f.name, file: e.file, line: e.line || 0, methods: [] });
      }
      if (f.ref?.model) f.ref.id = resolveName(e.file, null, f.ref.model) || entByModel[f.ref.model] || null;
    }
  }
  // book.setAuthors(...) / author.getBooks() — методы, которые добавила связь
  function assocOf(entId, method) {
    for (const r of entById[entId]?.relations || []) if (r.methods?.includes(method)) return r;
    return null;
  }
  function entityOfAssoc(entId, method) { return assocOf(entId, method)?.to || null; }

  const out = [];
  for (const [file, facts] of Object.entries(jsFiles)) {
    const names = byName[file] || {};
    for (const s of facts.sites) {
      const r = s.target;
      let tgt = null, label = '';
      if (r.t === 'name') tgt = resolveName(file, s.from, r.name);
      else if (r.t === 'this') {
        const cls = nameOf(s.from).split('.')[0];
        tgt = names[`${cls}.${r.name}`] || null;
      } else if (r.t === 'member') {
        const imp = r.obj ? facts.imports[r.obj] : null;
        if (imp) {
          const tf = resolveSource(file, imp.source);
          if (tf) tgt = exported(tf, r.name) || byName[tf]?.[`${exported(tf, 'default')?.split('::')[1]}.${r.name}`] || null;
        } else if (r.obj && names[`${r.obj}.${r.name}`]) tgt = names[`${r.obj}.${r.name}`]; // объект в том же файле
        if (!tgt) {
          const t = typeOf(r.objSpec, file, s.from);
          if (s.kind === 'ref' && t && (t.startsWith('static:') || kinds.get(t) === 'entity')) { /* book.publisher — чтение поля, не передача функции */ }
          else if (t?.startsWith('static:')) { tgt = t.slice(7); label = r.text || `${r.obj || '…'}.${r.name}`; } // Book.findByPk(...)
          else if (!t && r.objSpec?.k === 'attr' && prismaByLower[r.objSpec.attr]) { tgt = prismaByLower[r.objSpec.attr]; label = `${r.objSpec.obj?.name || 'prisma'}.${r.objSpec.attr}.${r.name}`; }
          else if (t && kinds.get(t) === 'entity') {
            const rel = assocOf(t, r.name);
            tgt = rel?.to || t; label = r.text || `${r.obj || '…'}.${r.name}`; // book.setAuthors(...) — через связь
          } else tgt = classMethod(t, r.name);
        }
      }
      if (!tgt || tgt === s.from || !kinds.has(tgt)) continue;
      if (s.kind === 'ref' && kinds.get(tgt) === 'class') continue;
      out.push({ src: s.from, tgt, line: s.line, kind: s.kind, ctx: s.ctx, label });
    }
  }
  const resolver = { resolveName, resolveSource, exported, exportedLocal, classMethod, byName, kinds, annType };
  const web = jsWeb(jsFiles, resolver, out);
  return { sites: out, entities, web };
}
