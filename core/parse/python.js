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

// Факты для графа: импорты, имена верхнего уровня, экземпляры, вызовы.
// Собираем сразу, пока дерево живо, и храним как простые объекты.
function collectFacts(root) {
  const imports = {}; // локальное имя → { module, name|null, level }
  const instances = {}; // имя переменной → имя класса (уровень модуля)
  const classes = {}; // имя класса → [методы]
  const selfAttrs = {}; // self.x = Cls(...)/param:Cls → { attr: Cls }
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
      const left = field(a, 'left'), right = field(a, 'right');
      if (left?.type === 'identifier' && right?.type === 'call' && field(right, 'function')?.type === 'identifier') {
        instances[left.text] = field(right, 'function').text;
      }
    }
    const u = n.type === 'decorated_definition' ? field(n, 'definition') : n;
    if (u && (u.type === 'function_definition' || u.type === 'class_definition')) top.add(field(u, 'name').text);
    if (u?.type === 'class_definition') {
      const cname = field(u, 'name').text;
      classes[cname] = [];
      for (const m of field(u, 'body')?.namedChildren || []) {
        const d = m.type === 'decorated_definition' ? field(m, 'definition') : m;
        if (d?.type === 'function_definition') {
          classes[cname].push(field(d, 'name').text);
          // self.x = ... внутри любых методов
          for (const s of walk(d)) {
            if (s.type !== 'assignment') continue;
            const l = field(s, 'left'), r = field(s, 'right');
            if (l?.type !== 'attribute' || field(l, 'object')?.text !== 'self') continue;
            const attr = field(l, 'attribute').text;
            if (r?.type === 'call' && field(r, 'function')?.type === 'identifier') selfAttrs[attr] = { ctor: field(r, 'function').text };
            else if (r?.type === 'identifier') selfAttrs[attr] = { param: r.text, method: field(d, 'name').text, cls: cname };
          }
        }
      }
    }
  }

  // вызовы по каждой функции/методу
  const calls = {}; // имя (как в items) → [{ kind, ... }]
  const params = {}; // имя → { параметр: аннотация-текст }
  function scan(def, qual, cls) {
    const list = [];
    const p = {};
    for (const prm of field(def, 'parameters')?.namedChildren || []) {
      const nm = field(prm, 'name') || (prm.type === 'typed_parameter' ? prm.namedChild(0) : null);
      const typ = field(prm, 'type');
      if (nm && typ) p[nm.text] = typ.text;
      const val = field(prm, 'value');
      if (val?.type === 'call' && field(val, 'function')?.text === 'Depends') {
        const arg = field(val, 'arguments')?.namedChild(0);
        if (arg?.type === 'identifier') list.push({ t: 'name', name: arg.text });
      }
    }
    params[qual] = p;
    for (const c of walk(field(def, 'body'))) {
      if (c.type !== 'call') continue;
      const f = field(c, 'function');
      if (f?.type === 'identifier') list.push({ t: 'name', name: f.text });
      else if (f?.type === 'attribute') {
        const obj = field(f, 'object'), attr = field(f, 'attribute').text;
        if (obj.type === 'identifier') list.push({ t: 'attr', obj: obj.text, attr, cls });
        else if (obj.type === 'attribute') list.push({ t: 'attr2', base: field(obj, 'object').text, mid: field(obj, 'attribute').text, attr, cls });
      }
    }
    calls[qual] = list;
  }
  for (const n of root.namedChildren) {
    const d = n.type === 'decorated_definition' ? field(n, 'definition') : n;
    if (d?.type === 'function_definition') scan(d, field(d, 'name').text, null);
    if (d?.type === 'class_definition') {
      const cname = field(d, 'name').text;
      for (const m of field(d, 'body')?.namedChildren || []) {
        const md = m.type === 'decorated_definition' ? field(m, 'definition') : m;
        if (md?.type === 'function_definition') scan(md, `${cname}.${field(md, 'name').text}`, cname);
      }
    }
  }
  return { imports, instances, classes, selfAttrs, top: [...top], calls, params };
}

// ---- граф вызовов для всех Python-файлов проекта ----

function moduleName(file) {
  let m = file.replace(/\.py$/, '').replace(/\//g, '.');
  if (m.endsWith('.__init__')) m = m.slice(0, -'.__init__'.length);
  return m;
}

export function pythonEdges(pyFiles, itemIds) {
  // pyFiles: { file → facts }
  const modToFile = {};
  for (const f of Object.keys(pyFiles)) {
    const m = moduleName(f);
    modToFile[m] = f;
    if (m.startsWith('src.')) modToFile[m.slice(4)] ??= f;
  }
  const classFile = {};
  const classMethods = {};
  const instances = {};
  for (const [f, facts] of Object.entries(pyFiles)) {
    for (const [c, ms] of Object.entries(facts.classes)) { classFile[c] ??= f; classMethods[c] ??= new Set(ms); }
  }
  for (const facts of Object.values(pyFiles)) {
    for (const [v, c] of Object.entries(facts.instances)) if (classFile[c]) instances[v] ??= c;
    for (const [a, s] of Object.entries(facts.selfAttrs)) if (s.ctor && classFile[s.ctor]) instances[a] ??= s.ctor;
  }
  const annClass = (ann) => (ann ? (ann.match(/[A-Za-z_]\w*/g) || []).find((w) => classFile[w]) : null);
  for (const facts of Object.values(pyFiles)) {
    for (const [a, s] of Object.entries(facts.selfAttrs)) {
      if (!s.param) continue;
      const c = annClass(facts.params[`${s.cls}.${s.method}`]?.[s.param]);
      if (c) instances[a] ??= c;
    }
  }

  const edges = new Set();
  for (const [file, facts] of Object.entries(pyFiles)) {
    const pkg = moduleName(file).split('.').slice(0, file.endsWith('__init__.py') ? undefined : -1);
    const resolveModule = (imp) => {
      if (!imp.level) return imp.module;
      const base = pkg.slice(0, pkg.length - (imp.level - 1));
      return [...base, ...(imp.module ? [imp.module] : [])].join('.');
    };
    const resolveName = (name) => {
      if (facts.top.includes(name)) return `${file}::${name}`;
      const imp = facts.imports[name];
      if (imp && imp.name) {
        const mod = resolveModule(imp);
        const f = modToFile[mod];
        if (f) return `${f}::${imp.name}`;
      }
      return null;
    };
    const moduleOf = (name) => {
      const imp = facts.imports[name];
      if (!imp) return null;
      const mod = resolveModule(imp);
      if (imp.name === null) return modToFile[mod] || null;
      return modToFile[`${mod}.${imp.name}`] || null; // from core import db
    };
    const method = (cls, attr) => (cls && classMethods[cls]?.has(attr) ? `${classFile[cls]}::${cls}.${attr}` : null);

    for (const [qual, list] of Object.entries(facts.calls)) {
      const src = `${file}::${qual}`;
      const local = {};
      for (const [p, ann] of Object.entries(facts.params[qual] || {})) { const c = annClass(ann); if (c) local[p] = c; }
      for (const c of list) {
        let tgt = null;
        if (c.t === 'name') tgt = resolveName(c.name);
        else if (c.t === 'attr') {
          if (c.obj === 'self') tgt = method(c.cls, c.attr);
          else if (local[c.obj] || instances[c.obj]) tgt = method(local[c.obj] || instances[c.obj], c.attr);
          else { const mf = moduleOf(c.obj); if (mf) tgt = `${mf}::${c.attr}`; }
        } else if (c.t === 'attr2') {
          tgt = method(instances[c.mid], c.attr);
        }
        if (tgt && tgt !== src && itemIds.has(tgt)) edges.add(`${src}\u0000${tgt}`);
      }
    }
  }
  return [...edges].map((e) => e.split('\u0000'));
}

export { collapse };
