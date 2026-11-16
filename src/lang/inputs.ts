import type { LangId } from './types';

/* ------------------------------------------------------------------ values */

export type InputValue =
  | { kind: 'int'; value: number }
  | { kind: 'double'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'null' }
  | { kind: 'list'; items: InputValue[] };

export type InputLine = { name: string; value: InputValue | null; text: string };
export type ParsedInputs = { values: InputLine[]; call: string | null; error?: { line: number; message: string } };

export type Applied = { code: string; map: number[]; error?: { line: number; message: string } };

/** a literal the input box understands: 5, 2.5, true, "hi", [1, 2], [[1], [2]], null */
export function parseValue(text: string): InputValue | null {
  const pos = { i: 0 };
  const skip = () => {
    while (pos.i < text.length && /\s/.test(text[pos.i])) pos.i++;
  };

  const value = (): InputValue | null => {
    skip();
    const c = text[pos.i];

    if (c === '[' || c === '{') {
      const close = c === '[' ? ']' : '}';
      pos.i++;
      const items: InputValue[] = [];
      for (;;) {
        skip();
        if (text[pos.i] === close) {
          pos.i++;
          break;
        }
        if (pos.i >= text.length) return null;
        const item = value();
        if (!item) return null;
        items.push(item);
        skip();
        if (text[pos.i] === ',') {
          pos.i++;
          continue;
        }
        if (text[pos.i] === close) {
          pos.i++;
          break;
        }
        return null;
      }
      return { kind: 'list', items };
    }

    if (c === '"' || c === "'") {
      pos.i++;
      let out = '';
      while (pos.i < text.length && text[pos.i] !== c) {
        if (text[pos.i] === '\\') {
          out += text[pos.i] + (text[pos.i + 1] ?? '');
          pos.i += 2;
          continue;
        }
        out += text[pos.i++];
      }
      if (pos.i >= text.length) return null;
      pos.i++;
      return { kind: 'string', value: out };
    }

    if (c === '-' || c === '+' || c === '.' || /[0-9]/.test(c ?? '')) {
      const start = pos.i;
      pos.i++;
      while (pos.i < text.length && /[0-9._eE]/.test(text[pos.i])) pos.i++;
      const raw = text.slice(start, pos.i).replace(/_/g, '');
      const num = Number(raw);
      if (!raw || Number.isNaN(num)) return null;
      return raw.includes('.') || /e/i.test(raw) ? { kind: 'double', value: num } : { kind: 'int', value: num };
    }

    const word = /^[A-Za-z_]\w*/.exec(text.slice(pos.i));
    if (!word) return null;
    pos.i += word[0].length;
    const lower = word[0].toLowerCase();
    if (lower === 'true') return { kind: 'bool', value: true };
    if (lower === 'false') return { kind: 'bool', value: false };
    if (lower === 'null' || lower === 'none' || lower === 'nil' || lower === 'nullptr') return { kind: 'null' };
    return null;
  };

  const result = value();
  if (!result) return null;
  skip();
  return pos.i === text.length ? result : null;
}

export function parseInputs(text: string): ParsedInputs {
  const values: InputLine[] = [];
  const callLines: string[] = [];
  const rows = text.split(/\r?\n/);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const callMatch = /^call\s+(.+)$/i.exec(line);
    if (callMatch) {
      callLines.push(callMatch[1].trim());
      continue;
    }

    const nameMatch = /^([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(line);
    if (!nameMatch) {
      return { values, call: callLines[0] ?? null, error: { line: i + 1, message: `Expected "name = value" or "call name(args)", found "${line}"` } };
    }
    const text = nameMatch[2].trim();
    if (!text) {
      return { values, call: callLines[0] ?? null, error: { line: i + 1, message: `Give ${nameMatch[1]} a value after the =` } };
    }
    if (!values.some((entry) => entry.name === nameMatch[1])) {
      values.push({ name: nameMatch[1], value: parseValue(text), text });
    }
  }

  return { values, call: callLines[0] ?? null };
}

/* --------------------------------------------------------------- rendering */

function depthOf(value: InputValue): number {
  return value.kind === 'list' ? 1 + Math.max(0, ...value.items.map(depthOf)) : 0;
}

function baseOf(value: InputValue): string {
  if (value.kind === 'list') return baseOf(value.items[0] ?? { kind: 'int', value: 0 });
  if (value.kind === 'string') return 'String';
  if (value.kind === 'bool') return 'boolean';
  if (value.kind === 'double') return 'double';
  if (value.kind === 'null') return 'int';
  return 'int';
}

/** Java type of a literal, e.g. int[] / int[][] / String[] */
export function javaType(value: InputValue): string {
  const dims = depthOf(value);
  return baseOf(value) + '[]'.repeat(dims);
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** the value as source for the chosen language — literals are re-rendered, anything else is passed through */
export function codeOf(entry: InputLine, language: LangId): string {
  return entry.value ? renderValue(entry.value, language) : entry.text;
}

export function renderValue(value: InputValue, language: LangId): string {
  const truth = language === 'python' ? 'True' : 'true';
  const falsity = language === 'python' ? 'False' : 'false';
  const nil = language === 'python' ? 'None' : 'null';

  switch (value.kind) {
    case 'int':
      return String(value.value);
    case 'double':
      return String(value.value);
    case 'bool':
      return value.value ? truth : falsity;
    case 'string':
      return quote(value.value);
    case 'null':
      return nil;
    case 'list': {
      const inner = value.items.map((item) => renderValue(item, language)).join(', ');
      if (language === 'cpp') return `{${inner}}`;
      if (language === 'java') return `new ${javaType(value)}{${inner}}`;
      return `[${inner}]`;
    }
  }
}

export function defaultValue(type: string): InputValue {
  if (type.endsWith('[][]')) return { kind: 'list', items: [{ kind: 'list', items: [{ kind: 'int', value: 1 }, { kind: 'int', value: 2 }] }] };
  if (type.endsWith('[]')) return { kind: 'list', items: [1, 2, 3].map((n) => ({ kind: 'int' as const, value: n })) };
  if (type === 'String') return { kind: 'string', value: 'abc' };
  if (type === 'double') return { kind: 'double', value: 1.5 };
  if (type === 'boolean') return { kind: 'bool', value: true };
  return { kind: 'int', value: 5 };
}

/* ---------------------------------------------------------- declaration scan */

type DeclHit = { name: string; prefix: string; suffix: string };

function matchDecl(language: LangId, line: string, wanted: Map<string, string>): DeclHit | null {
  if (language === 'python') {
    const m = /^([A-Za-z_]\w*)\s*=\s*/.exec(line);
    if (!m || !wanted.has(m[1])) return null;
    return { name: m[1], prefix: m[0], suffix: '' };
  }

  if (language === 'js') {
    const typed = /^(\s*(?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*/.exec(line);
    if (typed && wanted.has(typed[2])) return { name: typed[2], prefix: typed[0], suffix: ';' };
    const plain = /^(\s*)([A-Za-z_$][\w$]*)\s*=\s*/.exec(line);
    if (plain && wanted.has(plain[2])) return { name: plain[2], prefix: plain[0], suffix: ';' };
    return null;
  }

  if (language === 'cpp') {
    const typed = /^(\s*(?:[\w:<>,\s]+?)\s+)([A-Za-z_]\w*)\s*=\s*/.exec(line);
    if (typed && wanted.has(typed[2])) return { name: typed[2], prefix: typed[0], suffix: ';' };
    const plain = /^(\s*)([A-Za-z_]\w*)\s*=\s*/.exec(line);
    if (plain && wanted.has(plain[2])) return { name: plain[2], prefix: plain[0], suffix: ';' };
    return null;
  }

  const typed = /^(\s*(?:[\w$.<>[\],]+\s+)+)([A-Za-z_$][\w$]*)\s*=\s*/.exec(line);
  if (typed && wanted.has(typed[2])) return { name: typed[2], prefix: typed[0], suffix: ';' };
  const plain = /^(\s*)([A-Za-z_$][\w$]*)\s*=\s*/.exec(line);
  if (plain && wanted.has(plain[2])) return { name: plain[2], prefix: plain[0], suffix: ';' };
  return null;
}

function statementEnds(language: LangId, text: string): boolean {
  if (language === 'python') {
    let depth = 0;
    for (const c of text) {
      if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth--;
    }
    return depth <= 0 && !text.trimEnd().endsWith(',');
  }
  return text.trimEnd().endsWith(';');
}

/** replaces `name = ...` declarations with the supplied literal, remembering line numbers */
function replaceDeclarations(
  language: LangId,
  lines: string[],
  wanted: Map<string, string>
): { lines: string[]; map: number[]; done: Set<string> } {
  const out: string[] = [];
  const map: number[] = [];
  const done = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hit = matchDecl(language, line, wanted);
    if (!hit || done.has(hit.name)) {
      out.push(line);
      map.push(i + 1);
      continue;
    }

    let text = line;
    let j = i;
    while (!statementEnds(language, text) && j + 1 < lines.length) {
      j++;
      text += '\n' + lines[j];
    }

    out.push(`${hit.prefix}${wanted.get(hit.name)}${hit.suffix}`);
    map.push(i + 1);
    done.add(hit.name);
    i = j;
  }

  return { lines: out, map, done };
}

function findBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const c of lines[i]) {
      if (c === '{') {
        depth++;
        seen = true;
      } else if (c === '}') {
        depth--;
        if (seen && depth === 0) return i;
      }
    }
  }
  return -1;
}

/* ------------------------------------------------------------ apply inputs */

const JAVA_MAIN = /static\s+void\s+main\s*\(/;

function cppType(value: InputValue): string {
  const dims = depthOf(value);
  const base = baseOf(value);
  let type = base;
  for (let i = 0; i < dims; i++) type = `vector<${type}>`;
  return type;
}

function applyJava(source: string, parsed: ParsedInputs): Applied {
  const wanted = new Map(parsed.values.map((entry) => [entry.name, codeOf(entry, 'java')]));
  const { lines, map, done } = replaceDeclarations('java', source.split('\n'), wanted);

  const declares: string[] = [];
  for (const entry of parsed.values) {
    if (done.has(entry.name)) continue;
    const type = entry.value ? javaType(entry.value) : 'var';
    declares.push(`        ${type} ${entry.name} = ${codeOf(entry, 'java')};`);
  }

  const driver: string[] = [];
  if (parsed.call) {
    driver.push(`        var __result = ${parsed.call};`);
    driver.push('        System.out.println(__result);');
    for (const entry of parsed.values) {
      if (entry.value?.kind !== 'list') continue;
      driver.push(`        System.out.println(Arrays.toString(${entry.name}));`);
    }
  }

  if (!declares.length && !driver.length) return { code: lines.join('\n'), map };

  const mainLine = lines.findIndex((line) => JAVA_MAIN.test(line));
  const closeLine = mainLine >= 0 ? findBlockEnd(lines, mainLine) : -1;
  const outLines = [...lines];
  const outMap = [...map];

  if (closeLine >= 0) {
    outLines.splice(closeLine, 0, ...driver);
    outMap.splice(closeLine, 0, ...driver.map(() => closeLine + 1));
    // values go right after the opening brace so `main` can read them
    outLines.splice(mainLine + 1, 0, ...declares);
    outMap.splice(mainLine + 1, 0, ...declares.map(() => mainLine + 1));
  } else {
    const anchor = lines.length;
    outLines.push(...declares, ...driver);
    outMap.push(...[...declares, ...driver].map(() => anchor));
  }

  return { code: outLines.join('\n'), map: outMap };
}

function applyCpp(source: string, parsed: ParsedInputs): Applied {
  const wanted = new Map(parsed.values.map((entry) => [entry.name, codeOf(entry, 'cpp')]));
  const { lines, map, done } = replaceDeclarations('cpp', source.split('\n'), wanted);

  const declares: string[] = [];
  for (const entry of parsed.values) {
    if (done.has(entry.name)) continue;
    const type = entry.value ? cppType(entry.value) : 'auto';
    declares.push(`    ${type} ${entry.name} = ${codeOf(entry, 'cpp')};`);
  }

  const driver: string[] = [];
  if (parsed.call) {
    driver.push(`    auto __result = ${parsed.call};`);
    driver.push('    cout << __result << endl;');
  }

  if (!declares.length && !driver.length) return { code: lines.join('\n'), map };

  const mainLine = lines.findIndex((line) => /\bmain\s*\(/.test(line));
  const closeLine = mainLine >= 0 ? findBlockEnd(lines, mainLine) : -1;
  const outLines = [...lines];
  const outMap = [...map];

  if (closeLine >= 0) {
    outLines.splice(closeLine, 0, ...driver);
    outMap.splice(closeLine, 0, ...driver.map(() => closeLine + 1));
    outLines.splice(mainLine + 1, 0, ...declares);
    outMap.splice(mainLine + 1, 0, ...declares.map(() => mainLine + 1));
  } else {
    const anchor = lines.length;
    outLines.push(...declares, ...driver);
    outMap.push(...[...declares, ...driver].map(() => anchor));
  }

  return { code: outLines.join('\n'), map: outMap };
}

function applyScriptLanguage(language: 'python' | 'js', source: string, parsed: ParsedInputs): Applied {
  const wanted = new Map(parsed.values.map((entry) => [entry.name, codeOf(entry, language)]));
  const { lines, map, done } = replaceDeclarations(language, source.split('\n'), wanted);

  const prelude: string[] = [];
  for (const entry of parsed.values) {
    if (done.has(entry.name)) continue;
    prelude.push(language === 'python' ? `${entry.name} = ${codeOf(entry, 'python')}` : `const ${entry.name} = ${codeOf(entry, 'js')};`);
  }

  const driver: string[] = [];
  if (parsed.call) {
    const prints = parsed.values.filter((entry) => new RegExp(`\\b${entry.name}\\b`).test(parsed.call ?? '')).map((entry) => entry.name);
    if (language === 'python') {
      driver.push(`__result = ${parsed.call}`, 'print("->", __result)');
      for (const name of prints) driver.push(`print(${name})`);
    } else {
      driver.push(`const __result = ${parsed.call};`, 'console.log("->", __result);');
      for (const name of prints) driver.push(`console.log(${name});`);
    }
  }

  if (!prelude.length && !driver.length) return { code: lines.join('\n'), map };

  const insertAt = language === 'js' ? jsPreludeLine(lines) : 0;
  const anchor = map[Math.min(insertAt, map.length - 1)] ?? 1;
  const lastLine = lines.length;
  const outLines = [...lines.slice(0, insertAt), ...prelude, ...lines.slice(insertAt), ...driver];
  const outMap = [...map.slice(0, insertAt), ...prelude.map(() => anchor), ...map.slice(insertAt), ...driver.map(() => lastLine)];

  return { code: outLines.join('\n'), map: outMap };
}

/** JavaScript needs its function declarations first: insert values right after them */
function jsPreludeLine(lines: string[]): number {
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const opens = (lines[i].match(/\{/g) ?? []).length;
    const closes = (lines[i].match(/\}/g) ?? []).length;
    if (depth === 0 && trimmed && opens === 0 && closes === 0 && !/^(function|\/\/|\/\*|$)/.test(trimmed)) return i;
    depth += opens - closes;
  }
  return lines.length;
}

export function applyInputs(language: LangId, source: string, text: string): Applied {
  const parsed = parseInputs(text);
  if (parsed.error) {
    return { code: source, map: source.split('\n').map((_, i) => i + 1), error: parsed.error };
  }
  if (!parsed.values.length && !parsed.call) {
    return { code: source, map: source.split('\n').map((_, i) => i + 1) };
  }

  switch (language) {
    case 'java':
      return applyJava(source, parsed);
    case 'cpp':
      return applyCpp(source, parsed);
    default:
      return applyScriptLanguage(language, source, parsed);
  }
}

/* ------------------------------------------------------------- suggestions */

function guessPyType(name: string, body: string): string {
  if (new RegExp(`\\b${name}\\s*\\[`).test(body) || new RegExp(`len\\s*\\(\\s*${name}\\s*\\)`).test(body)) return 'int[]';
  if (new RegExp(`\\b${name}\\s*\\.(?:append|pop)`).test(body)) return 'int[]';
  if (new RegExp(`\\b${name}\\s*\\.(?:upper|lower|strip)`).test(body)) return 'String';
  return 'int';
}

function hasPythonTopLevelCode(source: string): boolean {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(def|class|import|from)\b/.test(line)) continue;
    if (/^if\s+__name__/.test(line)) continue;
    if (raw.startsWith(' ') || raw.startsWith('\t')) continue;
    return true;
  }
  return false;
}

function stripJsFunctions(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const fn = source.indexOf('function', i);
    if (fn < 0) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, fn);
    const open = source.indexOf('{', fn);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

export function suggestInputs(language: LangId, source: string): { values: InputLine[]; call: string | null } {
  const values: InputLine[] = [];
  const push = (name: string, value: InputValue) => {
    if (!values.some((entry) => entry.name === name)) values.push({ name, value, text: renderValue(value, 'js') });
  };

  const rows = source.split('\n');
  for (const line of rows) {
    const m = language === 'python'
      ? /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line)
      : language === 'js'
        ? /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/.exec(line)
        : language === 'cpp'
          ? /^\s*(?:[\w:<>,\s]+?)\s+([A-Za-z_]\w*)\s*=\s*(.+?);\s*$/.exec(line)
          : /^\s*(?:[\w$.<>[\],]+\s+)+([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*$/.exec(line);
    if (!m) continue;
    const value = parseValue(m[2].trim());
    if (value) push(m[1], value);
  }

  if (language === 'java') return { values, call: null };

  const noTopLevel = language === 'python' ? !hasPythonTopLevelCode(source) : language === 'js' ? !/[^\s;]/.test(stripJsFunctions(source).replace(/\/\/.*$/gm, '')) : false;

  if (language === 'cpp' || !noTopLevel) return { values, call: null };

  if (language === 'python') {
    const fn = /^\s*def\s+(\w+)\s*\(([^)]*)\)/m.exec(source);
    if (!fn) return { values, call: null };
    const params = fn[2].split(',').map((p) => p.split(':')[0].trim()).filter((p) => p && p !== 'self');
    const body = source.slice(source.indexOf(fn[0]));
    for (const param of params) push(param, defaultValue(guessPyType(param, body)));
    return { values, call: `${fn[1]}(${params.join(', ')})` };
  }

  if (language === 'js') {
    const fn = /^\s*function\s+(\w+)\s*\(([^)]*)\)/m.exec(source);
    if (!fn) return { values, call: null };
    const params = fn[2].split(',').map((p) => p.trim()).filter(Boolean);
    const body = source.slice(source.indexOf(fn[0]));
    for (const param of params) push(param, defaultValue(guessPyType(param, body)));
    return { values, call: `${fn[1]}(${params.join(', ')})` };
  }

  return { values, call: null };
}

export function formatInputs(values: InputLine[], call: string | null): string {
  const rows = values.map((entry) => `${entry.name} = ${entry.value ? renderValue(entry.value, 'js') : entry.text}`);
  if (call) rows.push(`call ${call}`);
  return rows.join('\n');
}
