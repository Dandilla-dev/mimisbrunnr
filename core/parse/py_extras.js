// Дополнения к разбору Python, которые собираются, пока дерево живо:
//  - сущности: SQLAlchemy (Column, mapped_column, relationship), SQLModel, Pydantic, dataclass, Django;
//  - веб-обвязка FastAPI и Flask: приложения, роутеры, префиксы, middleware, обработчики ошибок;
//  - «что внутри функции»: параметры, переменные, откуда и куда, что возвращается и бросается.
import { field, walk } from './treesitter.js';

const short = (t, n = 60) => { const c = String(t || '').replace(/\s+/g, ' ').trim(); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };
const line = (n) => n.startPosition.row + 1;
const str = (n) => (n?.type === 'string' ? n.text.replace(/^[rubfRUBF]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '') : null);
const args = (call) => field(call, 'arguments')?.namedChildren || [];
const kw = (call, k) => { const a = args(call).find((x) => x.type === 'keyword_argument' && field(x, 'name')?.text === k); return a ? field(a, 'value') : null; };
const pos = (call) => args(call).filter((x) => x.type !== 'keyword_argument');
const callee = (call) => field(call, 'function')?.text || '';
const last = (t) => t.split('.').pop();

// ---------------------------------------------------------------- сущности
const SA_COL = /^(Column|mapped_column|db\.Column|sa\.Column|sqlalchemy\.Column|Field)$/;
const SA_REL = /^(relationship|db\.relationship|sa\.orm\.relationship|Relationship)$/;
const DJANGO_REL = { ForeignKey: 'belongsTo', OneToOneField: 'hasOne', ManyToManyField: 'belongsToMany' };
const PYD_BASE = /^(BaseModel|BaseSettings|pydantic\.BaseModel|RootModel|Schema)$/;

function annInfo(t) {
  if (!t) return { type: '', list: false, optional: false };
  let s = t.replace(/["']/g, '').replace(/^Mapped\[(.*)\]$/, '$1');
  const optional = /^Optional\[/.test(s) || /\|\s*None\b/.test(s);
  s = s.replace(/^Optional\[(.*)\]$/, '$1').replace(/\s*\|\s*None\b/, '');
  const m = s.match(/^(?:list|List|set|Set|Sequence|tuple)\[(.*)\]$/);
  return { type: s, list: Boolean(m), elem: m ? m[1].trim() : s.trim(), optional };
}

/** class_definition → описание сущности или null. bases — имена базовых классов. */
export function pyEntity(def, decs) {
  const bases = (field(def, 'superclasses')?.namedChildren || []).map((b) => b.text);
  const body = field(def, 'body');
  const name = field(def, 'name')?.text || '';
  const isDataclass = decs.some((d) => /^@(dataclasses\.)?dataclass\b/.test(d));
  const tableKw = (field(def, 'superclasses')?.namedChildren || []).some((b) => b.type === 'keyword_argument' && field(b, 'name')?.text === 'table' && field(b, 'value')?.text === 'True');
  const fields = [], relations = [];
  let table = '', saLike = false, djangoLike = bases.some((b) => /(^|\.)Model$/.test(b) && /models\./.test(b));
  for (const st of body?.namedChildren || []) {
    if (st.type !== 'expression_statement') continue;
    const a = st.namedChild(0);
    if (a?.type !== 'assignment') continue;
    const l = field(a, 'left'), r = field(a, 'right'), t = field(a, 'type');
    if (l?.type !== 'identifier') continue;
    const fname = l.text;
    if (fname === '__tablename__') { table = str(r) || ''; saLike = true; continue; }
    if (fname.startsWith('__') || fname === 'model_config' || fname === 'Config') continue;
    const ai = annInfo(t?.text);
    const f = { name: fname, type: ai.type, validate: [] };
    if (r?.type === 'call') {
      const c = callee(r);
      if (SA_REL.test(c)) {
        saLike = true;
        const target = str(pos(r)[0]) || pos(r)[0]?.text || ai.elem;
        const secondary = kw(r, 'secondary');
        relations.push({ kind: secondary ? 'belongsToMany' : ai.list || kw(r, 'uselist')?.text === 'True' ? 'hasMany' : 'belongsTo', to: target, as: fname, through: secondary ? (str(secondary) || secondary.text) : '', back: str(kw(r, 'back_populates')) || str(kw(r, 'backref')) || '', line: line(st) });
        f.relation = true;
        fields.push(f);
        continue;
      }
      if (djangoLike && /^models\./.test(c)) {
        const kind = DJANGO_REL[last(c)];
        f.type = last(c).replace(/Field$/, '');
        if (kind) { relations.push({ kind, to: str(pos(r)[0]) || pos(r)[0]?.text || '', as: fname, line: line(st) }); f.relation = true; }
        if (kw(r, 'primary_key')?.text === 'True') f.pk = true;
        if (kw(r, 'null')?.text !== 'True' && kw(r, 'blank')?.text !== 'True' && !kw(r, 'default')) f.required = true;
        if (kw(r, 'unique')?.text === 'True') f.unique = true;
        if (kw(r, 'default')) f.default = short(kw(r, 'default').text, 40);
        if (kw(r, 'max_length')) f.validate.push(`max_length=${kw(r, 'max_length').text}`);
        fields.push(f);
        continue;
      }
      if (SA_COL.test(c)) {
        if (c !== 'Field') saLike = true;
        for (const p of pos(r)) {
          if (p.type === 'call' && /ForeignKey$/.test(callee(p))) f.ref = { table: str(pos(p)[0]) || '', model: '' };
          else if (!f.type || c !== 'Field') f.type = f.type && c === 'Field' ? f.type : (ai.type || p.text);
        }
        if (!f.type) f.type = ai.type;
        if (kw(r, 'primary_key')?.text === 'True') f.pk = true;
        if (kw(r, 'nullable')?.text === 'False') f.required = true;
        if (kw(r, 'unique')?.text === 'True') f.unique = true;
        if (kw(r, 'autoincrement')?.text === 'True') f.auto = true;
        for (const k of ['default', 'server_default', 'default_factory']) if (kw(r, k)) f.default = short(kw(r, k).text, 40);
        for (const k of ['min_length', 'max_length', 'gt', 'ge', 'lt', 'le', 'pattern', 'regex', 'alias']) if (kw(r, k)) f.validate.push(`${k}=${short(kw(r, k).text, 30)}`);
        if (c === 'Field' && pos(r)[0]?.text === '...') f.required = true;
        if (c === 'Field' && !kw(r, 'default') && !kw(r, 'default_factory') && !pos(r).length && !ai.optional) f.required = true;
        fields.push(f);
        continue;
      }
      if (/^(dataclasses\.)?field$/.test(c)) {
        for (const k of ['default', 'default_factory']) if (kw(r, k)) f.default = short(kw(r, k).text, 40);
        fields.push(f);
        continue;
      }
    }
    if (t) {
      if (r) f.default = short(r.text, 40); else if (!ai.optional) f.required = true;
      fields.push(f);
    }
  }
  // валидаторы Pydantic и свойства
  const validators = [];
  for (const m of body?.namedChildren || []) {
    if (m.type !== 'decorated_definition') continue;
    const ds = m.namedChildren.filter((c) => c.type === 'decorator').map((d) => d.text);
    const fn = field(m, 'definition');
    if (ds.some((d) => /validator\b|model_validator|root_validator/.test(d))) validators.push(`${field(fn, 'name')?.text}: ${short(ds[0].replace(/^@/, ''), 50)}`);
  }
  let orm = null;
  if (djangoLike) orm = 'django';
  else if (bases.some((b) => b === 'SQLModel') && tableKw) orm = 'sqlmodel';
  else if (saLike) orm = 'sqlalchemy';
  else if (bases.some((b) => PYD_BASE.test(b)) || bases.some((b) => b === 'SQLModel')) orm = 'pydantic';
  else if (isDataclass) orm = 'dataclass';
  return { orm, model: name, table, fields, relations, hooks: validators, bases };
}

// ---------------------------------------------------------------- веб-обвязка
const APP_RE = /^(FastAPI|fastapi\.FastAPI|Flask|flask\.Flask|Starlette)$/;
const ROUTER_RE = /^(APIRouter|fastapi\.APIRouter|Blueprint|flask\.Blueprint)$/;
const HTTPM = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'websocket', 'api_route', 'route']);

const depName = (n) => (n?.type === 'call' && /(^|\.)Depends$/.test(callee(n)) ? pos(n)[0]?.text || '' : null);
const depsList = (n) => (n?.type === 'list' ? n.namedChildren.map(depName).filter(Boolean) : []);

/** Приложения, роутеры, подключения и декораторы маршрутов в модуле. */
export function pyWebFacts(root) {
  const vars = {}; // имя → { kind, fw, prefix, deps }
  const calls = []; // include_router / register_blueprint / add_middleware
  const decorated = []; // { fn, decs: [{ obj, method, path, kwargs, text }], params }
  const passes = []; // register_routers(app): приложение передано в функцию
  // значения имён уровня модуля — для «for m in ROUTERS», где ROUTERS = (a, b)
  const modVal = {};
  for (const st of root.namedChildren) {
    const a = st.type === 'expression_statement' ? st.namedChild(0) : null;
    if (a?.type === 'assignment' && field(a, 'left')?.type === 'identifier') modVal[field(a, 'left').text] ??= field(a, 'right');
  }
  const listItems = (n, d = 0) => (!n || d > 2 ? null : ['list', 'tuple', 'set'].includes(n.type) ? n.namedChildren : n.type === 'identifier' ? listItems(modVal[n.text], d + 1) : null);
  // где стоит вызов: функция (и её параметры), условие, цикл
  function placeOf(n) {
    const conds = [];
    let loop = null, fn = null;
    for (let c = n, p = n.parent; p; c = p, p = p.parent) {
      if (p.type === 'function_definition') { fn = p; break; }
      if (p.type === 'if_statement' && field(p, 'consequence') && field(p, 'consequence').startIndex === c.startIndex) conds.unshift(`если ${short(field(p, 'condition')?.text, 50)}`);
      if (p.type === 'elif_clause') conds.unshift(`если ${short(field(p, 'condition')?.text, 50)}`);
      if (p.type === 'else_clause' && p.parent?.type === 'if_statement') conds.unshift(`если не ${short(field(p.parent, 'condition')?.text, 50)}`);
      if (p.type === 'for_statement' && !loop) loop = { var: field(p, 'left')?.text || '', items: listItems(field(p, 'right')) };
    }
    const params = fn ? (field(fn, 'parameters')?.namedChildren || []).map((x) => (x.type === 'identifier' ? x.text : (field(x, 'name') || x.namedChild(0))?.text)).filter(Boolean) : [];
    return { cond: conds.join(' и '), loop, fn: fn ? field(fn, 'name')?.text : null, fnTop: fn?.parent?.type === 'module' || fn?.parent?.parent?.type === 'module', params };
  }
  for (const n of walk(root)) {
    if (n.type === 'assignment') {
      const l = field(n, 'left'), r = field(n, 'right');
      if (l?.type === 'identifier' && r?.type === 'call') {
        const c = callee(r);
        if (APP_RE.test(c)) vars[l.text] = { kind: 'app', fw: /Flask/.test(c) ? 'flask' : 'fastapi' };
        else if (ROUTER_RE.test(c)) {
          const flask = /Blueprint/.test(c);
          vars[l.text] = { kind: 'router', fw: flask ? 'flask' : 'fastapi', prefix: str(kw(r, flask ? 'url_prefix' : 'prefix')) || '', deps: depsList(kw(r, 'dependencies')) };
        }
      }
    } else if (n.type === 'call' && field(n, 'function')?.type === 'attribute') {
      const f = field(n, 'function');
      const m = field(f, 'attribute')?.text;
      const obj = field(f, 'object')?.text;
      const at = placeOf(n);
      const place = { cond: at.cond, fn: at.fnTop ? at.fn : null, objIsParam: Boolean(at.fnTop && at.params.includes(obj)) };
      if (['include_router', 'register_blueprint'].includes(m)) {
        const what = pos(n)[0];
        const t = what?.text || '';
        // for module in (assistant, auth): app.include_router(module.router) → каждый элемент списка
        let targets = null;
        if (at.loop?.items && at.loop.var && (t === at.loop.var || t.startsWith(`${at.loop.var}.`))) targets = at.loop.items.map((x) => x.text + t.slice(at.loop.var.length));
        calls.push({ obj, method: m, target: t, targets, loopVar: targets ? at.loop.var : '', prefix: str(kw(n, m === 'include_router' ? 'prefix' : 'url_prefix')) || '', deps: depsList(kw(n, 'dependencies')), line: line(n), ...place });
      } else if (m === 'add_middleware') {
        calls.push({ obj, method: m, target: pos(n)[0]?.text || '', line: line(n), text: short(n.text, 60), ...place });
      }
    }
    if (n.type === 'call') {
      // register_routers(app) — функция получает приложение
      const f = field(n, 'function');
      const ft = f?.text || '';
      if (f && !/\.(include_router|register_blueprint|add_middleware|route|get|post|put|patch|delete|run|listen)$/.test(ft) && !APP_RE.test(ft) && !ROUTER_RE.test(ft)) {
        const at = placeOf(n);
        pos(n).forEach((a, i) => {
          if (a.type !== 'identifier' || !(vars[a.text] || at.params.includes(a.text) || /^(app|application|api|bp|blueprint|router)$/.test(a.text))) return;
          passes.push({ callee: ft, arg: a.text, argIndex: i, line: line(n), fn: at.fnTop ? at.fn : null, argIsParam: Boolean(at.fnTop && at.params.includes(a.text) && !vars[a.text]), cond: at.cond, text: short(n.text, 60) });
        });
      }
    } else if (n.type === 'decorated_definition') {
      const fn = field(n, 'definition');
      if (fn?.type !== 'function_definition') continue;
      const decs = [];
      for (const d of n.namedChildren.filter((c) => c.type === 'decorator')) {
        const e = d.namedChild(0);
        if (e?.type === 'call' && field(e, 'function')?.type === 'attribute') {
          const f = field(e, 'function');
          const kwargs = {};
          for (const a of args(e)) if (a.type === 'keyword_argument') kwargs[field(a, 'name').text] = a;
          decs.push({
            obj: field(f, 'object')?.text, method: field(f, 'attribute')?.text, path: str(pos(e)[0]),
            first: pos(e)[0]?.text || '',
            methods: kwargs.methods ? (field(kwargs.methods, 'value')?.namedChildren || []).map(str).filter(Boolean) : [],
            responseModel: kwargs.response_model ? field(kwargs.response_model, 'value')?.text : '',
            status: kwargs.status_code ? field(kwargs.status_code, 'value')?.text : '',
            deps: depsList(kwargs.dependencies ? field(kwargs.dependencies, 'value') : null),
            text: short(d.text, 80),
          });
        } else if (e?.type === 'attribute') decs.push({ obj: field(e, 'object')?.text, method: field(e, 'attribute')?.text, path: null, text: d.text });
        else decs.push({ obj: null, method: e?.type === 'call' ? callee(e) : e?.text, path: null, text: d.text, plain: true });
      }
      const params = [];
      for (const p of field(fn, 'parameters')?.namedChildren || []) {
        const nm = p.type === 'identifier' ? p : field(p, 'name') || p.namedChild(0);
        params.push({ name: nm?.text || '', type: field(p, 'type')?.text || '', dep: depName(field(p, 'value')) });
      }
      decorated.push({ fn: field(fn, 'name').text, line: line(n), decs, params, top: n.parent?.type === 'module' });
    }
  }
  return { vars, calls, decorated, passes };
}

// ---------------------------------------------------------------- поток данных
const INPUT_RE = /^(request\.(json|args|form|files|headers|cookies|values|data|get_json|query_params|path_params|body|client|url)|os\.environ|os\.getenv|settings\.\w+|config\.\w+)/;
const TX_RE = /(^|\.)(commit|rollback|begin|transaction|begin_nested|flush)$/;
const NET_RE = /^(requests|httpx|aiohttp|urllib)\b/;

function descr(n) {
  if (!n) return '';
  switch (n.type) {
    case 'await': return `await ${descr(n.namedChild(0))}`;
    case 'call': return `${short(callee(n), 50)}(…)`;
    case 'list': return n.namedChildCount ? 'список […]' : 'пустой список []';
    case 'dictionary': return n.namedChildCount ? 'словарь {…}' : 'пустой словарь {}';
    case 'string': return `строка ${short(n.text, 40)}`;
    case 'integer': case 'float': return `число ${n.text}`;
    case 'list_comprehension': case 'generator_expression': return `список из ${short(n.text, 50)}`;
    default: return short(n.text, 60);
  }
}

export function pyFlow(def) {
  const params = [];
  for (const p of field(def, 'parameters')?.namedChildren || []) {
    const nm = p.type === 'identifier' ? p : field(p, 'name') || (p.type === 'typed_parameter' ? p.namedChild(0) : null);
    if (!nm || nm.text === 'self' || nm.text === 'cls') continue;
    const v = field(p, 'value');
    params.push({ name: nm.text, type: field(p, 'type')?.text || '', deco: depName(v) ? `Depends(${depName(v)})` : v ? `= ${short(v.text, 30)}` : '' });
  }
  const known = new Set(params.map((p) => p.name));
  const vars = [], reassign = [], inputs = [], outputs = [], effects = [];
  const uses = {};
  const seen = new Set();
  const use = (name, u) => { const l = (uses[name] ||= []); if (l.length < 12 && !l.some((x) => x.how === u.how && x.to === u.to && x.line === u.line)) l.push(u); };
  const bindName = (nm, n, from, kind) => {
    if (params.some((p) => p.name === nm) || vars.some((v) => v.name === nm)) { reassign.push({ name: nm, line: line(n), from }); return; }
    known.add(nm); vars.push({ name: nm, line: line(n), from, kind });
  };
  function visit(n) {
    if (!n) return;
    switch (n.type) {
      case 'function_definition': case 'class_definition': case 'lambda': return; // вложенное — отдельно
      case 'assignment': case 'augmented_assignment': {
        const l = field(n, 'left'), r = field(n, 'right');
        if (l?.type === 'identifier') bindName(l.text, n, n.type === 'augmented_assignment' ? `${n.text.match(/[-+*/%|&^]+=/)?.[0] || '+='} ${short(r?.text, 40)}` : descr(r), n.type === 'augmented_assignment' ? 'изменение' : '');
        else if (l?.type === 'pattern_list' || l?.type === 'tuple_pattern') l.namedChildren.forEach((c, i) => { if (c.type === 'identifier') bindName(c.text, c, `${short(r?.text, 40)}[${i}]`, 'из кортежа'); });
        visit(r);
        if (l && l.type !== 'identifier') visit(l);
        return;
      }
      case 'for_statement': {
        const l = field(n, 'left'), r = field(n, 'right');
        if (l?.type === 'identifier') bindName(l.text, l, `каждый элемент ${short(r?.text, 40)}`, 'цикл');
        else if (l) l.namedChildren.forEach((c) => c.type === 'identifier' && bindName(c.text, c, `из элементов ${short(r?.text, 36)}`, 'цикл'));
        visit(r); visit(field(n, 'body')); visit(field(n, 'alternative'));
        return;
      }
      case 'with_statement': {
        const clause = n.namedChildren.find((c) => c.type === 'with_clause');
        for (const it of clause?.namedChildren || []) {
          const v = it.namedChild(0);
          if (v?.type === 'as_pattern') {
            const t = v.namedChildren.find((c) => c.type === 'as_pattern_target')?.namedChild(0);
            if (t?.type === 'identifier') bindName(t.text, t, `with ${descr(v.namedChild(0))}`, 'with');
            visit(v.namedChild(0));
          } else visit(v);
        }
        if (/transaction|begin|session|connect/.test(clause?.text || '')) effects.push({ kind: 'tx', text: short(clause.text, 50), line: line(n) });
        visit(field(n, 'body'));
        return;
      }
      case 'except_clause': {
        const ap = n.namedChildren.find((c) => c.type === 'as_pattern');
        const t = ap?.namedChildren.find((c) => c.type === 'as_pattern_target')?.namedChild(0);
        if (t?.type === 'identifier') bindName(t.text, t, `ошибка ${short(ap.namedChild(0)?.text, 30)}`, 'ошибка');
        for (const c of n.namedChildren) if (c.type === 'block') visit(c);
        return;
      }
      case 'return_statement': {
        const v = n.namedChild(0);
        outputs.push({ kind: 'return', text: v ? short(v.text, 70) : '(ничего)', line: line(n), status: v?.type === 'expression_list' ? (v.namedChildren[1]?.text || '') : '' });
        if (v?.type === 'identifier' && known.has(v.text)) use(v.text, { how: 'return', to: 'return', line: line(n) });
        visit(v);
        return;
      }
      case 'raise_statement': {
        const v = n.namedChild(0);
        let text = short(v?.text, 80), status = '';
        if (v?.type === 'call') {
          status = kw(v, 'status_code')?.text || (pos(v)[0]?.type === 'integer' ? pos(v)[0].text : '');
          const msg = str(kw(v, 'detail')) || str(pos(v).find((x) => x.type === 'string'));
          text = `${callee(v)}${status ? ` ${status}` : ''}${msg ? `: ${short(msg, 70)}` : ''}`;
        }
        outputs.push({ kind: 'throw', text, status, line: line(n) });
        visit(v);
        return;
      }
      case 'if_statement': case 'elif_clause': case 'while_statement': {
        const c = field(n, 'condition');
        const inArgs = (id) => { for (let p = id.parent; p && p !== c; p = p.parent) if (p.type === 'argument_list') return true; return false; };
        for (const id of walk(c)) if (id.type === 'identifier' && known.has(id.text) && !inArgs(id)) use(id.text, { how: 'check', to: short(c.text, 50), line: line(n) });
        for (const ch of n.namedChildren) visit(ch);
        return;
      }
      case 'attribute': case 'subscript': {
        const t = n.text;
        const p = n.parent;
        const extended = p && (p.type === 'attribute' || p.type === 'subscript') && p.namedChild(0) === n && !(p.parent?.type === 'call' && field(p.parent, 'function') === p);
        if (!extended && INPUT_RE.test(t) && !seen.has(t)) { seen.add(t); inputs.push({ text: short(t, 60), line: line(n) }); }
        break;
      }
      case 'call': {
        const f = callee(n);
        if (/^(abort|flask\.abort)$/.test(f)) outputs.push({ kind: 'throw', text: `abort(${short(pos(n)[0]?.text, 20)})`, status: pos(n)[0]?.text || '', line: line(n) });
        else if (/(^|\.)(JSONResponse|Response|HTMLResponse|RedirectResponse|jsonify|make_response|render_template|redirect)$/.test(f)) {
          outputs.push({ kind: 'response', text: short(n.text, 80), status: kw(n, 'status_code')?.text || '', method: last(f), line: line(n) });
        }
        if (/(^|\.)getenv$|^os\.environ\.get$/.test(f) && !seen.has(n.text)) { seen.add(n.text); inputs.push({ text: short(n.text, 60), line: line(n) }); }
        for (const a of args(n)) {
          const v = a.type === 'keyword_argument' ? field(a, 'value') : a;
          if (v?.type === 'identifier' && known.has(v.text)) use(v.text, { how: 'arg', to: a.type === 'keyword_argument' ? `${short(f, 40)}(${field(a, 'name').text}=…)` : short(f, 50), line: line(n) });
        }
        const fn = field(n, 'function');
        if (fn?.type === 'attribute' && field(fn, 'object')?.type === 'identifier' && known.has(field(fn, 'object').text)) {
          use(field(fn, 'object').text, { how: 'method', to: `${field(fn, 'object').text}.${field(fn, 'attribute').text}()`, line: line(n) });
        }
        if (TX_RE.test(f)) effects.push({ kind: 'tx', text: short(f, 50), line: line(n) });
        else if (NET_RE.test(f)) effects.push({ kind: 'net', text: short(f, 50), line: line(n) });
        else if (/^open$|^(aiofiles\.)?open$|\.write_text$|\.read_text$/.test(f)) effects.push({ kind: 'file', text: short(f, 50), line: line(n) });
        break;
      }
      default: break;
    }
    for (const ch of n.namedChildren) visit(ch);
  }
  visit(field(def, 'body'));
  return { params, inputs, vars, reassign, uses, outputs, effects };
}
