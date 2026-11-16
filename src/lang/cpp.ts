import { lexLike, matchBracket, render, type Tok } from './lex';
import { Out } from './out';
import { TranslateError, type Translated } from './types';

const TYPE_WORDS = new Set(['int', 'long', 'short', 'char', 'float', 'double', 'bool', 'void', 'string', 'auto', 'size_t']);
const SKIP_WORDS = new Set(['const', 'static', 'inline', 'unsigned', 'signed', 'virtual', 'explicit', 'register', 'constexpr']);

function isTypeWord(t: Tok): boolean {
  if (t.k !== 'id') return false;
  if (TYPE_WORDS.has(t.v)) return true;
  return /^[A-Z]/.test(t.v);
}

function baseName(text: string): string {
  if (text === 'string') return 'String';
  if (text === 'bool') return 'boolean';
  return text;
}

function matchAngle(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].v === '<') depth++;
    else if (toks[i].v === '>') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `vector<int>` / `vector<vector<int>>` → `int[]` / `int[][]` */
function readVector(toks: Tok[], start: number): { type: string; next: number } {
  let j = start + 2;
  let base = 'int';
  if (toks[j]?.v === 'vector' && toks[j + 1]?.v === '<') {
    const inner = readVector(toks, j);
    base = inner.type;
    j = inner.next;
  } else {
    const parts: string[] = [];
    while (j < toks.length && toks[j].v !== '>') {
      parts.push(toks[j].v);
      j++;
    }
    base = baseName(parts.join(''));
  }
  if (toks[j]?.v === '>') j++;
  return { type: base + '[]', next: j };
}

/** function definitions that sit at file scope */
function scanFunctions(toks: Tok[]): Map<number, { name: string; paren: number }> {
  const found = new Map<number, { name: string; paren: number }>();
  let depth = 0;
  let stmtStart = true;

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.v === '{') {
      depth++;
      stmtStart = false;
      continue;
    }
    if (t.v === '}') {
      depth--;
      stmtStart = depth === 0;
      continue;
    }
    if (t.v === ';') {
      if (depth === 0) stmtStart = true;
      continue;
    }
    if (depth !== 0 || !stmtStart) continue;
    if (t.v === 'struct' || t.v === 'class') {
      stmtStart = false;
      continue;
    }

    let j = k;
    let name = '';
    let paren = -1;
    for (let guard = 0; guard < 24 && j < toks.length; guard++) {
      const x = toks[j];
      if (SKIP_WORDS.has(x.v)) {
        j++;
        continue;
      }
      if (x.v === 'vector' && toks[j + 1]?.v === '<') {
        const close = matchAngle(toks, j + 1);
        if (close < 0) break;
        j = close + 1;
        continue;
      }
      if (isTypeWord(x)) {
        j++;
        continue;
      }
      if (x.v === '*' || x.v === '&') {
        j++;
        continue;
      }
      if (x.k === 'id' && toks[j + 1]?.v === '(') {
        name = x.v;
        paren = j + 1;
      }
      break;
    }
    if (paren < 0) {
      stmtStart = false;
      continue;
    }
    const close = matchBracket(toks, paren);
    if (close < 0 || toks[close + 1]?.v !== '{') {
      stmtStart = false;
      continue;
    }
    found.set(k, { name, paren });
    stmtStart = false;
  }

  return found;
}

/** `struct Node { ... };` → Java does not want that trailing semicolon */
/** `for (const T& x : v)` → the element type inside the container */
function rangeElemType(toks: Tok[]): string {
  if (!toks.length) return 'int';
  if (toks[0].v === 'vector' && toks[1]?.v === '<') {
    const full = readVector(toks, 0).type;
    return full.endsWith('[]') ? full.slice(0, -2) : full;
  }
  const text = toks.map((x) => render(x)).filter((x) => x !== '*' && x !== '&').join('');
  return text === 'auto' ? 'var' : baseName(text) || 'int';
}

function classSemicolons(toks: Tok[]): Set<number> {
  const drop = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if ((t.v === 'struct' || t.v === 'class') && toks[i + 1]?.k === 'id' && toks[i + 2]?.v === '{') {
      const close = matchBracket(toks, i + 2);
      if (close > 0 && toks[close + 1]?.v === ';') drop.add(close + 1);
    }
  }
  return drop;
}

export function cppToJava(source: string): Translated {
  const raw = lexLike(source);

  // nested templates arrive as `>>`
  const split: Tok[] = [];
  for (const t of raw) {
    if (t.v === '>>') {
      split.push({ ...t, v: '>' }, { ...t, v: '>' });
      continue;
    }
    split.push(t);
  }

  const pragma = new Set<number>();
  for (const t of split) if (t.v === '#') pragma.add(t.line);

  const toks: Tok[] = [];
  for (let i = 0; i < split.length; i++) {
    const t = split[i];
    if (pragma.has(t.line)) continue;
    if (t.v === 'using') {
      while (i < split.length && split[i].v !== ';') i++;
      continue;
    }
    if (t.v === 'template') throw new TranslateError('Templates are not supported — use a concrete type.', t.line);
    toks.push(t);
  }

  const out = new Out();
  const fns = scanFunctions(toks);
  const dropSemi = classSemicolons(toks);
  const firstLine = toks[0]?.line ?? 1;
  const lastLine = toks[toks.length - 1]?.line ?? firstLine;

  out.line('class Main {', firstLine);

  let i = 0;

  while (i < toks.length) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];

    if (dropSemi.has(i)) {
      i++;
      continue;
    }

    if (t.v === 'std' && next?.v === '::') {
      i += 2;
      continue;
    }

    if ((t.v === 'struct' || t.v === 'class') && next?.k === 'id') {
      out.write('class', t.line);
      out.write(next.v, t.line);
      out.write('{', t.line);
      i += 2;
      if (toks[i]?.v === '{') i++;
      continue;
    }
    if (t.v === 'class' || t.v === 'namespace' || t.v === 'typedef') {
      throw new TranslateError(`${t.v} declarations are not supported here.`, t.line);
    }

    const fn = fns.get(i);
    if (fn) {
      if (fn.name === 'main') {
        out.write('public static void main', t.line);
        out.write('(', t.line);
        out.write(')', t.line);
        const close = matchBracket(toks, fn.paren);
        i = close + 1;
        continue;
      }
      out.write('static', t.line);
    }

    if (t.v === 'for' && toks[i + 1]?.v === '(') {
      const close = matchBracket(toks, i + 1);
      let colon = -1;
      let nesting = 0;
      for (let k = i + 2; k < close; k++) {
        const v = toks[k].v;
        if (v === '(' || v === '[' || v === '{') nesting++;
        else if (v === ')' || v === ']' || v === '}') nesting--;
        else if (nesting === 0 && v === ':') {
          colon = k;
          break;
        }
      }
      if (colon > 0 && toks[close + 1]?.v === '{') {
        const decl = toks.slice(i + 2, colon);
        const iterable = toks.slice(colon + 1, close);
        const nameTok = [...decl].reverse().find((x) => x.k === 'id' && !isTypeWord(x) && !SKIP_WORDS.has(x.v));
        if (!nameTok || !iterable.length) throw new TranslateError('This range-for could not be read.', t.line);
        const elemType = rangeElemType(decl.filter((x) => x !== nameTok));
        const source = iterable.map(render).join(' ');
        const tmp = `__i${t.line}`;
        out.write('for', t.line);
        out.write('(', t.line);
        out.write(`var ${tmp} = 0`, t.line);
        out.write(';', t.line);
        out.write(`${tmp} < ${source} . length`, t.line);
        out.write(';', t.line);
        out.write(`${tmp}++`, t.line);
        out.write(')', t.line);
        out.write('{', t.line);
        out.write(`${elemType} ${nameTok.v} = ${source} [ ${tmp} ]`, t.line);
        out.write(';', t.line);
        i = close + 2; // the original `{` is ours
        continue;
      }
    }

    if (t.v === 'cin' || t.v === 'scanf') {
      throw new TranslateError('Reading input is not supported — put the values in the code.', t.line);
    }

    if (t.v === 'cout' || t.v === 'cerr') {
      i++;
      while (i < toks.length && toks[i].v === '<<') {
        i++;
        const operand: Tok[] = [];
        while (i < toks.length && toks[i].v !== '<<' && toks[i].v !== ';') {
          operand.push(toks[i]);
          i++;
        }
        if (!operand.length) continue;
        const text = operand.map(render).join(' ');
        if (text === 'endl' || text === '"\\n"' || text === "'\\n'") {
          out.write('System.out.println', t.line);
          out.write('(', t.line);
          out.write(')', t.line);
          out.write(';', t.line);
        } else if (text === 'fixed' || text.startsWith('setprecision')) {
          continue;
        } else {
          out.write('System.out.print', t.line);
          out.write('(', t.line);
          for (const x of operand) out.write(x.v === '->' || x.v === '::' ? '.' : baseName(render(x)), x.line);
          out.write(')', t.line);
          out.write(';', t.line);
        }
      }
      if (toks[i]?.v === ';') i++;
      continue;
    }

    if (t.v === 'endl') {
      i++;
      continue;
    }

    if (t.v === 'printf' && next?.v === '(') {
      out.write('System.out.printf', t.line);
      i++;
      continue;
    }

    if (t.v === 'vector' && next?.v === '<') {
      const read = readVector(toks, i);
      out.write(read.type, t.line);
      i = read.next;
      continue;
    }

    if (t.v === '.' && next?.v === 'size' && toks[i + 2]?.v === '(' && toks[i + 3]?.v === ')') {
      out.write('.length', t.line);
      i += 4;
      continue;
    }

    if (t.v === '*' || t.v === '&') {
      const prevIsType = !!prev && (isTypeWord(prev) || prev.v === '>' || prev.v === ']');
      if (prevIsType || (t.v === '&' && next?.k === 'id')) {
        i++;
        continue;
      }
    }

    if (t.v === 'long' && next?.v === 'long') {
      out.write('long', t.line);
      i += 2;
      continue;
    }

    if (SKIP_WORDS.has(t.v)) {
      i++;
      continue;
    }

    if (t.v === 'string') {
      out.write('String', t.line);
      i++;
      continue;
    }
    if (t.v === 'bool') {
      out.write('boolean', t.line);
      i++;
      continue;
    }
    if (t.v === 'nullptr' || t.v === 'NULL') {
      out.write('null', t.line);
      i++;
      continue;
    }

    out.write(t.v === '->' || t.v === '::' ? '.' : render(t), t.line);
    i++;
  }

  out.line('}', lastLine);

  return out.done();
}
