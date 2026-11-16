import { Out } from './out';
import { TranslateError, type Translated } from './types';

/* ------------------------------------------------------------------ tokens */

type PTok = { k: 'id' | 'num' | 'str' | 'op'; v: string; line: number; col: number };

const PY_OPS = [
  '**=', '//=', '>>=', '<<=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->',
  '=', '<', '>', '+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '!', '&', '|', '^', '~', '@',
];

function pyTokens(src: string): PTok[] {
  const toks: PTok[] = [];
  let i = 0;
  let line = 1;
  let col = 0;

  const advance = (n: number) => {
    for (let k = 0; k < n && i < src.length; k++) {
      if (src[i] === '\n') {
        line++;
        col = 0;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') {
      advance(1);
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      advance(1);
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      advance(2);
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') advance(1);
      continue;
    }

    if ((c === '"' || c === "'") && src.startsWith(c.repeat(3), i)) {
      const quote = c.repeat(3);
      advance(3);
      while (i < src.length && !src.startsWith(quote, i)) advance(1);
      advance(3);
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      advance(1);
      let text = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          text += src[i] + (src[i + 1] ?? '');
          advance(2);
        } else {
          text += src[i];
          advance(1);
        }
      }
      advance(1);
      toks.push({ k: 'str', v: text, line: startLine, col });
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      const startCol = col;
      while (i < src.length && /[0-9]/.test(src[i])) advance(1);
      if (src[i] === '.') {
        advance(1);
        while (i < src.length && /[0-9]/.test(src[i])) advance(1);
      }
      if (src[i] === 'e' || src[i] === 'E') {
        advance(1);
        if (src[i] === '+' || src[i] === '-') advance(1);
        while (i < src.length && /[0-9]/.test(src[i])) advance(1);
      }
      toks.push({ k: 'num', v: src.slice(start, i), line, col: startCol });
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      const startCol = col;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) advance(1);
      toks.push({ k: 'id', v: src.slice(start, i), line, col: startCol });
      continue;
    }

    let hit = '';
    for (const op of PY_OPS) {
      if (src.startsWith(op, i)) {
        hit = op;
        break;
      }
    }
    if (hit) {
      toks.push({ k: 'op', v: hit, line, col });
      advance(hit.length);
      continue;
    }

    advance(1);
  }

  return toks;
}

type PLine = { indent: number; toks: PTok[]; line: number };

function groupLines(toks: PTok[]): PLine[] {
  const byLine = new Map<number, PTok[]>();
  for (const t of toks) {
    const list = byLine.get(t.line);
    if (list) list.push(t);
    else byLine.set(t.line, [t]);
  }

  const numbers = [...byLine.keys()].sort((a, b) => a - b);
  const lines: PLine[] = [];
  let current: PTok[] = [];
  let startLine = 0;
  let indent = 0;

  const flush = () => {
    if (current.length) lines.push({ indent, toks: current, line: startLine });
    current = [];
  };

  for (const n of numbers) {
    const list = byLine.get(n)!;
    if (!current.length) {
      startLine = n;
      indent = list[0].col;
    }
    current.push(...list);
    let depth = 0;
    for (const t of current) {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
    }
    if (depth <= 0) flush();
  }
  flush();

  const split: PLine[] = [];
  for (const l of lines) {
    let depth = 0;
    let part: PTok[] = [];
    for (const t of l.toks) {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
      if (t.v === ';' && depth === 0) {
        if (part.length) split.push({ indent: l.indent, toks: part, line: l.line });
        part = [];
        continue;
      }
      part.push(t);
    }
    if (part.length) split.push({ indent: l.indent, toks: part, line: l.line });
  }

  return split;
}

type PNode = { line: number; toks: PTok[]; body: PNode[] };

function buildTree(lines: PLine[], index = 0, indent = -1): [PNode[], number] {
  const nodes: PNode[] = [];
  let i = index;
  while (i < lines.length && lines[i].indent > indent) {
    const head = lines[i];
    const node: PNode = { line: head.line, toks: head.toks, body: [] };
    i++;
    if (i < lines.length && lines[i].indent > head.indent) {
      const [body, next] = buildTree(lines, i, head.indent);
      node.body = body;
      i = next;
    }
    nodes.push(node);
  }
  return [nodes, i];
}

function flatten(nodes: PNode[]): PTok[] {
  const out: PTok[] = [];
  for (const n of nodes) {
    out.push(...n.toks);
    out.push(...flatten(n.body));
  }
  return out;
}

function match(toks: PTok[], open: number): number {
  const first = toks[open]?.v;
  const close = first === '(' ? ')' : first === '[' ? ']' : first === '{' ? '}' : '';
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].v === first) depth++;
    else if (toks[i].v === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitCommas(toks: PTok[]): PTok[][] {
  const parts: PTok[][] = [];
  let depth = 0;
  let current: PTok[] = [];
  for (const t of toks) {
    if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
    if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
    if (t.v === ',' && depth === 0) {
      parts.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  parts.push(current);
  return parts;
}

/* ------------------------------------------------------------------- types */

type Vars = Map<string, string>;
type Fns = Map<string, { ret: string }>;
type Ctx = { vars: Vars; fns: Fns; lists: Set<string>; declared: Set<string> };

function isList(type: string | undefined): boolean {
  return type === 'ArrayList<Object>';
}

function elemOf(type: string | undefined): string {
  if (!type) return 'int';
  return type.endsWith('[]') ? type.slice(0, -2) : 'int';
}

function inferType(toks: PTok[], ctx: { vars: Vars; fns: Fns }): string {
  if (!toks.length) return 'unknown';
  const first = toks[0];
  const hasStr = toks.some((t) => t.k === 'str' || (t.k === 'id' && ctx.vars.get(t.v) === 'String'));

  const hasOp = (ops: string[]): boolean => {
    let depth = 0;
    for (const t of toks) {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
      else if (depth === 0 && ops.includes(t.v)) return true;
    }
    return false;
  };

  if (hasOp(['==', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'is'])) return 'boolean';
  if (hasStr && hasOp(['+'])) return 'String';

  if (first.k === 'str') return 'String';
  if (first.k === 'num') return first.v.includes('.') ? 'double' : 'int';
  if (first.v === 'True' || first.v === 'False') return 'boolean';
  if (first.v === '[') return 'int[]';
  if (first.v === 'len' || first.v === 'abs' || first.v === 'int') return 'int';
  if (first.v === 'str') return 'String';
  if (first.v === 'sorted') return 'int[]';
  if (first.v === 'range') return 'unknown';
  if (hasOp(['+', '-', '*', '/', '%'])) return 'int';
  if (first.k === 'id') {
    if (toks[1]?.v === '[') return elemOf(ctx.vars.get(first.v));
    if (toks[1]?.v === '(') return ctx.fns.get(first.v)?.ret ?? 'unknown';
    if (toks[1]?.v === '.') {
      const member = toks[2]?.v ?? '';
      if (member === 'pop' || member === 'find') return 'int';
      if (member === 'upper' || member === 'lower' || member === 'strip') return 'String';
      if (member === 'append' || member === 'insert') return 'unknown';
    }
    return ctx.vars.get(first.v) ?? 'unknown';
  }
  return 'unknown';
}

function paramType(name: string, body: PTok[], vars: Vars, lists: Set<string>): string {
  if (lists.has(name)) return 'ArrayList<Object>';
  for (let i = 0; i < body.length; i++) {
    if (body[i].v !== name) continue;
    const prev = body[i - 1];
    const next = body[i + 1];
    if (next?.v === '[') return 'int[]';
    if (prev?.v === '(' && body[i - 2]?.v === 'len') return 'int[]';
    if (prev?.v === 'in' || body[i - 2]?.v === 'in') return 'int[]';
    if (next?.v === '.') {
      const member = body[i + 2]?.v ?? '';
      if (['upper', 'lower', 'strip', 'find', 'startswith', 'endswith', 'split', 'replace'].includes(member)) return 'String';
    }
  }
  return vars.get(name) ?? 'int';
}

/* -------------------------------------------------------------- expressions */

function quoted(s: PTok): string {
  return `"${s.v}"`;
}

function wrapperFor(type: string, text: string): string {
  if (type.endsWith('[]')) return `Arrays.toString(${text})`;
  if (isList(type)) return `${text}.toString()`;
  return text;
}

function expr(toks: PTok[], ctx: Ctx): string {
  const parts: string[] = [];
  let i = 0;

  const push = (text: string) => parts.push(text);

  const callArgs = (open: number): { args: PTok[][]; close: number } => {
    const close = match(toks, open);
    if (close < 0) throw new TranslateError('This call is not closed.', toks[open].line);
    return { args: splitCommas(toks.slice(open + 1, close)), close };
  };

  while (i < toks.length) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];

    if (t.v === 'not') {
      push('!');
      i++;
      continue;
    }
    if (t.v === 'and') {
      push('&&');
      i++;
      continue;
    }
    if (t.v === 'or') {
      push('||');
      i++;
      continue;
    }
    if (t.v === 'is' && next?.v === 'not') {
      push('!=');
      i += 2;
      continue;
    }
    if (t.v === 'is') {
      push('==');
      i++;
      continue;
    }
    if (t.v === 'in') throw new TranslateError('`in` is only supported in for loops.', t.line);
    if (t.v === 'True' || t.v === 'False') {
      push(t.v === 'True' ? 'true' : 'false');
      i++;
      continue;
    }
    if (t.v === 'None') {
      push('null');
      i++;
      continue;
    }
    if (t.v === '//') {
      push('/');
      i++;
      continue;
    }
    if (t.v === '**') throw new TranslateError('The ** operator is not supported — use a loop or Math.pow().', t.line);
    if ((t.v === 'f' || t.v === 'rf' || t.v === 'fr') && next?.k === 'str') {
      throw new TranslateError('f-strings are not supported — build the text with str() and +.', t.line);
    }

    if (t.k === 'id' && next?.v === '(') {
      const { args, close } = callArgs(i + 1);
      const arg = args.map((a) => expr(a, ctx));

      if (t.v === 'len') {
        const type = inferType(args[0] ?? [], ctx);
        if (type === 'String') push(`${arg[0]}.length()`);
        else if (isList(type)) push(`${arg[0]}.size()`);
        else push(`${arg[0]}.length`);
        i = close + 1;
        continue;
      }
      if (t.v === 'print') {
        const rendered = (args as PTok[][]).map((a, k) => {
          const type = inferType(a, ctx);
          return type.endsWith('[]') || isList(type) ? wrapperFor(type, arg[k]) : `String.valueOf(${arg[k]})`;
        });
        push('System.out.println');
        if (args.length === 1) push(`(${arg[0]})`);
        else if (!args.length) push('()');
        else push(`(${rendered.join(' + " " + ')})`);
        i = close + 1;
        continue;
      }
      if (t.v === 'abs' || t.v === 'min' || t.v === 'max') {
        push(`Math.${t.v}(${arg.join(', ')})`);
        i = close + 1;
        continue;
      }
      if (t.v === 'str') {
        push(`String.valueOf(${arg[0]})`);
        i = close + 1;
        continue;
      }
      if (t.v === 'int' || t.v === 'float' || t.v === 'round') {
        throw new TranslateError(`${t.v}() conversion is not supported — use Integer.parseInt or Math.round.`, t.line);
      }
      if (t.v === 'range') throw new TranslateError('range() is only supported directly inside a for loop.', t.line);
      if (['sorted', 'sum', 'enumerate', 'zip', 'map', 'filter', 'any', 'all'].includes(t.v)) {
        throw new TranslateError(`${t.v}() is not supported in the visualizer.`, t.line);
      }
      if (!ctx.fns.has(t.v)) throw new TranslateError(`Unknown function ${t.v}() — define it with def ${t.v}(...).`, t.line);
      push(`${t.v}(${arg.join(', ')})`);
      i = close + 1;
      continue;
    }

    if (t.k === 'id' && next?.v === '[') {
      const type = ctx.vars.get(t.v);
      const close = match(toks, i + 1);
      if (close < 0) throw new TranslateError('This index is not closed.', t.line);
      if (toks[close + 1]?.v === ':') throw new TranslateError('Slicing is not supported.', t.line);
      const index = expr(toks.slice(i + 2, close), ctx);
      if (isList(type)) push(`${t.v}.get(${index})`);
      else push(`${t.v}[${index}]`);
      i = close + 1;
      continue;
    }

    if (t.v === '[' && (prev?.k === 'op' || !prev)) {
      const close = match(toks, i);
      if (close < 0) throw new TranslateError('This list is not closed.', t.line);
      const items = splitCommas(toks.slice(i + 1, close)).filter((p) => p.length);
      const base = inferType(items[0] ?? [], ctx) === 'String' ? 'String' : 'int';
      push(`new ${base}[]{${items.map((item) => expr(item, ctx)).join(', ')}}`);
      i = close + 1;
      continue;
    }

    if (t.v === '.') {
      const member = next?.v ?? '';
      const mapped: Record<string, string> = {
        upper: 'toUpperCase',
        lower: 'toLowerCase',
        strip: 'trim',
        find: 'indexOf',
        append: 'add',
        insert: 'add',
      };

      if (member === 'pop') {
        const close = toks[i + 2]?.v === '(' ? match(toks, i + 2) : -1;
        if (close < 0) throw new TranslateError('pop( ) needs parentheses here.', t.line);
        const inside = toks.slice(i + 3, close);
        if (inside.length) push(`.remove(${expr(inside, ctx)})`);
        else push(`.remove(${prev?.v}.size() - 1)`);
        i = close + 1;
        continue;
      }
      if (member === 'sort' || member === 'reverse' || member === 'copy' || member === 'extend' || member === 'index') {
        throw new TranslateError(`${member}() is not supported — write the loop yourself.`, t.line);
      }
      if (member === 'startswith' || member === 'endswith' || member === 'replace' || member === 'split') {
        throw new TranslateError(`${member}() is not supported — compare characters in a loop instead.`, t.line);
      }
      if (mapped[member]) {
        push(`.${mapped[member]}`);
        i += 2;
        continue;
      }
    }

    if (t.k === 'str') {
      push(quoted(t));
      i++;
      continue;
    }
    if (t.v === '{' || t.v === '}') throw new TranslateError('Dictionaries and sets are not supported.', t.line);

    push(t.v);
    i++;
  }

  return parts.filter(Boolean).join(' ');
}

/* --------------------------------------------------------------- statements */

function lineEnd(toks: PTok[], from: number): number {
  const target = toks[from]?.line ?? 0;
  let i = from;
  while (i < toks.length && toks[i].line === target) i++;
  return i;
}

function collectVars(nodes: PNode[], vars: Vars, fns: Fns, lists: Set<string>): void {
  for (const node of nodes) {
    const toks = node.toks;
    if (toks[0]?.v === 'for') {
      const inAt = toks.findIndex((t) => t.v === 'in');
      if (inAt > 1) {
        for (const target of splitCommas(toks.slice(1, inAt))) {
          const name = target[0]?.v;
          if (name) vars.set(name, 'int');
        }
      }
    }
    if (toks[0]?.k === 'id' && ['=', '+=', '-=', '*=', '/='].includes(toks[1]?.v ?? '')) {
      const name = toks[0].v;
      if (lists.has(name)) vars.set(name, 'ArrayList<Object>');
      else if (toks[1].v === '=') vars.set(name, inferType(toks.slice(2), { vars, fns }));
      else if (!vars.has(name)) vars.set(name, 'int');
    }
    collectVars(node.body, vars, fns, lists);
  }
}

function findLists(nodes: PNode[]): Set<string> {
  const lists = new Set<string>();
  const toks = flatten(nodes);
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].v !== '.' || toks[i - 1].k !== 'id') continue;
    if (['append', 'pop', 'insert', 'extend'].includes(toks[i + 1]?.v ?? '')) lists.add(toks[i - 1].v);
  }
  return lists;
}

/** truthiness of a bare name, the way Python's `if nums:` means "not empty" */
function truthyOf(tok: PTok, ctx: Ctx): string | null {
  if (tok.k !== 'id') return null;
  const type = ctx.vars.get(tok.v);
  if (!type || type === 'boolean' || type === 'unknown') return null;
  if (type.endsWith('[]')) return `${tok.v} != null && ${tok.v}.length > 0`;
  if (isList(type)) return `${tok.v}.size() > 0`;
  if (type === 'String') return `${tok.v}.length() > 0`;
  if (type === 'int' || type === 'double') return `${tok.v} != 0`;
  return null;
}

function condText(toks: PTok[], ctx: Ctx): string {
  if (!toks.length) return 'true';
  if (toks[0]?.v === 'not' && toks.length === 2) {
    const test = truthyOf(toks[1], ctx);
    return test ? `!(${test})` : `!${expr(toks.slice(1), ctx)}`;
  }
  const test = toks.length === 1 ? truthyOf(toks[0], ctx) : null;
  return test ?? expr(toks, ctx);
}

function firstLineOf(nodes: PNode[]): number {
  let line = nodes[0]?.line ?? 1;
  for (const node of nodes) line = Math.min(line, node.line);
  return line;
}

type Emit = { out: Out; ctx: Ctx };

function emitBlock(nodes: PNode[], emit: Emit): void {
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const head = node.toks[0]?.v;

    if (head === 'if') {
      emit.out.line(`if (${condText(node.toks.slice(1, -1), emit.ctx)}) {`, node.line);
      emitBlock(node.body, emit);
      i++;
      while (i < nodes.length && nodes[i].toks[0]?.v === 'elif') {
        const elif = nodes[i];
        emit.out.line(`} else if (${condText(elif.toks.slice(1, -1), emit.ctx)}) {`, elif.line);
        emitBlock(elif.body, emit);
        i++;
      }
      if (i < nodes.length && nodes[i].toks[0]?.v === 'else') {
        emit.out.line('} else {', nodes[i].line);
        emitBlock(nodes[i].body, emit);
        i++;
      }
      emit.out.line('}', node.line);
      continue;
    }

    emitStatement(node, emit);
    i++;
  }
}

function emitStatement(node: PNode, emit: Emit): void {
  const toks = node.toks;
  const head = toks[0]?.v;
  const { out, ctx } = emit;

  if (head === 'for') {
    const inAt = toks.findIndex((t) => t.v === 'in');
    if (inAt < 0) throw new TranslateError('for loops need the form `for x in ...`.', node.line);
    const targets = splitCommas(toks.slice(1, inAt)).map((p) => p[0]?.v).filter(Boolean) as string[];
    const iterable = toks.slice(inAt + 1, -1);
    const iterHead = iterable[0];

    if (iterHead?.v === 'range' && iterable[1]?.v === '(') {
      const close = match(iterable, 1);
      const args = splitCommas(iterable.slice(2, close)).map((a) => expr(a, ctx));
      const name = targets[0] ?? 'i';
      ctx.vars.set(name, 'int');
      ctx.declared.add(name);
      const start = args.length > 1 ? args[0] : '0';
      const stop = args.length > 1 ? args[1] : args[0] ?? '0';
      const step = args.length > 2 ? args[2] : '1';
      const negative = step.trim().startsWith('-');
      const update = step === '1' ? `${name}++` : negative ? `${name} -= ${step.trim().slice(1)}` : `${name} += ${step}`;
      const compare = negative ? `${name} > ${stop}` : `${name} < ${stop}`;
      out.line(`for (var ${name} = ${start}; ${compare}; ${update}) {`, node.line);
      emitBlock(node.body, emit);
      out.line('}', node.line);
      return;
    }

    if (iterHead?.v === 'enumerate' && iterable[1]?.v === '(') {
      const close = match(iterable, 1);
      const sourceToks = iterable.slice(2, close);
      const source = expr(sourceToks, ctx);
      const type = inferType(sourceToks, ctx);
      if (isList(type) || type === 'String') {
        throw new TranslateError('enumerate over this value is not supported — use an index loop.', node.line);
      }
      if (isList(type) || type === 'String') {
        throw new TranslateError('enumerate over this value is not supported — use an index loop.', node.line);
      }
      const index = targets[0] ?? 'i';
      const value = targets[1] ?? 'x';
      ctx.vars.set(index, 'int');
      ctx.vars.set(value, elemOf(type));
      ctx.declared.add(index);
      ctx.declared.add(value);
      const tmp = `__i${node.line}`;
      out.line(`for (var ${tmp} = 0; ${tmp} < ${source}.length; ${tmp}++) {`, node.line);
      out.line(`var ${index} = ${tmp};`, node.line);
      out.line(`var ${value} = ${source}[${tmp}];`, node.line);
      emitBlock(node.body, emit);
      out.line('}', node.line);
      return;
    }

    const source = expr(iterable, ctx);
    const type = inferType(iterable, ctx);
    if (type === 'String') throw new TranslateError('Iterating a string is not supported — use a counted loop.', node.line);
    const asList = isList(type);
    const name = targets[0] ?? 'x';
    ctx.vars.set(name, asList ? 'int' : elemOf(type));
    ctx.declared.add(name);
    const tmp = `__i${node.line}`;
    const size = asList ? `${source}.size()` : `${source}.length`;
    const read = asList ? `${source}.get(${tmp})` : `${source}[${tmp}]`;
    out.line(`for (var ${tmp} = 0; ${tmp} < ${size}; ${tmp}++) {`, node.line);
    out.line(`var ${name} = ${read};`, node.line);
    emitBlock(node.body, emit);
    out.line('}', node.line);
    return;
  }

  if (head === 'while') {
    out.line(`while (${condText(toks.slice(1, -1), ctx)}) {`, node.line);
    emitBlock(node.body, emit);
    out.line('}', node.line);
    return;
  }

  if (head === 'return') {
    const value = toks.slice(1);
    out.write(value.length ? `return ${expr(value, ctx)};` : 'return;', node.line);
    out.brk(node.line);
    return;
  }

  if (head === 'break' || head === 'continue') {
    out.write(`${head};`, node.line);
    out.brk(node.line);
    return;
  }

  if (head === 'pass' || head === 'global' || head === 'nonlocal') return;

  if (head === 'import' || head === 'from') throw new TranslateError('imports are not supported — the visualizer has no library access.', node.line);

  if (head === 'print' && toks[1]?.v === '(') {
    emitPrint(toks, out, ctx);
    return;
  }

  if (['del', 'assert', 'raise', 'with', 'try', 'class', 'lambda', 'yield', 'async', 'await'].includes(head ?? '')) {
    throw new TranslateError(`\`${head}\` is not supported in the visualizer.`, node.line);
  }

  let depth = 0;
  let assignAt = -1;
  for (let i = 0; i < toks.length; i++) {
    const v = toks[i].v;
    if (v === '(' || v === '[' || v === '{') depth++;
    else if (v === ')' || v === ']' || v === '}') depth--;
    else if (depth === 0 && ['=', '+=', '-=', '*=', '/='].includes(v)) {
      assignAt = i;
      break;
    }
  }

  if (assignAt > 0) {
    const target = toks.slice(0, assignAt);
    const value = toks.slice(assignAt + 1);
    const op = toks[assignAt].v;

    if (op === '=' && target.some((t) => t.v === ',')) {
      const names = splitCommas(target).filter((p) => p.length);
      const values = splitCommas(value).filter((p) => p.length);
      if (names.length !== values.length) throw new TranslateError('Unpacking needs one value per name.', node.line);
      const temps = names.map((_, index) => `__t${node.line}_${index}`);
      names.forEach((_, index) => {
        out.write(`var ${temps[index]} = ${expr(values[index], ctx)};`, node.line);
        out.brk(node.line);
      });
      names.forEach((nameToks, index) => {
        if (nameToks[1]?.v === '[') {
          const close = match(nameToks, 1);
          const indexExpr = expr(nameToks.slice(2, close), ctx);
          const type = ctx.vars.get(nameToks[0].v);
          if (isList(type)) out.write(`${nameToks[0].v}.set(${indexExpr}, ${temps[index]});`, node.line);
          else out.write(`${nameToks[0].v}[${indexExpr}] = ${temps[index]};`, node.line);
        } else {
          out.write(`${nameToks[0].v} = ${temps[index]};`, node.line);
        }
        out.brk(node.line);
      });
      return;
    }

    if (target[0]?.k === 'id' && target[1]?.v === '[') {
      const close = match(target, 1);
      const index = expr(target.slice(2, close), ctx);
      const current = expr(value, ctx);
      const type = ctx.vars.get(target[0].v);
      if (isList(type)) {
        if (op !== '=') throw new TranslateError('In-place update of a list item is not supported — read it, change it, write it back.', node.line);
        out.write(`${target[0].v}.set(${index}, ${current});`, node.line);
      } else {
        out.write(`${target[0].v}[${index}] ${op} ${current};`, node.line);
      }
      out.brk(node.line);
      return;
    }

    if (target[0]?.k === 'id' && target[1]?.v === '.') {
      out.write(`${target.map((t) => t.v).join(' ')} ${op} ${expr(value, ctx)};`, node.line);
      out.brk(node.line);
      return;
    }

    const name = target[0]?.v ?? '';
    if (op === '=') {
      const declared = ctx.declared.has(name);
      const wantsList = ctx.lists.has(name) && value[0]?.v === '[';

      if (wantsList) {
        const close = match(value, 0);
        const items = splitCommas(value.slice(1, close)).filter((p) => p.length);
        out.write(`${declared ? '' : 'var '}${name} = new ArrayList<>();`, node.line);
        out.brk(node.line);
        for (const item of items) {
          out.write(`${name}.add(${expr(item, ctx)});`, node.line);
          out.brk(node.line);
        }
        ctx.vars.set(name, 'ArrayList<Object>');
        ctx.declared.add(name);
        return;
      }

      const type = inferType(value, ctx);
      out.write(`${declared ? '' : 'var '}${name} = ${expr(value, ctx)};`, node.line);
      out.brk(node.line);
      ctx.declared.add(name);
      if (type !== 'unknown') ctx.vars.set(name, type);
      return;
    }

    out.write(`${name} ${op} ${expr(value, ctx)};`, node.line);
    out.brk(node.line);
    return;
  }

  out.write(`${expr(toks, ctx)};`, node.line);
  out.brk(node.line);
}

function emitPrint(toks: PTok[], out: Out, ctx: Ctx): void {
  const open = toks.findIndex((t) => t.v === '(');
  const close = match(toks, open);
  const args = splitCommas(toks.slice(open + 1, close));
  const line = toks[0].line;

  let end: string | null = null;
  const values: PTok[][] = [];
  for (const arg of args) {
    if (!arg.length) continue;
    if (arg[0]?.v === 'end' && arg[1]?.v === '=') {
      end = expr(arg.slice(2), ctx);
      continue;
    }
    if (arg[0]?.v === 'sep' && arg[1]?.v === '=') continue;
    values.push(arg);
  }

  const pieces = values.map((value) => {
    const text = expr(value, ctx);
    const type = inferType(value, ctx);
    if (type.endsWith('[]') || isList(type)) return wrapperFor(type, text);
    return values.length > 1 ? `String.valueOf(${text})` : text;
  });

  if (end !== null) {
    out.write(`System.out.print(${pieces.length ? `${pieces.join(' + " " + ')} + ${end}` : end});`, line);
  } else {
    out.write(`System.out.println(${pieces.join(' + " " + ')});`, line);
  }
  out.brk(line);
}

/* ------------------------------------------------------------------ program */

export function pythonToJava(source: string): Translated {
  const lines = groupLines(pyTokens(source));
  const [tree] = buildTree(lines);

  const fns: Fns = new Map();
  const defs: { node: PNode; name: string; params: string[]; body: PNode[]; ret: string; vars: Vars }[] = [];
  const moduleNodes: PNode[] = [];

  const take = (nodes: PNode[]): void => {
    for (const node of nodes) {
      const head = node.toks[0]?.v;
      if (head === 'def') {
        const name = node.toks[1]?.v ?? '';
        const open = node.toks.findIndex((t) => t.v === '(');
        const close = match(node.toks, open);
        const params = splitCommas(node.toks.slice(open + 1, close))
          .map((p) => p[0]?.v)
          .filter((p): p is string => !!p && p !== 'self');
        defs.push({ node, name, params, body: node.body, ret: 'void', vars: new Map() });
        fns.set(name, { ret: 'void' });
        continue;
      }
      if (head === 'class') {
        // LeetCode style: `class Solution:` is only a wrapper for its methods
        if (node.body.some((child) => child.toks[0]?.v !== 'def')) {
          throw new TranslateError('A class may only wrap methods here — fields and objects are not supported.', node.line);
        }
        take(node.body);
        continue;
      }
      if (head === 'if' && node.toks.some((t) => t.v === '__name__')) {
        moduleNodes.push(...node.body);
        continue;
      }
      moduleNodes.push(node);
    }
  };
  take(tree);

  if (!moduleNodes.length) {
    const method = defs[0]?.name ?? 'your function';
    throw new TranslateError(
      `This file only defines ${method}() — nothing calls it. Add a call at the bottom, e.g. nums = [1, 1, 2] and print(${method}(nums)).`,
      firstLineOf(tree)
    );
  }

  const lists = findLists([...defs.map((d) => ({ line: d.node.line, toks: d.node.toks, body: d.body })), ...moduleNodes]);

  for (const def of defs) {
    const vars: Vars = new Map();
    const body = flatten(def.body);
    for (const param of def.params) vars.set(param, paramType(param, body, vars, lists));
    collectVars(def.body, vars, fns, lists);
    def.vars = vars;

    let ret = 'void';
    const returnTok = body.find((t) => t.v === 'return');
    if (returnTok) {
      const from = body.indexOf(returnTok) + 1;
      const valueToks = body.slice(from, lineEnd(body, from));
      if (valueToks.length) {
        const inferred = inferType(valueToks, { vars, fns });
        if (inferred !== 'unknown') ret = inferred;
      }
    }
    def.ret = ret;
    fns.set(def.name, { ret });
  }

  const out = new Out();
  const firstLine = tree[0]?.line ?? 1;
  const lastLine = tree.length ? tree[tree.length - 1].line : firstLine;

  out.line('class Main {', firstLine);

  for (const def of defs) {
    const ctx: Ctx = { vars: def.vars, fns, lists, declared: new Set(def.params) };
    const open = def.node.toks.findIndex((t) => t.v === '(');
    const close = match(def.node.toks, open);
    const params = splitCommas(def.node.toks.slice(open + 1, close)).filter((p) => p.length && p[0].v !== 'self');
    const typed = params.map((p) => `${def.vars.get(p[0].v) ?? 'int'} ${p[0].v}`).join(', ');
    out.line(`static ${def.ret} ${def.name}(${typed}) {`, def.node.line);
    emitBlock(def.body, { out, ctx });
    out.line('}', def.node.line);
  }

  const mainVars: Vars = new Map();
  collectVars(moduleNodes, mainVars, fns, lists);
  out.line('public static void main() {', moduleNodes[0]?.line ?? firstLine);
  emitBlock(moduleNodes, { out, ctx: { vars: mainVars, fns, lists, declared: new Set() } });
  out.line('}', lastLine);
  out.line('}', lastLine);

  return out.done();
}
