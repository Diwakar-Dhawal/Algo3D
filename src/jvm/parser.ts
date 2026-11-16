import { ParseError } from './types';
import { lex, type Tok } from './lexer';

export type TypeRef = { name: string; dims: number };

export type ClassDef = {
  name: string;
  fields: { type: TypeRef; name: string; init: Expr | null; isStatic: boolean }[];
  methods: MethodDef[];
};

export type MethodDef = {
  name: string;
  ret: TypeRef;
  params: { type: TypeRef; name: string }[];
  body: Stmt;
  line: number;
  isStatic: boolean;
  isCtor: boolean;
};

export type Stmt =
  | { t: 'block'; body: Stmt[]; line: number }
  | { t: 'vardecl'; type: TypeRef; name: string; init: Expr | null; line: number }
  | { t: 'expr'; expr: Expr; line: number }
  | { t: 'if'; cond: Expr; then: Stmt; else: Stmt | null; line: number }
  | { t: 'while'; cond: Expr; body: Stmt; line: number }
  | { t: 'dowhile'; cond: Expr; body: Stmt; line: number }
  | { t: 'for'; init: Stmt | null; cond: Expr | null; update: Expr | null; body: Stmt; line: number }
  | { t: 'return'; value: Expr | null; line: number }
  | { t: 'break'; line: number }
  | { t: 'continue'; line: number }
  | { t: 'empty'; line: number };

export type Expr =
  | { t: 'num'; v: number; isDouble: boolean }
  | { t: 'str'; v: string }
  | { t: 'char'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'id'; name: string }
  | { t: 'this' }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'un'; op: string; e: Expr; prefix: boolean }
  | { t: 'assign'; op: string; target: Expr; value: Expr }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr }
  | { t: 'call'; callee: Expr; args: Expr[] }
  | { t: 'new'; name: string; dims: (Expr | null)[]; init: Expr[] | null; args: Expr[] }
  | { t: 'field'; target: Expr; name: string }
  | { t: 'index'; target: Expr; index: Expr }
  | { t: 'seq'; items: Expr[] };

const PRIMITIVES = new Set([
  'int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char', 'void', 'var',
]);

const BIN_LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized']);

class Parser {
  private i = 0;
  private classes: ClassDef[] = [];

  constructor(private toks: Tok[]) {}

  /* ---------- token helpers ---------- */

  private peek(offset = 0): Tok {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)];
  }

  private at(v: string): boolean {
    return this.peek().v === v;
  }

  private eat(v: string): boolean {
    if (this.at(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  private next(): Tok {
    return this.toks[this.i++];
  }

  private expect(v: string): void {
    if (!this.eat(v)) this.fail(`Expected "${v}" but found "${this.peek().v || 'end of file'}"`);
  }

  private ident(): string {
    const tok = this.peek();
    if (tok.k !== 'id') this.fail(`Expected a name but found "${tok.v || 'end of file'}"`);
    this.i++;
    return tok.v;
  }

  private fail(message: string): never {
    throw new ParseError(message, this.peek().line);
  }

  /* ---------- program ---------- */

  parseProgram(): ClassDef[] {
    while (this.peek().k !== 'eof') {
      if (this.at('import') || this.at('package')) {
        while (this.peek().k !== 'eof' && !this.at(';')) this.i++;
        this.eat(';');
        continue;
      }
      if (this.at('@')) {
        this.i++;
        this.ident();
        continue;
      }
      if (this.at('class')) {
        this.parseClass();
        continue;
      }
      this.fail(`Expected a class definition but found "${this.peek().v}"`);
    }
    return this.classes;
  }

  private parseClass(): void {
    this.expect('class');
    const cls: ClassDef = { name: this.ident(), fields: [], methods: [] };
    if (this.eat('extends')) this.ident();
    if (this.eat('implements')) {
      this.ident();
      while (this.eat(',')) this.ident();
    }
    this.expect('{');
    this.classes.push(cls);

    while (!this.at('}') && this.peek().k !== 'eof') {
      this.parseMember(cls);
    }
    this.expect('}');
  }

  private parseMember(cls: ClassDef): void {
    let isStatic = false;
    while (this.peek().k === 'id' && MODIFIERS.has(this.peek().v)) {
      if (this.peek().v === 'static') isStatic = true;
      this.i++;
    }
    if (this.at('@')) {
      this.i++;
      this.ident();
      return;
    }
    if (this.at('class')) {
      this.parseClass();
      return;
    }

    // constructor: ClassName(...)
    if (this.peek().k === 'id' && this.peek().v === cls.name && this.peek(1).v === '(') {
      const line = this.peek().line;
      const name = this.ident();
      const params = this.parseParams();
      const body = this.parseBlock();
      cls.methods.push({ name, ret: { name: 'void', dims: 0 }, params, body, line, isStatic, isCtor: true });
      return;
    }

    const { type, name } = this.parseTypeAndName();
    if (this.at('(')) {
      const line = this.peek().line;
      const params = this.parseParams();
      const body = this.parseBlock();
      cls.methods.push({ name, ret: type, params, body, line, isStatic, isCtor: false });
      return;
    }

    let init: Expr | null = null;
    if (this.eat('=')) init = this.at('{') ? this.parseArrayInit() : this.parseExpr();
    cls.fields.push({ type, name, init, isStatic });
    this.expect(';');
  }

  private parseParams(): { type: TypeRef; name: string }[] {
    this.expect('(');
    const params: { type: TypeRef; name: string }[] = [];
    if (!this.at(')')) {
      do {
        if (this.at('final')) this.i++;
        const { type, name } = this.parseTypeAndName();
        params.push({ type, name });
      } while (this.eat(','));
    }
    this.expect(')');
    return params;
  }

  private parseTypeAndName(): { type: TypeRef; name: string } {
    const type = this.parseType();
    const name = this.ident();
    while (this.at('[') && this.peek(1).v === ']') {
      this.i += 2;
      type.dims++;
    }
    return { type, name };
  }

  private parseType(): TypeRef {
    const tok = this.peek();
    if (tok.k !== 'id') this.fail('Expected a type');
    this.i++;
    let name = tok.v;
    if (!PRIMITIVES.has(name) && !/^[A-Z]/.test(name) && name !== 'var') {
      this.fail(`Unknown type "${name}"`);
    }
    if (this.at('<')) this.skipGenerics();
    let dims = 0;
    while (this.at('[') && this.peek(1).v === ']') {
      this.i += 2;
      dims++;
    }
    return { name: name === 'var' ? 'var' : name, dims };
  }

  private skipGenerics(): void {
    let depth = 0;
    do {
      if (this.at('<')) depth++;
      else if (this.at('>')) depth--;
      this.i++;
      if (this.peek().k === 'eof') this.fail('Unclosed generic type');
    } while (depth > 0);
  }

  /* ---------- statements ---------- */

  private parseBlock(): Stmt {
    const line = this.peek().line;
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.at('}') && this.peek().k !== 'eof') body.push(this.parseStmt());
    this.expect('}');
    return { t: 'block', body, line };
  }

  private tryDecl(): { type: TypeRef; name: string } | null {
    const save = this.i;
    const tok = this.peek();
    if (tok.k !== 'id') return null;
    if (!(PRIMITIVES.has(tok.v) || tok.v === 'var' || /^[A-Z]/.test(tok.v))) return null;

    try {
      const type = this.parseType();
      const nameTok = this.peek();
      if (nameTok.k !== 'id') {
        this.i = save;
        return null;
      }
      const after = this.peek(1);
      if (!['=', ';', ',', '['].includes(after.v)) {
        this.i = save;
        return null;
      }
      this.i++;
      if (after.v === '[') {
        while (this.at('[') && this.peek(1).v === ']') {
          this.i += 2;
          type.dims++;
        }
      }
      return { type, name: nameTok.v };
    } catch {
      this.i = save;
      return null;
    }
  }

  private finishDecl(type: TypeRef, name: string, line: number): Stmt {
    let init: Expr | null = null;
    if (this.eat('=')) init = this.at('{') ? this.parseArrayInit() : this.parseExpr();
    this.expect(';');
    return { t: 'vardecl', type, name, init, line };
  }

  private parseStmt(): Stmt {
    const line = this.peek().line;

    if (this.at('{')) return this.parseBlock();
    if (this.eat(';')) return { t: 'empty', line };

    if (this.at('if')) {
      this.i++;
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      const then = this.parseStmt();
      let otherwise: Stmt | null = null;
      if (this.eat('else')) otherwise = this.parseStmt();
      return { t: 'if', cond, then, else: otherwise, line };
    }

    if (this.at('while')) {
      this.i++;
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      return { t: 'while', cond, body: this.parseStmt(), line };
    }

    if (this.at('do')) {
      this.i++;
      const body = this.parseStmt();
      this.expect('while');
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      this.expect(';');
      return { t: 'dowhile', cond, body, line };
    }

    if (this.at('for')) {
      this.i++;
      this.expect('(');
      let init: Stmt | null = null;
      if (!this.at(';')) {
        const decl = this.tryDecl();
        if (decl) {
          let value: Expr | null = null;
          if (this.eat('=')) value = this.at('{') ? this.parseArrayInit() : this.parseExpr();
          init = { t: 'vardecl', type: decl.type, name: decl.name, init: value, line };
          this.expect(';');
        } else {
          const expr = this.parseExpr();
          init = { t: 'expr', expr, line };
          this.expect(';');
        }
      } else {
        this.expect(';');
      }

      let cond: Expr | null = null;
      if (!this.at(';')) cond = this.parseExpr();
      this.expect(';');

      let update: Expr | null = null;
      if (!this.at(')')) update = this.parseExprList();
      this.expect(')');

      return { t: 'for', init, cond, update, body: this.parseStmt(), line };
    }

    if (this.at('return')) {
      this.i++;
      let value: Expr | null = null;
      if (!this.at(';')) value = this.parseExpr();
      this.expect(';');
      return { t: 'return', value, line };
    }

    if (this.at('break')) {
      this.i++;
      this.expect(';');
      return { t: 'break', line };
    }

    if (this.at('continue')) {
      this.i++;
      this.expect(';');
      return { t: 'continue', line };
    }

    const decl = this.tryDecl();
    if (decl) {
      const first = this.finishDecl(decl.type, decl.name, line) as Extract<Stmt, { t: 'vardecl' }>;
      const extra: Stmt[] = [first];
      // `int a = 1, b = 2;` — finishDecl already consumed the ';', so handle commas inline
      return extra.length === 1 ? first : { t: 'block', body: extra, line };
    }

    const expr = this.parseExpr();
    this.expect(';');
    return { t: 'expr', expr, line };
  }

  /* ---------- expressions ---------- */

  private parseExpr(): Expr {
    return this.parseAssign();
  }

  private parseExprList(): Expr {
    const items = [this.parseAssign()];
    while (this.eat(',')) items.push(this.parseAssign());
    return items.length === 1 ? items[0] : { t: 'seq', items };
  }

  private parseAssign(): Expr {
    const left = this.parseTernary();
    if (ASSIGN_OPS.has(this.peek().v)) {
      const op = this.next().v;
      const value = this.parseAssign();
      return { t: 'assign', op, target: left, value };
    }
    return left;
  }

  private parseTernary(): Expr {
    const c = this.parseBinary(0);
    if (this.eat('?')) {
      const a = this.parseAssign();
      this.expect(':');
      const b = this.parseAssign();
      return { t: 'cond', c, a, b };
    }
    return c;
  }

  private parseBinary(level: number): Expr {
    if (level >= BIN_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    while (this.peek().k === 'op' && BIN_LEVELS[level].includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseBinary(level + 1);
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.at('!') || this.at('-') || this.at('+')) {
      const op = this.next().v;
      return { t: 'un', op, e: this.parseUnary(), prefix: true };
    }
    if (this.at('++') || this.at('--')) {
      const op = this.next().v;
      return { t: 'un', op, e: this.parseUnary(), prefix: true };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('.')) {
        this.i++;
        const name = this.ident();
        if (this.at('(')) {
          expr = { t: 'call', callee: { t: 'field', target: expr, name }, args: this.parseArgs() };
        } else {
          expr = { t: 'field', target: expr, name };
        }
        continue;
      }
      if (this.at('[')) {
        this.i++;
        const index = this.parseExpr();
        this.expect(']');
        expr = { t: 'index', target: expr, index };
        continue;
      }
      if (this.at('++') || this.at('--')) {
        const op = this.next().v;
        expr = { t: 'un', op, e: expr, prefix: false };
        continue;
      }
      break;
    }
    return expr;
  }

  private parseArgs(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    if (!this.at(')')) {
      do {
        args.push(this.parseAssign());
      } while (this.eat(','));
    }
    this.expect(')');
    return args;
  }

  private parseArrayInit(): Expr {
    this.expect('{');
    const items: Expr[] = [];
    if (!this.at('}')) {
      do {
        items.push(this.at('{') ? this.parseArrayInit() : this.parseAssign());
      } while (this.eat(','));
    }
    this.expect('}');
    return { t: 'new', name: '', dims: [], init: items, args: [] };
  }

  private parseNew(): Expr {
    const name = this.ident();
    if (this.at('<')) this.skipGenerics();
    const dims: (Expr | null)[] = [];
    while (this.at('[')) {
      this.i++;
      if (this.at(']')) {
        dims.push(null);
        this.i++;
      } else {
        const size = this.parseExpr();
        this.expect(']');
        dims.push(size);
      }
    }
    if (this.at('{')) {
      const init = this.parseArrayInit();
      return { t: 'new', name, dims, init: (init as Extract<Expr, { t: 'new' }>).init, args: [] };
    }
    const args = this.at('(') ? this.parseArgs() : [];
    return { t: 'new', name, dims, init: null, args };
  }

  private parsePrimary(): Expr {
    const tok = this.peek();

    if (tok.k === 'num') {
      this.i++;
      return { t: 'num', v: Number(tok.v.replace(/[LlFfDd]$/, '')), isDouble: !!tok.isDouble };
    }
    if (tok.k === 'str') {
      this.i++;
      return { t: 'str', v: tok.v };
    }
    if (tok.k === 'chr') {
      this.i++;
      return { t: 'char', v: tok.v };
    }
    if (tok.v === 'true' || tok.v === 'false') {
      this.i++;
      return { t: 'bool', v: tok.v === 'true' };
    }
    if (tok.v === 'null') {
      this.i++;
      return { t: 'null' };
    }
    if (tok.v === 'this') {
      this.i++;
      return { t: 'this' };
    }
    if (tok.v === 'new') {
      this.i++;
      return this.parseNew();
    }
    if (tok.v === '(') {
      this.i++;
      const inner = this.parseExpr();
      this.expect(')');
      return inner;
    }
    if (tok.k === 'id') {
      this.i++;
      if (this.at('(')) return { t: 'call', callee: { t: 'id', name: tok.v }, args: this.parseArgs() };
      return { t: 'id', name: tok.v };
    }

    this.fail(`Unexpected token "${tok.v || 'end of file'}"`);
  }
}

/** Source-ish rendering of an expression, used in step notes. */
export function src(e: Expr): string {
  switch (e.t) {
    case 'num':
      return String(e.v);
    case 'str':
      return `"${e.v}"`;
    case 'char':
      return `'${e.v}'`;
    case 'bool':
      return String(e.v);
    case 'null':
      return 'null';
    case 'id':
      return e.name;
    case 'this':
      return 'this';
    case 'bin':
      return `${src(e.l)} ${e.op} ${src(e.r)}`;
    case 'un':
      return e.prefix ? `${e.op}${src(e.e)}` : `${src(e.e)}${e.op}`;
    case 'assign':
      return `${src(e.target)} ${e.op} ${src(e.value)}`;
    case 'cond':
      return `${src(e.c)} ? ${src(e.a)} : ${src(e.b)}`;
    case 'call':
      return `${src(e.callee)}(${e.args.map(src).join(', ')})`;
    case 'field':
      return `${src(e.target)}.${e.name}`;
    case 'index':
      return `${src(e.target)}[${src(e.index)}]`;
    case 'new': {
      if (e.init) return `{...}`;
      const dims = e.dims.map((d) => `[${d ? src(d) : ''}]`).join('');
      return `new ${e.name}${dims}${e.args.length ? `(${e.args.map(src).join(', ')})` : ''}`;
    }
    case 'seq':
      return e.items.map(src).join(', ');
    default:
      return '?';
  }
}

export function parseJava(source: string): ClassDef[] {
  const toks = lex(source);
  return new Parser(toks).parseProgram();
}
