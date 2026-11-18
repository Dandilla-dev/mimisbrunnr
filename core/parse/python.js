// Разбор Python: функции, классы, методы; импорты и вызовы для графа.
import { parse, field, walk, codeHash, headText, collapse } from './treesitter.js';

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
  function add(def, decs, outer, cls) {
    const isClass = def.type === 'class_definition';
    const nameNode = field(def, 'name');
    if (!nameNode) return;
    const name = cls ? `${cls}.${nameNode.text}` : nameNode.text;
    const body = field(def, 'body');
    const id = `${file}::${name}`;
    items.push({
      id, file, name,
      kind: isClass ? 'class' : cls ? 'method' : 'function',
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
  return out;
}

export { collapse };
