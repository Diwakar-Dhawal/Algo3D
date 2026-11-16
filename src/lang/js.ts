import { lexLike, matchBracket, render, splitTop, type Tok } from './lex';
import { Out } from './out';
import { TranslateError, type Translated } from './types';

type Types = Map<string, string>;

const UNSUPPORTED = new Set([
  'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every', 'sort', 'join', 'concat', 'splice',
  'shift', 'unshift', 'keys', 'values', 'entries', 'setTimeout', 'fetch',
]);

function endOfStatement(toks: Tok[], from: number): number {
  let depth = 0;
  for (let i = from; i < toks.length; i++) {
    const v = toks[i].v;
    if (v === '(' || v === '[' || v === '{') depth++;
    else if (v === ')' || v === ']' || v === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (v === ';' && depth === 0) return i;
  }
  return toks.length - 1;
}

function findTop(toks: Tok[], from: number, to: number, value: string): number {
  let depth = 0;
  for (let i = from; i < to && i < toks.length; i++) {
    const v = toks[i].v;
    if (v === '(' || v === '[' || v === '{') depth++;
    else if (v === ')' || v === ']' || v === '}') depth--;
    else if (depth === 0 && v === value) return i;
  }
  return -1;
}

function isLiteralStart(prev?: Tok): boolean {
  if (!prev) return true;
  if (prev.k === 'op') return ![')', ']', '}'].includes(prev.v);
  return prev.v === 'return' || prev.v === 'case';
}

function arrayElemType(inside: Tok[], types: Types): string {
  const parts = splitTop(inside, ',').filter((p) => p.length);
  for (const part of parts) {
    const first = part[0];
    if (first.v === '[') return 'int';
    if (first.k === 'str') return 'String';
    if (first.k === 'num') return first.v.includes('.') ? 'double' : 'int';
    if (first.k === 'id') {
      const known = types.get(first.v);
      if (known === 'String' || known === 'double' || known === 'boolean') return known;
    }
  }
  return 'int';
}

function inferType(toks: Tok[], types: Types): string {
  if (!toks.length) return 'unknown';
  const first = toks[0];
  const hasStr = toks.some((t) => t.k === 'str' || (t.k === 'id' && types.get(t.v) === 'String'));

  const hasOp = (ops: string[]): boolean => {
    let depth = 0;
    for (const t of toks) {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
      else if (depth === 0 && ops.includes(t.v)) return true;
    }
    return false;
  };

  if (hasOp(['==', '!=', '===', '!==', '<', '>', '<=', '>=', '&&', '||'])) return 'boolean';
  if (hasStr && hasOp(['+'])) return 'String';

  if (first.k === 'str') return 'String';
  if (first.k === 'num') return first.v.includes('.') ? 'double' : 'int';
  if (first.v === 'true' || first.v === 'false') return 'boolean';
  if (first.v === '[') {
    const close = matchBracket(toks, 0);
    const elem = arrayElemType(close > 0 ? toks.slice(1, close) : [], types);
    return `${elem}[]`;
  }
  if (hasOp(['+', '-', '*', '/', '%'])) return 'int';
  if (first.v === 'parseInt' || first.v === 'Number') return 'int';
  if (first.v === 'String') return 'String';
  if (first.v === 'Math') return toks[2]?.v === 'random' ? 'double' : 'int';
  if (first.k === 'id') {
    if (toks[1]?.v === '[') return (types.get(first.v) ?? 'int[]').replace('[]', '');
    if (toks[1]?.v === '(') return types.get(first.v) ?? 'unknown';
    return types.get(first.v) ?? 'unknown';
  }
  return 'unknown';
}

function paramType(name: string, body: Tok[], lists: Set<string>): string {
  if (lists.has(name)) return 'ArrayList<Object>';
  for (let i = 0; i < body.length; i++) {
    if (body[i].v !== name) continue;
    const prev = body[i - 1];
    const next = body[i + 1];
    if (next?.v === '[') return 'int[]';
    if (prev?.v === '.') {
      const member = next?.v ?? '';
      if (member === 'length') return 'int[]';
      if (['charAt', 'substring', 'toUpperCase', 'toLowerCase', 'trim', 'split', 'indexOf', 'slice'].includes(member)) return 'String';
      if (['push', 'pop', 'get', 'size', 'add', 'set'].includes(member)) return 'ArrayList<Object>';
    }
  }
  return 'int';
}

type FnInfo = {
  name: string;
  paren: number;
  close: number;
  bodyOpen: number;
  bodyClose: number;
  ret: string;
  params: { name: string; type: string }[];
};

function scanFunctions(toks: Tok[], lists: Set<string>): Map<number, FnInfo> {
  const map = new Map<number, FnInfo>();
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.v === '{') {
      depth++;
      continue;
    }
    if (t.v === '}') {
      depth--;
      continue;
    }
    if (t.v !== 'function') continue;
    if (depth > 0) throw new TranslateError('Nested functions are not supported — move it to the top level.', t.line);
    const nameTok = toks[i + 1];
    if (nameTok?.k !== 'id') throw new TranslateError('Anonymous functions are not supported — give it a name.', t.line);
    const paren = i + 2;
    const close = matchBracket(toks, paren);
    if (close < 0) throw new TranslateError('This parameter list could not be read.', t.line);
    const bodyOpen = close + 1;
    const bodyClose = matchBracket(toks, bodyOpen);
    if (toks[bodyOpen]?.v !== '{' || bodyClose < 0) throw new TranslateError('This function needs a { } body.', t.line);
    const body = toks.slice(bodyOpen + 1, bodyClose);
    const params = splitTop(toks.slice(paren + 1, close), ',')
      .filter((p) => p.length)
      .map((p) => ({ name: p[0].v, type: paramType(p[0].v, body, lists) }));
    map.set(i, { name: nameTok.v, paren, close, bodyOpen, bodyClose, ret: 'void', params });
  }
  return map;
}

function resolveReturns(fns: Map<number, FnInfo>, toks: Tok[]): void {
  const known: Types = new Map();
  for (const f of fns.values()) for (const p of f.params) known.set(p.name, p.type);

  for (const f of fns.values()) {
    const body = toks.slice(f.bodyOpen + 1, f.bodyClose);
    const scope: Types = new Map(known);
    let ret = 'void';
    for (let i = 0; i < body.length; i++) {
      if (body[i].v !== 'return') continue;
      let j = i + 1;
      let depth = 0;
      const expr: Tok[] = [];
      while (j < body.length) {
        const x = body[j];
        if (depth === 0 && (x.v === ';' || x.v === '}')) break;
        if (x.v === '(' || x.v === '[' || x.v === '{') depth++;
        if (x.v === ')' || x.v === ']' || x.v === '}') depth--;
        expr.push(x);
        j++;
      }
      if (expr.length) {
        const type = inferType(expr, scope);
        if (type !== 'unknown') ret = type;
      }
      break;
    }
    f.ret = ret;
  }
}

function findListVars(toks: Tok[]): Set<string> {
  const lists = new Set<string>();
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].v !== '.' || toks[i - 1].k !== 'id') continue;
    const member = toks[i + 1]?.v;
    if (['push', 'pop', 'shift', 'unshift', 'get', 'size', 'add', 'set'].includes(member ?? '')) lists.add(toks[i - 1].v);
  }
  return lists;
}

function rewriteConsole(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isLog =
      t.v === 'console' && toks[i + 1]?.v === '.' && ['log', 'error', 'warn', 'info'].includes(toks[i + 2]?.v) && toks[i + 3]?.v === '(';
    if (!isLog) {
      out.push(t);
      continue;
    }
    const open = i + 3;
    const close = matchBracket(toks, open);
    if (close < 0) throw new TranslateError('This console.log( ) call is not closed.', t.line);
    const args = splitTop(toks.slice(open + 1, close), ',').filter((arg) => arg.length);
    const line = t.line;
    const push = (v: string) => out.push({ k: 'op', v, line });
    out.push({ k: 'id', v: 'System', line }, { k: 'op', v: '.', line }, { k: 'id', v: 'out', line }, { k: 'op', v: '.', line }, { k: 'id', v: 'println', line }, { k: 'op', v: '(', line });
    args.forEach((arg, index) => {
      if (index) {
        push('+');
        out.push({ k: 'str', v: ' ', line });
        push('+');
      }
      out.push({ k: 'id', v: 'String', line }, { k: 'op', v: '.', line }, { k: 'id', v: 'valueOf', line }, { k: 'op', v: '(', line });
      out.push(...arg);
      push(')');
    });
    push(')');
    i = close;
  }
  return out;
}

export function jsToJava(source: string): Translated {
  const raw = lexLike(source);
  for (const t of raw) if (t.tmpl) throw new TranslateError('Template literals are not supported — use "text " + value.', t.line);

  const toks = rewriteConsole(raw);
  const lists = findListVars(toks);
  const fns = scanFunctions(toks, lists);
  resolveReturns(fns, toks);

  const types: Types = new Map();
  for (const f of fns.values()) types.set(f.name, f.ret);
  const out = new Out();
  const firstLine = toks[0]?.line ?? 1;
  const lastLine = toks[toks.length - 1]?.line ?? firstLine;
  const closers: string[] = [];

  const ranges = [...fns.entries()].map(([start, f]) => [start, f.bodyClose] as [number, number]);
  const insideFunction = (index: number) => ranges.some(([from, to]) => index >= from && index <= to);
  let mainFrom = 0;
  while (mainFrom < toks.length && insideFunction(mainFrom)) mainFrom++;
  let mainOpen = false;

  out.line('class Main {', firstLine);

  const emitFlat = (list: Tok[], fallback: number): void => {
    for (const t of list) out.write(render(t), t.line || fallback);
  };

  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];

    if (!mainOpen && i >= mainFrom) {
      out.line('public static void main() {', t.line);
      mainOpen = true;
    }

    const fn = fns.get(i);
    if (fn) {
      if (mainOpen) throw new TranslateError('Define all functions above the top-level code.', t.line);
      out.write('static', t.line);
      out.write(fn.ret, t.line);
      out.write(fn.name, t.line);
      out.write('(', t.line);
      fn.params.forEach((p, index) => {
        if (index) out.write(',', t.line);
        out.write(p.type, t.line);
        out.write(p.name, t.line);
      });
      out.write(')', t.line);
      for (const p of fn.params) types.set(p.name, p.type);
      i = fn.close + 1;
      continue;
    }

    if (t.v === 'function') throw new TranslateError('Anonymous functions are not supported.', t.line);
    if (t.v === 'class' || t.v === 'extends') {
      throw new TranslateError('Classes are not supported in JavaScript mode — use functions and arrays.', t.line);
    }
    if (['try', 'catch', 'switch', 'do', 'throw', 'async', 'await', 'typeof', 'yield', 'import', 'export'].includes(t.v)) {
      throw new TranslateError(`\`${t.v}\` is not supported in the visualizer.`, t.line);
    }
    if (t.v === '**') throw new TranslateError('The ** operator is not supported — use Math.pow().', t.line);

    if (t.v === 'for') {
      const close = matchBracket(toks, i + 1);
      const header = toks.slice(i + 2, close);
      const ofAt = header.findIndex((x) => x.v === 'of' || x.v === 'in');
      if (ofAt >= 0) {
        // for (const x of items) → an index loop over the same array
        const name = header.slice(0, ofAt).find((x) => x.k === 'id' && !['let', 'const', 'var'].includes(x.v))?.v;
        const iterable = header.slice(ofAt + 1);
        if (!name || !iterable.length) throw new TranslateError('This for…of loop could not be read.', t.line);
        if (toks[close + 1]?.v !== '{') throw new TranslateError('Wrap the for…of body in { }.', t.line);
        const source = iterable.map(render).join(' ');
        const sourceType = inferType(iterable, types);
        const list = sourceType === 'ArrayList<Object>';
        const tmp = `__i${t.line}`;
        out.write('for', t.line);
        out.write('(', t.line);
        out.write(`var ${tmp} = 0`, t.line);
        out.write(';', t.line);
        out.write(`${tmp} < ${list ? `${source}.size()` : `${source}.length`}`, t.line);
        out.write(';', t.line);
        out.write(`${tmp}++`, t.line);
        out.write(')', t.line);
        out.write('{', t.line);
        out.write(`var ${name} = ${list ? `${source}.get(${tmp})` : `${source}[${tmp}]`}`, t.line);
        out.write(';', t.line);
        types.set(name, list ? 'int' : sourceType.endsWith('[]') ? sourceType.slice(0, -2) : 'int');
        i = close + 2; // the original `{` is ours
        continue;
      }
    }

    if (t.v === 'let' || t.v === 'const' || t.v === 'var') {
      const nameTok = toks[i + 1];
      if (nameTok?.k !== 'id') throw new TranslateError('Expected a variable name.', t.line);
      const end = endOfStatement(toks, i + 1);
      const eq = findTop(toks, i + 1, end, '=');
      const rhs = eq >= 0 ? toks.slice(eq + 1, end) : [];

      const listDecl = (elements: Tok[][]) => {
        out.write('var', t.line);
        out.write(nameTok.v, t.line);
        out.write('=', t.line);
        out.write('new', t.line);
        out.write('ArrayList', t.line);
        out.write('<', t.line);
        out.write('>', t.line);
        out.write('(', t.line);
        out.write(')', t.line);
        out.write(';', t.line);
        for (const part of elements) {
          if (!part.length) continue;
          out.write(nameTok.v, t.line);
          out.write('.add', t.line);
          out.write('(', t.line);
          emitFlat(part, t.line);
          out.write(')', t.line);
          out.write(';', t.line);
        }
        types.set(nameTok.v, 'ArrayList<Object>');
        i = end + 1;
      };

      if (eq >= 0 && rhs.length && rhs[0].v === '[' && lists.has(nameTok.v) && matchBracket(rhs, 0) > 0) {
        const close = matchBracket(rhs, 0);
        listDecl(splitTop(rhs.slice(1, close), ','));
        continue;
      }

      out.write('var', t.line);
      types.set(nameTok.v, inferType(rhs, types));
      i++;
      continue;
    }

    if (t.v === '[' && isLiteralStart(prev)) {
      const close = matchBracket(toks, i);
      if (close < 0) throw new TranslateError('This array literal is not closed.', t.line);
      out.write('new', t.line);
      out.write(arrayElemType(toks.slice(i + 1, close), types), t.line);
      out.write('[]', t.line);
      out.write('{', t.line);
      closers.push('}');
      i++;
      continue;
    }
    if (t.v === ']') {
      if (closers.length && closers[closers.length - 1] === '}') {
        closers.pop();
        out.write('}', t.line);
        i++;
        continue;
      }
      out.write(']', t.line);
      i++;
      continue;
    }

    const isList = types.get(t.v) === 'ArrayList<Object>' || lists.has(t.v);

    if (t.k === 'id' && next?.v === '[' && isList) {
      const close = matchBracket(toks, i + 1);
      const after = toks[close + 1];
      if (after && ['=', '+=', '-=', '*=', '/='].includes(after.v)) {
        if (after.v !== '=') throw new TranslateError('Compound assignment on a list index is not supported — read it, change it, write it back.', t.line);
        const end = endOfStatement(toks, close + 1);
        out.write(t.v, t.line);
        out.write('.set', t.line);
        out.write('(', t.line);
        emitFlat(toks.slice(i + 2, close), t.line);
        out.write(',', t.line);
        emitFlat(toks.slice(close + 2, end), t.line);
        out.write(')', t.line);
        out.write(';', t.line);
        i = end + 1;
        continue;
      }
      out.write(t.v, t.line);
      out.write('.get', t.line);
      out.write('(', t.line);
      emitFlat(toks.slice(i + 2, close), t.line);
      out.write(')', t.line);
      i = close + 1;
      continue;
    }

    if (t.k === 'id' && next?.v === '.') {
      const member = toks[i + 2]?.v ?? '';
      const open = i + 3;
      const close = toks[open]?.v === '(' ? matchBracket(toks, open) : -1;

      if (isList && member === 'push' && close > 0) {
        out.write(t.v, t.line);
        out.write('.add', t.line);
        out.write('(', t.line);
        emitFlat(toks.slice(open + 1, close), t.line);
        out.write(')', t.line);
        i = close + 1;
        continue;
      }
      if (isList && member === 'pop' && close > 0) {
        out.write(t.v, t.line);
        out.write('.remove', t.line);
        out.write('(', t.line);
        out.write(t.v, t.line);
        out.write('.size', t.line);
        out.write('(', t.line);
        out.write(')', t.line);
        out.write('-', t.line);
        out.write('1', t.line);
        out.write(')', t.line);
        i = close + 1;
        continue;
      }
      if (isList && member === 'length' && close < 0) {
        out.write(t.v, t.line);
        out.write('.size', t.line);
        out.write('(', t.line);
        out.write(')', t.line);
        i += 3;
        continue;
      }
      if (types.get(t.v) === 'String' && member === 'length' && close < 0) {
        out.write(t.v, t.line);
        out.write('.length', t.line);
        out.write('(', t.line);
        out.write(')', t.line);
        i += 3;
        continue;
      }
      if (member === 'slice' && close > 0) {
        out.write(t.v, t.line);
        out.write('.', t.line);
        out.write('substring', t.line);
        out.write('(', t.line);
        emitFlat(toks.slice(open + 1, close), t.line);
        out.write(')', t.line);
        i = close + 1;
        continue;
      }
      if (member === 'includes' && close > 0 && types.get(t.v) === 'String') {
        out.write(t.v, t.line);
        out.write('.', t.line);
        out.write('contains', t.line);
        out.write('(', t.line);
        emitFlat(toks.slice(open + 1, close), t.line);
        out.write(')', t.line);
        i = close + 1;
        continue;
      }
      if (UNSUPPORTED.has(member)) throw new TranslateError(`${member}() is not supported in the visualizer.`, t.line);
    }

    if (t.v === 'parseInt' && next?.v === '(') {
      out.write('Integer.parseInt', t.line);
      i++;
      continue;
    }
    if (t.v === 'String' && next?.v === '(') {
      out.write('String.valueOf', t.line);
      i++;
      continue;
    }
    if (t.v === 'String' && next?.v === '.' && toks[i + 2]?.v === 'valueOf' && toks[i + 3]?.v === '(') {
      const close = matchBracket(toks, i + 3);
      const arg = toks.slice(i + 4, close);
      const type = arg.length === 1 && arg[0].k === 'id' ? types.get(arg[0].v) ?? '' : '';
      if (type.endsWith('[]')) {
        out.write('Arrays.toString', t.line);
        out.write('(', t.line);
        emitFlat(arg, t.line);
        out.write(')', t.line);
        i = close + 1;
        continue;
      }
    }

    if (t.v === 'undefined') {
      out.write('null', t.line);
      i++;
      continue;
    }
    if (t.v === '===') {
      out.write('==', t.line);
      i++;
      continue;
    }
    if (t.v === '!==') {
      out.write('!=', t.line);
      i++;
      continue;
    }

    out.write(render(t), t.line);
    i++;
  }

  if (mainOpen) out.line('}', lastLine);
  else {
    out.line('public static void main() {', lastLine);
    out.line('}', lastLine);
  }
  out.line('}', lastLine);

  return out.done();
}
