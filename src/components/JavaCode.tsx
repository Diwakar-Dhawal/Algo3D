import type { LangId } from '../lang/types';

const JAVA_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'return', 'new', 'class', 'void', 'int', 'boolean', 'char', 'double',
  'long', 'private', 'public', 'static', 'final', 'true', 'false', 'null', 'break', 'continue', 'throw',
  'this', 'extends', 'implements', 'interface', 'import', 'package', 'instanceof', 'super',
]);

const PYTHON_KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not', 'is', 'True', 'False',
  'None', 'pass', 'break', 'continue', 'import', 'from', 'class', 'self', 'global', 'del', 'with', 'try',
  'except', 'lambda', 'yield', 'range', 'len', 'print', 'str', 'int', 'float', 'abs', 'min', 'max',
]);

const JS_KEYWORDS = new Set([
  'function', 'return', 'if', 'else', 'for', 'while', 'let', 'const', 'var', 'new', 'true', 'false',
  'null', 'undefined', 'break', 'continue', 'typeof', 'class', 'this', 'of', 'in', 'switch', 'case',
  'default', 'throw', 'try', 'catch', 'finally', 'async', 'await', 'console',
]);

const CPP_KEYWORDS = new Set([
  'include', 'using', 'namespace', 'std', 'int', 'long', 'short', 'char', 'float', 'double', 'bool',
  'void', 'string', 'vector', 'struct', 'class', 'public', 'private', 'return', 'if', 'else', 'for',
  'while', 'do', 'break', 'continue', 'true', 'false', 'nullptr', 'NULL', 'const', 'static', 'cout',
  'cin', 'endl', 'new', 'delete', 'template', 'typename', 'auto', 'unsigned',
]);

const KEYWORDS: Record<LangId, Set<string>> = {
  java: JAVA_KEYWORDS,
  python: PYTHON_KEYWORDS,
  js: JS_KEYWORDS,
  cpp: CPP_KEYWORDS,
};

const PATTERNS: Record<LangId, string> = {
  java: '(/\\/\\/.*$)|("(?:[^"\\\\]|\\\\.)*")|([A-Za-z_$][\\w$]*)|(\\d+)|(\\s+)|([^\\s])',
  cpp: '(/\\/\\/.*$)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|([A-Za-z_$][\\w$]*)|(\\d+)|(\\s+)|([^\\s])',
  js: '(/\\/\\/.*$)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`[^`]*`)|([A-Za-z_$][\\w$]*)|(\\d+)|(\\s+)|([^\\s])',
  python: '(#.*$)|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|([A-Za-z_][\\w]*)|(\\d+(?:\\.\\d+)?)|(\\s+)|([^\\s])',
};

type Token = { text: string; kind: string };

export function tokenize(line: string, lang: LangId = 'java'): Token[] {
  const keywords = KEYWORDS[lang] ?? JAVA_KEYWORDS;
  const re = new RegExp(PATTERNS[lang] ?? PATTERNS.java, 'g');
  const out: Token[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(line))) {
    if (match.index === re.lastIndex) re.lastIndex++;
    const text = match[0];
    let kind = 'punc';

    if (match[1]) kind = 'cmt';
    else if (match[2]) kind = 'str';
    else if (match[3]) {
      if (keywords.has(text)) kind = 'kw';
      else if (line[match.index + text.length] === '(') kind = 'fn';
      else if (/^[A-Z]/.test(text)) kind = 'type';
      else kind = 'id';
    } else if (match[4]) kind = 'num';
    else if (match[5]) kind = 'ws';

    out.push({ text, kind });
  }
  return out;
}

type Props = { code: string; activeLine: number; lang?: LangId; file?: string };

export function JavaCode({ code, activeLine, lang = 'java', file }: Props) {
  const lines = code.split('\n');

  return (
    <div className="code">
      <div className="code-head">
        <span className="dot" />
        <span>{file ?? 'Solution.java'}</span>
        <span className="code-meta">line {activeLine || '—'}</span>
      </div>
      <pre className="code-body">
        {lines.map((line, i) => {
          const isActive = i + 1 === activeLine;
          return (
            <div key={i} className={`code-line ${isActive ? 'on' : ''}`}>
              <span className="ln">{i + 1}</span>
              <code>
                {tokenize(line, lang).map((token, k) => (
                  <span key={k} className={`t-${token.kind}`}>
                    {token.text}
                  </span>
                ))}
              </code>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
