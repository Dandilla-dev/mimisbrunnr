// Разбор JavaScript / TypeScript / JSX: функции, стрелочные функции,
// классы и методы, React-компоненты и хуки, вложенные обработчики,
// методы в объектах (createSlice, module.exports), маршруты Express.
import path from 'node:path';
import { parse, field, walk, codeHash, headText, collapse } from './treesitter.js';

const FUNC = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const JSX = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment']);
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'options', 'head']);
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
    ranges.push({ id, start: outer.startIndex, end: outer.endIndex, short: name.split('.').pop() });
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
    add({
      name: nm, kind: 'class', outer: node.parent?.type === 'export_statement' ? node.parent : node,
      sigNode: node, body,
      skipHash: (n) => n.type === 'method_definition' || (n.type === 'field_definition' && FUNC.has(field(n, 'value')?.type)),
    });
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

  function routeCall(call, prefix) {
    const fn = field(call, 'function');
    if (fn?.type !== 'member_expression') return false;
    const method = field(fn, 'property')?.text;
    if (!HTTP.has(method)) return false;
    const args = field(call, 'arguments')?.namedChildren || [];
    const p = strValue(args[0]);
    const handler = args.find((a) => FUNC.has(a.type));
    if (p === null || !handler) return false;
    const nm = `${method.toUpperCase()} ${p}`;
    add({ name: nm, kind: 'route', outer: call, fn: handler, body: field(handler, 'body'), route: `${field(fn, 'object').text}.${method}('${p}')`, sigNode: call });
    visit(field(handler, 'body'), prefix);
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

  visit(root, null);
  const facts = collectFacts(root, ranges, stem);
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
        for (const d of decl.namedChildren) if (d.type === 'variable_declarator' && field(d, 'name')?.type === 'identifier') names.push(field(d, 'name').text);
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

  // ссылки: вызовы, <Компонент/>, обработчики в JSX-атрибутах, this.method()
  const refs = []; // { from: id, t: 'name'|'member'|'this', name, obj }
  const sorted = [...ranges].sort((a, b) => (a.end - a.start) - (b.end - b.start));
  const owner = (node) => sorted.find((r) => r.start <= node.startIndex && node.endIndex <= r.end)?.id || null;
  for (const n of walk(root)) {
    let ref = null;
    if (n.type === 'call_expression' || n.type === 'new_expression') {
      const f = field(n, 'function') || field(n, 'constructor');
      if (f?.type === 'identifier') ref = { t: 'name', name: f.text };
      else if (f?.type === 'member_expression') {
        const o = field(f, 'object'), p = field(f, 'property')?.text;
        if (o?.type === 'this') ref = { t: 'this', name: p };
        else if (o?.type === 'identifier') ref = { t: 'member', obj: o.text, name: p };
      }
    } else if (n.type === 'jsx_opening_element' || n.type === 'jsx_self_closing_element') {
      const nm = field(n, 'name');
      if (nm?.type === 'identifier' && /^[A-Z]/.test(nm.text)) ref = { t: 'name', name: nm.text };
      else if (nm?.type === 'member_expression') ref = { t: 'member', obj: field(nm, 'object').text, name: field(nm, 'property').text };
    } else if (n.type === 'jsx_expression') {
      const e = n.namedChild(0);
      if (e?.type === 'identifier') ref = { t: 'name', name: e.text };
    }
    if (!ref) continue;
    const from = owner(n);
    if (from) refs.push({ from, ...ref });
  }
  return { imports, exportsMap, refs };
}

// ---- граф для всех JS-файлов ----
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

export function jsEdges(jsFiles, itemsByFile, itemIds) {
  const files = new Set(Object.keys(jsFiles));
  const resolveSource = (from, src) => {
    if (!src.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), src));
    for (const e of EXTS) if (files.has(base + e)) return base + e;
    return null;
  };
  const byName = {}; // file → { полное имя → id, короткое имя верхнего уровня → id }
  for (const [f, items] of Object.entries(itemsByFile)) {
    const m = {};
    for (const it of items) m[it.name] = it.id;
    byName[f] = m;
  }
  const exported = (file, name) => {
    const ex = jsFiles[file]?.exportsMap || {};
    const local = name === 'default' ? ex.default : ex[name] || name;
    return local ? byName[file]?.[local] || null : null;
  };

  const edges = new Set();
  for (const [file, facts] of Object.entries(jsFiles)) {
    const names = byName[file] || {};
    for (const r of facts.refs) {
      let tgt = null;
      const fromName = r.from.split('::')[1].replace(/#\d+$/, '');
      if (r.t === 'name') {
        // сначала вложенные в ту же внешнюю функцию, потом верхний уровень файла, потом импорт
        const parts = fromName.split('.');
        for (let i = parts.length; i >= 0 && !tgt; i--) tgt = names[[...parts.slice(0, i), r.name].join('.')] || null;
        if (!tgt && facts.imports[r.name]) {
          const imp = facts.imports[r.name];
          const tf = resolveSource(file, imp.source);
          if (tf) tgt = exported(tf, imp.name === '*' ? 'default' : imp.name);
        }
      } else if (r.t === 'this') {
        const cls = fromName.split('.')[0];
        tgt = names[`${cls}.${r.name}`] || null;
      } else if (r.t === 'member') {
        const imp = facts.imports[r.obj];
        if (imp) {
          const tf = resolveSource(file, imp.source);
          if (tf) tgt = exported(tf, r.name) || byName[tf]?.[`${exported(tf, 'default')?.split('::')[1]}.${r.name}`] || null;
        } else tgt = names[`${r.obj}.${r.name}`] || null; // chatSlice.actions… / объект в том же файле
      }
      if (tgt && tgt !== r.from && itemIds.has(tgt)) edges.add(`${r.from}\u0000${tgt}`);
    }
  }
  return [...edges].map((e) => e.split('\u0000'));
}
