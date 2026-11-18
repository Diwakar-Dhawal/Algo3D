import { ParseError } from './types';

export type Tok = {
  k: 'id' | 'num' | 'str' | 'chr' | 'op' | 'eof';
  v: string;
  line: number;
  isDouble?: boolean;
};

const OPS = [
  '...', '->', '::', '>>>=', '<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=',
  '&&', '||', '<<', '>>', '=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', ';', ',',
  '.', '(', ')', '[', ']', '{', '}', '@', '|', '&', '^', '~',
];

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

export function lex(src: string): Tok[] {
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
      let isDouble = false;
      // 0xFF, 0b1010 and digit separators like 1_000_000
      if (c === '0' && /[xXbB]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) i++;
        if (/[Ll]/.test(src[i] ?? '')) i++;
        toks.push({ k: 'num', v: src.slice(start, i), line, isDouble: false });
        continue;
      }
      while (i < src.length && /[0-9_]/.test(src[i])) i++;
      if (src[i] === '.') {
        isDouble = true;
        i++;
        while (i < src.length && /[0-9_]/.test(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        isDouble = true;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      if (/[LlFfDd]/.test(src[i] ?? '')) i++;
      toks.push({ k: 'num', v: src.slice(start, i), line, isDouble });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let out = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          // keep a backslash Java would not recognise, so regexes like \d survive
          out += ESCAPES[src[i + 1]] ?? '\\' + src[i + 1];
          i += 2;
        } else {
          if (src[i] === '\n') line++;
          out += src[i++];
        }
      }
      i++;
      toks.push({ k: quote === '"' ? 'str' : 'chr', v: out, line });
      continue;
    }

    let matched = false;
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        toks.push({ k: 'op', v: op, line });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    throw new ParseError(`Unexpected character "${c}"`, line);
  }

  toks.push({ k: 'eof', v: '', line });
  return toks;
}
