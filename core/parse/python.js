// Разбор Python: функции, классы, методы; импорты и вызовы для графа.
import { parse, field, walk, codeHash, headText, collapse } from './treesitter.js';
import { pyEntity, pyFlow, pyWebFacts } from './py_extras.js';

const ROUTE_RE = /^@?(router|app|bp|blueprint|api)\.(get|post|put|patch|delete|route|websocket|api_route)\b/;

function docstring(body) {
  const first = body && body.namedChild(0);
  if (first && first.type === 'expression_statement' && first.namedChild(0)?.type === 'string') {
    const raw = first.namedChild(0).text.replace(/^[rubfRUBF]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '');
    return raw.trim().split('\n')[0].trim();
  }
  return '';
}

function unwrap(node) {
  // decorated_definition → (декораторы, само определение)
  if (node.type === 'decorated_definition') {
    const decs = node.namedChildren.filter((c) => c.type === 'decorator').map((d) => d.text.trim());
    return { def: field(node, 'definition'), decs, outer: node };
  }
  return { def: node, decs: [], outer: node };
}

export function parsePython(file, source) {
  const tree = parse('python', source);
  const root = tree.rootNode;
  const items = [];
  const entities = [];
  const flows = {};
  function add(def, decs, outer, cls) {
    const isClass = def.type === 'class_definition';
    const nameNode = field(def, 'name');
    if (!nameNode) return;
    const name = cls ? `${cls}.${nameNode.text}` : nameNode.text;
    const body = field(def, 'body');
    const id = `${file}::${name}`;
    // сущность: SQLAlchemy / SQLModel / Pydantic / dataclass / Django
    const ent = isClass && !cls ? pyEntity(def, decs) : null;
    if (ent) entities.push({ id, ...ent });
    if (!isClass) flows[id] = pyFlow(def);
    items.push({
      id, file, name,
      kind: isClass ? (ent?.orm ? 'entity' : 'class') : cls ? 'method' : 'function',
      line: outer.startPosition.row + 1,
      end: outer.endPosition.row + 1,
      sig: headText(def, body, source),
      route: decs.map((d) => d.replace(/^@/, '')).find((d) => ROUTE_RE.test(d)) || '',
      doc: docstring(body),
      hash: isClass
        ? codeHash(def, (n) => n.type === 'function_definition' || n.type === 'decorated_definition')
        : codeHash(outer),
    });
    if (isClass && body) {
      for (const ch of body.namedChildren) {
        const u = unwrap(ch);
        if (u.def && u.def.type === 'function_definition') add(u.def, u.decs, u.outer, nameNode.text);
      }
    }
  }

  for (const ch of root.namedChildren) {
    const u = unwrap(ch);
    if (u.def && (u.def.type === 'function_definition' || u.def.type === 'class_definition')) add(u.def, u.decs, u.outer, null);
  }

  const fileDoc = docstring(root);
  const facts = collectFacts(root);
  facts.entities = entities; // в т. ч. классы без orm — их «наследники» Pydantic найдутся при сборке
  facts.flows = flows;
  facts.web = pyWebFacts(root);
  tree.delete();
  return { items, doc: fileDoc, facts };
}

// Факты для графа: импорты, имена верхнего уровня, экземпляры, функции.
// Собираем сразу, пока дерево живо, и храним как простые объекты.
//
// Для каждой функции запоминаем:
//  - места вызовов и упоминаний (строка, условие вокруг: if/else/for/try…);
//  - локальные переменные и чем они заданы (spec — выражение в простом виде),
//    чтобы потом узнать их тип: x = get_session() → тип результата get_session;
//  - тип результата: аннотация -> X, return X(...), return self.x, yield.
const short = (t, n = 60) => { const c = t.replace(/\s+/g, ' ').trim(); return c.length > n ? `${c.slice(0, n - 1)}…` : c; };

function exprSpec(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': return { k: 'var', name: n.text };
    case 'call': {
      const f = field(n, 'function');
      if (f?.type === 'identifier') return { k: 'call', name: f.text };
      if (f?.type === 'attribute') return { k: 'mcall', obj: exprSpec(field(f, 'object')), attr: field(f, 'attribute').text };
      return null;
    }
    case 'attribute': return { k: 'attr', obj: exprSpec(field(n, 'object')), attr: field(n, 'attribute').text };
    case 'subscript': return { k: 'iter', of: exprSpec(field(n, 'value')) };
    case 'await': case 'parenthesized_expression': return exprSpec(n.namedChild(0));
    default: return null;
  }
}

const COMPREHENSIONS = new Set(['list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression']);

function scanFunction(def, cls) {
  const fn = { cls, params: {}, locals: {}, retAnn: field(def, 'return_type')?.text || null, ret: null, yields: null, sites: [] };
  const bind = (name, spec) => { fn.names.push(name); if (spec && !(name in fn.locals)) fn.locals[name] = spec; };
  const site = (node, kind, target, ctx) => fn.sites.push({ line: node.startPosition.row + 1, kind, target, ctx: ctx.slice(-2).join(' › ') });

  fn.names = []; // все имена параметров и локальных переменных: они закрывают одноимённые функции модуля
  for (const prm of field(def, 'parameters')?.namedChildren || []) {
    const nm = prm.type === 'identifier' ? prm : field(prm, 'name') || (prm.type === 'typed_parameter' || prm.type === 'typed_default_parameter' ? prm.namedChild(0) : null);
    if (nm?.type === 'identifier') fn.names.push(nm.text);
    if (prm.type === 'identifier') continue;
    const typ = field(prm, 'type');
    if (nm && typ) fn.params[nm.text] = typ.text;
    const val = field(prm, 'value');
    if (val?.type === 'call' && field(val, 'function')?.text === 'Depends') {
      const arg = field(val, 'arguments')?.namedChild(0);
      if (arg?.type === 'identifier') site(val, 'call', { t: 'name', name: arg.text }, ['Depends(…)']);
    }
  }

  // ref — функция упомянута без вызова (передана аргументом, лежит в списке…)
  function ref(n, ctx) {
    if (n.type === 'identifier') site(n, 'ref', { t: 'name', name: n.text }, ctx);
    else if (n.type === 'attribute' && field(n, 'object')?.type === 'identifier') {
      site(n, 'ref', { t: 'attr', obj: exprSpec(field(n, 'object')), attr: field(n, 'attribute').text }, ctx);
    } else visit(n, ctx); // f(...).x, a.b.c — внутри могут быть вызовы
  }

  function visit(n, ctx) {
    if (!n) return;
    switch (n.type) {
      case 'call': {
        const f = field(n, 'function');
        if (f?.type === 'identifier') site(n, 'call', { t: 'name', name: f.text }, ctx);
        else if (f?.type === 'attribute') {
          site(n, 'call', { t: 'attr', obj: exprSpec(field(f, 'object')), attr: field(f, 'attribute').text }, ctx);
          visit(field(f, 'object'), ctx);
        } else visit(f, ctx);
        const args = field(n, 'arguments');
        if (args?.type === 'generator_expression') { visit(args, ctx); return; } // sum(x.f() for x in xs)
        for (const a of args?.namedChildren || []) {
          const v = a.type === 'keyword_argument' ? field(a, 'value') : a;
          if (v && (v.type === 'identifier' || v.type === 'attribute')) ref(v, ctx); else visit(v, ctx);
        }
        return;
      }
      case 'assignment': {
        const l = field(n, 'left'), r = field(n, 'right'), t = field(n, 'type');
        if (l?.type === 'identifier') bind(l.text, t ? { k: 'ann', text: t.text } : exprSpec(r));
        if (r && (r.type === 'identifier' || r.type === 'attribute')) ref(r, ctx); else visit(r, ctx);
        return;
      }
      case 'return_statement': {
        const v = n.namedChild(0);
        if (v && !fn.ret) fn.ret = exprSpec(v);
        if (v && (v.type === 'identifier' || v.type === 'attribute')) ref(v, ctx); else visit(v, ctx);
        return;
      }
      case 'yield': { const v = n.namedChild(0); if (v && !fn.yields) fn.yields = exprSpec(v); visit(v, ctx); return; }
      case 'list': case 'tuple': case 'set':
        for (const c of n.namedChildren) if (c.type === 'identifier' || c.type === 'attribute') ref(c, ctx); else visit(c, ctx);
        return;
      case 'pair': { const v = field(n, 'value'); visit(field(n, 'key'), ctx); if (v && (v.type === 'identifier' || v.type === 'attribute')) ref(v, ctx); else visit(v, ctx); return; }
      case 'if_statement': {
        visit(field(n, 'condition'), ctx);
        visit(field(n, 'consequence'), [...ctx, `if ${short(field(n, 'condition')?.text || '')}:`]);
        for (const alt of n.childrenForFieldName('alternative')) {
          if (alt.type === 'elif_clause') {
            visit(field(alt, 'condition'), ctx);
            visit(field(alt, 'consequence'), [...ctx, `elif ${short(field(alt, 'condition')?.text || '')}:`]);
          } else visit(alt, [...ctx, 'else:']);
        }
        return;
      }
      case 'for_statement': {
        const l = field(n, 'left'), r = field(n, 'right');
        if (l?.type === 'identifier') bind(l.text, { k: 'iter', of: exprSpec(r) });
        visit(r, ctx);
        visit(field(n, 'body'), [...ctx, `for ${short(l?.text || '', 20)} in ${short(r?.text || '', 36)}:`]);
        if (field(n, 'alternative')) visit(field(n, 'alternative'), [...ctx, 'for … else:']);
        return;
      }
      case 'conditional_expression': { // a if cond else b
        const [yes, cond, no] = n.namedChildren;
        visit(cond, ctx);
        visit(yes, [...ctx, `… if ${short(cond?.text || '', 40)}`]);
        visit(no, [...ctx, `… else (не ${short(cond?.text || '', 34)})`]);
        return;
      }
      case 'while_statement':
        visit(field(n, 'condition'), ctx);
        visit(field(n, 'body'), [...ctx, `while ${short(field(n, 'condition')?.text || '')}:`]);
        return;
      case 'try_statement':
        for (const c of n.namedChildren) {
          if (c.type === 'block') visit(c, [...ctx, 'try:']);
          else if (c.type === 'except_clause' || c.type === 'except_group_clause') {
            const what = c.namedChildren.filter((x) => x.type !== 'block').map((x) => x.text).join(' ');
            for (const b of c.namedChildren.filter((x) => x.type === 'block')) visit(b, [...ctx, `except ${short(what, 40)}:`.replace('except :', 'except:')]);
          } else if (c.type === 'finally_clause') visit(c, [...ctx, 'finally:']);
          else visit(c, ctx);
        }
        return;
      case 'with_statement': {
        const clause = n.namedChildren.find((c) => c.type === 'with_clause');
        for (const it of clause?.namedChildren || []) {
          const v = it.namedChild(0);
          if (v?.type === 'as_pattern') {
            const target = v.namedChildren.find((c) => c.type === 'as_pattern_target')?.namedChild(0);
            if (target?.type === 'identifier') bind(target.text, exprSpec(v.namedChild(0)));
            visit(v.namedChild(0), ctx);
          } else visit(v, ctx);
        }
        visit(field(n, 'body'), [...ctx, `with ${short(clause?.text || '', 40)}:`]);
        return;
      }
      case 'function_definition':
        visit(field(n, 'body'), [...ctx, `def ${field(n, 'name')?.text}():`]);
        return;
      case 'lambda':
        visit(field(n, 'body'), [...ctx, 'lambda']);
        return;
      default:
        if (COMPREHENSIONS.has(n.type)) {
          const clauses = n.namedChildren.filter((c) => c.type === 'for_in_clause');
          for (const c of clauses) {
            const l = field(c, 'left');
            if (l?.type === 'identifier') bind(l.text, { k: 'iter', of: exprSpec(field(c, 'right')) });
            visit(field(c, 'right'), ctx);
          }
          const inner = [...ctx, clauses.length ? `for ${short(field(clauses[0], 'left')?.text || '', 20)} in ${short(field(clauses[0], 'right')?.text || '', 36)}` : 'for …'];
          for (const c of n.namedChildren) {
            if (c.type === 'for_in_clause') continue;
            if (c.type === 'if_clause') visit(c, inner); else visit(c, inner);
          }
          return;
        }
        for (const c of n.namedChildren) visit(c, ctx);
    }
  }
  visit(field(def, 'body'), []);
  return fn;
}

function collectFacts(root) {
  const imports = {}; // локальное имя → { module, name|null, level }
  const instances = {}; // имя переменной уровня модуля → { spec } | { ann }
  const classes = {}; // имя класса → [методы]
  const classAttrs = {}; // класс → { поле: { ann } | { spec, method } }
  const fns = {}; // имя (как в items) → факты функции
  const top = new Set();

  for (const n of root.namedChildren) {
    if (n.type === 'import_from_statement') {
      const modNode = field(n, 'module_name');
      let level = 0, module = '';
      if (modNode?.type === 'relative_import') {
        level = (modNode.text.match(/^\.+/) || [''])[0].length;
        module = modNode.text.slice(level);
      } else if (modNode) module = modNode.text;
      for (const nm of n.childrenForFieldName('name')) {
        if (nm.type === 'aliased_import') imports[field(nm, 'alias').text] = { module, name: field(nm, 'name').text, level };
        else imports[nm.text] = { module, name: nm.text, level };
      }
    } else if (n.type === 'import_statement') {
      for (const nm of n.childrenForFieldName('name')) {
        if (nm.type === 'aliased_import') imports[field(nm, 'alias').text] = { module: field(nm, 'name').text, name: null, level: 0 };
        else imports[nm.text.split('.')[0]] = { module: nm.text.split('.')[0], name: null, level: 0 };
      }
    } else if (n.type === 'expression_statement' && n.namedChild(0)?.type === 'assignment') {
      const a = n.namedChild(0);
      const left = field(a, 'left'), right = field(a, 'right'), typ = field(a, 'type');
      if (left?.type === 'identifier') instances[left.text] = typ ? { ann: typ.text } : { spec: exprSpec(right) };
    }
    const u = n.type === 'decorated_definition' ? field(n, 'definition') : n;
    if (u && (u.type === 'function_definition' || u.type === 'class_definition')) top.add(field(u, 'name').text);
    if (u?.type === 'function_definition') fns[field(u, 'name').text] = scanFunction(u, null);
    if (u?.type === 'class_definition') {
      const cname = field(u, 'name').text;
      classes[cname] = [];
      const attrs = (classAttrs[cname] = {});
      for (const m of field(u, 'body')?.namedChildren || []) {
        // поля класса с аннотацией (dataclass): items: list[Item] = …
        if (m.type === 'expression_statement' && m.namedChild(0)?.type === 'assignment') {
          const a = m.namedChild(0);
          if (field(a, 'left')?.type === 'identifier' && field(a, 'type')) attrs[field(a, 'left').text] = { ann: field(a, 'type').text };
          continue;
        }
        const d = m.type === 'decorated_definition' ? field(m, 'definition') : m;
        if (d?.type !== 'function_definition') continue;
        const mname = field(d, 'name').text;
        classes[cname].push(mname);
        fns[`${cname}.${mname}`] = scanFunction(d, cname);
        // self.x = … / self.x: T = … внутри любых методов
        for (const s of walk(d)) {
          if (s.type !== 'assignment') continue;
          const l = field(s, 'left'), r = field(s, 'right'), t = field(s, 'type');
          if (l?.type !== 'attribute' || field(l, 'object')?.text !== 'self') continue;
          const attr = field(l, 'attribute').text;
          if (t) attrs[attr] = { ann: t.text };
          else if (!attrs[attr] && r) { const sp = exprSpec(r); if (sp) attrs[attr] = { spec: sp, method: mname }; }
        }
      }
    }
  }
  return { imports, instances, classes, classAttrs, top: [...top], fns };
}

// ---- граф вызовов для всех Python-файлов проекта ----

function moduleName(file) {
  let m = file.replace(/\.py$/, '').replace(/\//g, '.');
  if (m.endsWith('.__init__')) m = m.slice(0, -'.__init__'.length);
  return m;
}

const SEQ = /^(?:typing\.)?(?:list|List|Sequence|MutableSequence|Iterable|Iterator|set|Set|frozenset|FrozenSet|tuple|Tuple|Collection|Generator|AsyncIterator|AsyncIterable|AsyncGenerator|deque)\[\s*([A-Za-z_][\w.]*)/;

/**
 * pyFiles: { файл → факты }, kinds: Map(id → вид).
 * Возвращает места связей: { src, tgt, line, kind: 'call'|'ref', ctx }.
 */
export function pythonSites(pyFiles, kinds) {
  const modToFile = {};
  for (const f of Object.keys(pyFiles)) {
    const m = moduleName(f);
    modToFile[m] = f;
    if (m.startsWith('src.')) modToFile[m.slice(4)] ??= f;
  }
  const classFile = {};
  const classMethods = {};
  const classAttrs = {};
  for (const [f, facts] of Object.entries(pyFiles)) {
    for (const [c, ms] of Object.entries(facts.classes)) {
      classFile[c] ??= f; classMethods[c] ??= new Set(ms); classAttrs[c] ??= facts.classAttrs[c] || {};
    }
  }
  // запасной путь (как раньше): «self.memory = Memory()» где угодно → memory: Memory
  const globalInst = {};
  for (const facts of Object.values(pyFiles)) {
    for (const [v, x] of Object.entries(facts.instances)) if (x.spec?.k === 'call' && classFile[x.spec.name]) globalInst[v] ??= x.spec.name;
    for (const attrs of Object.values(facts.classAttrs)) {
      for (const [a, x] of Object.entries(attrs)) if (x.spec?.k === 'call' && classFile[x.spec.name]) globalInst[a] ??= x.spec.name;
    }
  }

  const ctxCache = {};
  function fileCtx(file) {
    if (ctxCache[file]) return ctxCache[file];
    const facts = pyFiles[file];
    const pkg = moduleName(file).split('.').slice(0, file.endsWith('__init__.py') ? undefined : -1);
    const resolveModule = (imp) => {
      if (!imp.level) return imp.module;
      const base = pkg.slice(0, pkg.length - (imp.level - 1));
      return [...base, ...(imp.module ? [imp.module] : [])].join('.');
    };
    const importTarget = (name) => {
      const imp = facts.imports[name];
      if (!imp || !imp.name) return null;
      const f = modToFile[resolveModule(imp)];
      return f ? { file: f, name: imp.name } : null;
    };
    const resolveName = (name) => {
      if (facts.top.includes(name)) return `${file}::${name}`;
      const t = importTarget(name);
      return t ? `${t.file}::${t.name}` : null;
    };
    const moduleOf = (name) => {
      const imp = facts.imports[name];
      if (!imp) return null;
      const mod = resolveModule(imp);
      if (imp.name === null) return modToFile[mod] || null;
      return modToFile[`${mod}.${imp.name}`] || null; // from core import db
    };
    return (ctxCache[file] = { file, facts, resolveName, importTarget, moduleOf });
  }

  const method = (cls, attr) => (cls && classMethods[cls]?.has(attr) ? `${classFile[cls]}::${cls}.${attr}` : null);
  const known = (w) => (classFile[w] ? w : null);
  function annType(text) {
    if (!text) return null;
    let t = text.replace(/["']/g, '').trim();
    for (let i = 0; i < 3; i++) {
      const m = t.match(/^(?:typing\.)?(?:Optional|Annotated|Awaitable|Coroutine|Type)\[(.*)\]$/);
      if (!m) break;
      t = m[1].split(',')[m[0].startsWith('Coroutine') ? 2 : 0]?.trim() || '';
    }
    t = t.split('|').map((x) => x.trim()).find((x) => x && x !== 'None') || '';
    const seq = t.match(SEQ);
    if (seq) { const c = known(seq[1].split('.').pop()); return c ? { elem: c } : null; }
    const c = (t.match(/[A-Za-z_]\w*/g) || []).map(known).find(Boolean);
    return c ? { c } : null;
  }

  const retMemo = new Map();
  function retType(id, depth) {
    if (!id || depth > 6) return null;
    if (retMemo.has(id)) return retMemo.get(id);
    retMemo.set(id, null); // защита от рекурсии
    const [file, qual] = id.split('::');
    const fc = pyFiles[file] && fileCtx(file);
    const fn = fc?.facts.fns[qual];
    let t = null;
    if (fn) t = annType(fn.retAnn) || (fn.ret && typeOf(fn.ret, { fc, fn }, depth + 1)) || (fn.yields && typeOf(fn.yields, { fc, fn }, depth + 1));
    retMemo.set(id, t);
    return t;
  }
  function attrType(cls, attr, depth) {
    const x = classAttrs[cls]?.[attr];
    if (x?.ann) return annType(x.ann);
    if (x?.spec) {
      const fc = fileCtx(classFile[cls]);
      const fn = fc.facts.fns[`${cls}.${x.method}`];
      const t = fn && typeOf(x.spec, { fc, fn, skip: attr }, depth + 1);
      if (t) return t;
    }
    return globalInst[attr] ? { c: globalInst[attr] } : null;
  }
  function moduleVarType(file, name, depth) {
    const x = pyFiles[file]?.instances?.[name];
    if (!x) return null;
    if (x.ann) return annType(x.ann);
    return typeOf(x.spec, { fc: fileCtx(file), fn: null }, depth + 1);
  }
  function typeOf(spec, env, depth = 0) {
    if (!spec || depth > 8) return null;
    const { fc, fn } = env;
    switch (spec.k) {
      case 'var': {
        if ((spec.name === 'self' || spec.name === 'cls') && fn?.cls) return { c: fn.cls };
        if (fn && spec.name in fn.locals && fn.locals[spec.name] !== spec) {
          const t = typeOf(fn.locals[spec.name], { ...env, fn: { ...fn, locals: { ...fn.locals, [spec.name]: spec } } }, depth + 1);
          if (t) return t;
        }
        if (fn?.params[spec.name]) { const t = annType(fn.params[spec.name]); if (t) return t; }
        if (fc.facts.instances[spec.name]) { const t = moduleVarType(fc.file, spec.name, depth); if (t) return t; }
        const imp = fc.importTarget(spec.name);
        if (imp && pyFiles[imp.file]?.instances[imp.name]) { const t = moduleVarType(imp.file, imp.name, depth); if (t) return t; }
        return globalInst[spec.name] ? { c: globalInst[spec.name] } : null;
      }
      case 'call': {
        if (known(spec.name)) return { c: spec.name };
        return retType(fc.resolveName(spec.name), depth);
      }
      case 'mcall': {
        const t = typeOf(spec.obj, env, depth + 1);
        if (t?.c) return retType(method(t.c, spec.attr), depth);
        if (spec.obj?.k === 'var') { const mf = fc.moduleOf(spec.obj.name); if (mf) return retType(`${mf}::${spec.attr}`, depth); }
        return null;
      }
      case 'attr': {
        const t = typeOf(spec.obj, env, depth + 1);
        if (t?.c) return attrType(t.c, spec.attr, depth);
        return globalInst[spec.attr] ? { c: globalInst[spec.attr] } : null; // deps.store.x() — как раньше
      }
      case 'iter': {
        const t = typeOf(spec.of, env, depth + 1);
        return t?.elem ? { c: t.elem } : null;
      }
      case 'ann': return annType(spec.text);
      default: return null;
    }
  }

  const out = [];
  for (const file of Object.keys(pyFiles)) {
    const fc = fileCtx(file);
    for (const [qual, fn] of Object.entries(fc.facts.fns)) {
      const src = `${file}::${qual}`;
      const env = { fc, fn };
      const shadow = new Set(fn.names);
      for (const s of fn.sites) {
        let tgt = null;
        const t = s.target;
        if (t.t === 'name') tgt = shadow.has(t.name) ? null : fc.resolveName(t.name);
        else if (t.t === 'attr') {
          const ot = typeOf(t.obj, env);
          if (ot?.c) tgt = method(ot.c, t.attr);
          if (!tgt && t.obj?.k === 'var') { const mf = fc.moduleOf(t.obj.name); if (mf) tgt = `${mf}::${t.attr}`; }
        }
        if (!tgt || tgt === src || !kinds.has(tgt)) continue;
        if (s.kind === 'ref' && kinds.get(tgt) === 'class') continue; // isinstance(x, Cls) и т. п. — не «передача функции»
        out.push({ src, tgt, line: s.line, kind: s.kind, ctx: s.ctx });
      }
    }
  }
  // ---- сущности: наследники Pydantic/SQLModel из других файлов и связи ----
  const entAll = {};
  for (const [file, facts] of Object.entries(pyFiles)) for (const e of facts.entities || []) entAll[e.id] = { ...e, file };
  const promote = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const e of Object.values(entAll)) {
      if (e.orm) continue;
      const fc = fileCtx(e.file);
      const base = (e.bases || []).map((b) => fc.resolveName(b.split('.').pop()) || (classFile[b] ? `${classFile[b]}::${b}` : null)).map((id) => entAll[id]).find((x) => x?.orm);
      if (base) { e.orm = base.orm === 'sqlalchemy' ? 'sqlalchemy' : base.orm; promote.push(e.id); }
    }
  }
  const entities = Object.values(entAll).filter((e) => e.orm).map(({ bases, ...e }) => e); // eslint-disable-line no-unused-vars
  const byModel = Object.fromEntries(entities.map((e) => [e.model, e.id]));
  const byTable = Object.fromEntries(entities.filter((e) => e.table).map((e) => [e.table, e.id]));
  for (const e of entities) {
    for (const r of e.relations) {
      const nm = String(r.to || '').split('.').pop().replace(/["']/g, '');
      r.toName = nm; r.to = byModel[nm] || fileCtx(e.file).resolveName(nm) || nm;
      if (r.through) r.throughId = byTable[r.through] || byModel[r.through] || null;
    }
    for (const f of e.fields) if (f.ref?.table) { const t = f.ref.table.split('.')[0]; f.ref.id = byTable[t] || null; f.ref.model = byTable[t]?.split('::')[1] || t; }
  }

  // ---- путь запроса: FastAPI и Flask ----
  const AUTH = /auth|jwt|token|login|current_?user|permission|role|admin|verify|session/i;
  const containers = {}; // «файл:имя» → { fw, kind, prefix, deps, routes, mws, errors, ext, includes }
  const ck = (file, name) => `${file}:${name}`;
  const varOf = (file, name) => {
    if (!name) return null;
    if (pyFiles[file]?.web?.vars?.[name]) return ck(file, name);
    const fc = fileCtx(file);
    const t = fc.importTarget(name);
    if (t && pyFiles[t.file]?.web?.vars?.[t.name]) return ck(t.file, t.name);
    if (name.includes('.')) { const [mod, v] = name.split('.'); const mf = fc.moduleOf(mod); if (mf && pyFiles[mf]?.web?.vars?.[v]) return ck(mf, v); }
    return null;
  };
  for (const [file, facts] of Object.entries(pyFiles)) {
    for (const [name, v] of Object.entries(facts.web?.vars || {})) containers[ck(file, name)] = { file, name, ...v, routes: [], mws: [], errors: [], ext: [], includes: [], passes: [] };
  }
  for (const [file, facts] of Object.entries(pyFiles)) {
    const fc = fileCtx(file);
    for (const d of facts.web?.decorated || []) {
      const id0 = `${file}::${d.fn}`;
      // вложенные (в create_app) — без своей «функции», но обработчик ошибок и before_request всё равно покажем
      const id = d.top && kinds.has(id0) ? id0 : null;
      if (!id && !d.decs.some((x) => /errorhandler|exception_handler|before_request|middleware/.test(x.method || ''))) continue;
      const plain = d.decs.filter((x) => x.plain || !varOf(file, x.obj));
      for (const dec of d.decs) {
        const c = containers[varOf(file, dec.obj)];
        if (!c) continue;
        if (HTTPM_PY.has(dec.method) && dec.path !== null) {
          const methods = dec.method === 'route' || dec.method === 'api_route' ? (dec.methods.length ? dec.methods : ['GET']) : [dec.method === 'websocket' ? 'WS' : dec.method.toUpperCase()];
          c.routes.push({ id, methods, path: dec.path, deps: dec.deps, responseModel: dec.responseModel, status: dec.status, params: d.params, plain, line: d.line, file });
        } else if (dec.method === 'middleware') c.mws.push({ role: 'middleware', id, label: '', about: 'промежуточный обработчик: видит каждый запрос до обработчика и ответ после', file, line: d.line });
        else if (dec.method === 'before_request' || dec.method === 'before_app_request') c.mws.push({ role: AUTH.test(d.fn) ? 'auth' : 'middleware', id, label: '', about: 'выполняется перед каждым запросом', file, line: d.line });
        else if (dec.method === 'exception_handler' || dec.method === 'errorhandler' || dec.method === 'app_errorhandler') c.errors.push({ role: 'error', id, label: `${dec.first || ''}`, about: `обрабатывает ${dec.first || 'ошибку'}`, file, line: d.line });
      }
    }
    // функция, получившая приложение параметром (def register_routers(app): app.include_router(...))
    const paramC = (fn, fw) => (containers[`fn:${file}::${fn}`] ||= { file, name: fn, kind: 'param', fw, prefix: '', deps: [], routes: [], mws: [], errors: [], ext: [], includes: [], passes: [] });
    for (const call of facts.web?.calls || []) {
      const c = call.objIsParam && call.fn ? paramC(call.fn, call.method === 'register_blueprint' ? 'flask' : 'fastapi') : containers[varOf(file, call.obj)];
      if (!c) continue;
      if (call.method === 'add_middleware') c.ext.push({ role: AUTH.test(call.target) ? 'auth' : 'middleware', id: null, label: call.target, about: KNOWN_PY[call.target] || 'подключённый middleware', file, line: call.line, cond: call.cond });
      else {
        const list = call.targets || [call.target];
        for (const t of list) c.includes.push({ target: varOf(file, t), prefix: call.prefix, deps: call.deps, line: call.line, file, text: t, cond: call.cond, loop: call.targets ? call.loopVar : '' });
      }
    }
    for (const ps of facts.web?.passes || []) {
      const c = ps.argIsParam && ps.fn ? paramC(ps.fn, 'fastapi') : containers[varOf(file, ps.arg)];
      if (!c) continue;
      const id = fc.resolveName(ps.callee.split('.').pop()) && !ps.callee.includes('.') ? fc.resolveName(ps.callee)
        : ps.callee.includes('.') ? (() => { const [m, f] = ps.callee.split('.'); const mf = fc.moduleOf(m); return mf ? `${mf}::${f}` : null; })() : null;
      if (id) (c.passes ||= []).push({ target: `fn:${id}`, file, line: ps.line, cond: ps.cond, text: ps.text });
    }
    void fc;
  }
  const join = (...ps) => (`/${ps.filter(Boolean).join('/')}`).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  const routes = [];
  const roles = {};
  const depStep = (file, name, where) => {
    const id = fileCtx(file).resolveName(name.split('.').pop()) || null;
    const role = AUTH.test(name) ? 'auth' : 'dependency';
    if (id) roles[id] ??= role;
    return { role, id: kinds.has(id) ? id : null, label: `Depends(${name})`, about: where, file, line: 0 };
  };
  const seenC = new Set();
  function walkC(key, prefix, before, deps, errors, depth = 0, flags = null) {
    const c = containers[key];
    if (!c || depth > 6) return;
    seenC.add(key);
    const pre = join(prefix, c.kind === 'router' ? c.prefix : '');
    const mws = [...before, ...c.ext, ...c.mws];
    const allDeps = [...deps, ...(c.deps || []).map((n) => depStep(c.file, n, 'зависимость всего роутера'))];
    const errs = [...c.errors, ...errors];
    for (const r of c.routes) {
      const chain = mws.map((x) => ({ ...x }));
      for (const n of r.deps) chain.push(depStep(r.file, n, 'зависимость маршрута'));
      chain.push(...allDeps.map((x) => ({ ...x })));
      for (const p of r.plain) {
        const id = fileCtx(r.file).resolveName((p.method || '').split('.').pop());
        const role = AUTH.test(p.text) ? 'auth' : /valid|schema/i.test(p.text) ? 'validate' : 'middleware';
        chain.push({ role, id: kinds.has(id) ? id : null, label: p.text.replace(/^@/, ''), about: 'декоратор обработчика', file: r.file, line: r.line });
        if (id) roles[id] ??= role;
      }
      for (const p of r.params) {
        if (p.dep) { chain.push(depStep(r.file, p.dep, `параметр ${p.name}`)); continue; }
        const t = (p.type || '').replace(/["']/g, '').split(/[[\]|, ]/).map((w) => w.trim()).filter(Boolean);
        const ent = t.map((w) => byModel[w]).find(Boolean);
        if (ent && entAll[ent]?.orm === 'pydantic') chain.push({ role: 'validate', id: ent, label: `${p.name}: ${p.type}`, about: c.fw === 'fastapi' ? 'FastAPI проверяет тело запроса по этой схеме; при ошибке — ответ 422' : 'данные запроса по схеме', file: r.file, line: r.line });
      }
      chain.push({ role: 'handler', id: r.id, label: '', file: r.file, line: r.line });
      roles[r.id] = 'controller';
      const builtin = c.fw === 'fastapi'
        ? { role: 'error', id: null, label: 'встроенная обработка FastAPI', about: 'HTTPException → ответ с её кодом; ошибка проверки данных → 422; прочие ошибки → 500' }
        : { role: 'error', id: null, label: 'встроенная обработка Flask', about: 'abort(код) → ответ с этим кодом; прочие ошибки → 500' };
      for (const m of r.methods) {
        routes.push({ ...(flags || {}), id: r.id, method: m, path: join(pre, r.path), fw: c.fw, file: r.file, line: r.line, chain, errors: [...errs, builtin], response: r.responseModel ? { model: byModel[r.responseModel] || null, text: r.responseModel, status: r.status } : null });
      }
    }
    for (const ps of c.passes || []) {
      // register_routers(app): всё, что функция подключает к приложению, — сюда же
      const t = containers[ps.target];
      if (!t) continue;
      const tagged = ps.cond ? mws.map((x) => x) : mws;
      walkC(ps.target, pre, tagged, allDeps, errs, depth + 1, flags);
    }
    for (const inc of c.includes) {
      if (!inc.target) continue;
      const rs = { role: 'router', id: null, label: inc.text, about: `подключён${inc.prefix ? ` по адресу ${join(pre, inc.prefix)}` : ''}${inc.loop ? ` (в цикле по списку, переменная ${inc.loop})` : ''}`, file: inc.file, line: inc.line, cond: inc.cond || '' };
      walkC(inc.target, join(pre, inc.prefix), [...mws, rs], [...allDeps, ...inc.deps.map((n) => depStep(inc.file, n, 'зависимость подключения'))], errs, depth + 1, flags);
    }
    for (const x of c.mws) if (x.id) roles[x.id] ??= x.role;
    for (const x of c.errors) if (x.id) roles[x.id] = 'error';
  }
  for (const [key, c] of Object.entries(containers)) if (c.kind === 'app') walkC(key, '', [], [], []);
  // роутеры, подключённые «непонятно как» (app.include_router(module.router) в цикле):
  // если такое подключение в приложении одно — считаем, что они подключены к нему
  const vague = Object.values(containers).filter((c) => c.kind === 'app' && c.includes.some((i) => !i.target));
  for (const [key, c] of Object.entries(containers)) {
    if (seenC.has(key) || !c.routes.length) continue;
    const app = vague.length === 1 && vague[0].fw === c.fw ? vague[0] : null;
    if (app) {
      const inc = app.includes.find((i) => !i.target);
      const rs = { role: 'router', id: null, label: `${c.name} · ${c.file}`, about: `подключён к приложению (${inc.text})`, file: inc.file, line: inc.line };
      walkC(key, '', [...app.ext, ...app.mws, rs], [], app.errors, 0, {
        guess: true,
        reason: `Подключение найдено предположительно: в ${inc.file}:${inc.line} стоит ${c.fw === 'flask' ? 'register_blueprint' : 'include_router'}(${inc.text}), и по коду не видно, какой роутер туда попадает. Префикс адреса, если он задан там, не показан.`,
      });
    } else {
      walkC(key, '', [], [], [], 0, {
        incomplete: true,
        reason: vague.length
          ? `Возможно, он подключается здесь: ${vague.flatMap((a) => a.includes.filter((i) => !i.target).map((i) => `${i.file}:${i.line} (${i.text})`)).join('; ')} — но таких мест несколько, и по коду не понять, какое.`
          : 'В коде не нашлось места, где этот роутер подключается к приложению.',
      });
    }
  }
  return { sites: out, entities, promote, web: { routes, roles } };
}

const HTTPM_PY = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'websocket', 'api_route', 'route']);
const KNOWN_PY = {
  CORSMiddleware: 'разрешает запросы с других сайтов (CORS)',
  GZipMiddleware: 'сжимает ответ',
  TrustedHostMiddleware: 'пускает запросы только к разрешённым адресам',
  HTTPSRedirectMiddleware: 'перенаправляет на https',
  SessionMiddleware: 'хранит сессию пользователя',
};


export { collapse };
