export type Tok = { k: 'id' | 'num' | 'str' | 'chr' | 'op'; v: string; line: number; dbl?: boolean; tmpl?: boolean };

/** renders a token back to source (strings/chars get their quotes back) */
export function render(t: Tok): string {
  if (t.k === 'str') return '"' + t.v + '"';
  if (t.k === 'chr') return "'" + t.v + "'";
  return t.v;
}

const OPS = [
  '>>>=', '<<=', '>>=', '===', '!==', '...', '=>', '::', '->', '++', '--', '+=', '-=', '*=', '/=', '%=', '**=',
  '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '**', '??', '?.',
  '=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '&', '|', '^', '~', '#', '@', '\\',
];

/**
 * Tokenizer for C-like sources (C++ and JavaScript). Comments are dropped,
 * string escapes are kept verbatim so the generated Java means the same thing.
 */
export function lexLike(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      toks.push({ k: 'id', v: src.slice(start, i), line });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      let dbl = false;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.') {
        dbl = true;
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        dbl = true;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      if (/[fFdDlLuU]/.test(src[i] ?? '')) i++;
      toks.push({ k: 'num', v: src.slice(start, i), line, dbl });
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      let text = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          text += src[i] + (src[i + 1] ?? '');
          i += 2;
        } else {
          if (src[i] === '\n') line++;
          text += src[i++];
        }
      }
      i++;
      toks.push({ k: quote === "'" ? 'chr' : 'str', v: text, line, tmpl: quote === '`' });
      continue;
    }

    let hit = '';
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        hit = op;
        break;
      }
    }
    if (hit) {
      toks.push({ k: 'op', v: hit, line });
      i += hit.length;
      continue;
    }

    i++;
  }

  return toks;
}

/** Index of the token that closes the bracket opened at `open`, or -1. */
export function matchBracket(toks: Tok[], open: number): number {
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

export function splitTop(toks: Tok[], sep: string): Tok[][] {
  const parts: Tok[][] = [];
  let depth = 0;
  let current: Tok[] = [];
  for (const t of toks) {
    if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
    if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
    if (depth === 0 && t.v === sep) {
      parts.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  parts.push(current);
  return parts;
}

export function textOf(toks: Tok[]): string {
  return toks.map(render).join(' ');
}
