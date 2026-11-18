import { ParseError } from './types';
import { lex, type Tok } from './lexer';

export type TypeRef = { name: string; dims: number };

export type ClassDef = {
  name: string;
  /** `Outer.Node` for a nested type, so both names can resolve */
  qualified?: string;
  kind: 'class' | 'interface' | 'enum' | 'record';
  parent?: string;
  interfaces: string[];
  fields: { type: TypeRef; name: string; init: Expr | null; isStatic: boolean }[];
  methods: MethodDef[];
  /** enum constants in declaration order */
  constants?: string[];
  /** `static { … }` blocks, run when the class is first touched */
  staticInit?: Stmt[];
  /** `{ … }` blocks, run on every instance before the constructor body */
  instanceInit?: Stmt[];
};

export type SwitchGroup = { tests: Expr[]; def: boolean; arrow: boolean; body: Stmt[] };
export type SwitchArm = { tests: Expr[]; def: boolean; value: Expr | null; body: Stmt | null };

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
  | { t: 'foreach'; type: TypeRef; name: string; iter: Expr; body: Stmt; line: number }
  | { t: 'return'; value: Expr | null; line: number }
  | { t: 'break'; line: number }
  | { t: 'continue'; line: number }
  | { t: 'switch'; sel: Expr; groups: SwitchGroup[]; line: number }
  | { t: 'try'; body: Stmt; catches: { type: string; param: string; body: Stmt }[]; fin: Stmt | null; line: number }
  | { t: 'throw'; value: Expr; line: number }
  | { t: 'yield'; value: Expr | null; line: number }
  | { t: 'empty'; line: number };

export type Expr =
  | { t: 'num'; v: number; isDouble: boolean; isLong?: boolean }
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
  | { t: 'seq'; items: Expr[] }
  | { t: 'lam'; params: string[]; body: Expr | Stmt; block: boolean; line: number }
  | { t: 'mref'; target: Expr; name: string }
  | { t: 'switch'; sel: Expr; arms: SwitchArm[] }
  | { t: 'super' }
  | { t: 'cast'; type: TypeRef; e: Expr };

const PRIMITIVES = new Set([
  'int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char', 'void', 'var',
]);

const BIN_LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>=', 'instanceof'], ['+', '-'], ['*', '/', '%']];

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

const MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized',
  'default', 'native', 'transient', 'volatile', 'strictfp',
]);

/** modifiers that may sit in front of a top-level class */
const CLASS_MODIFIERS = new Set(['public', 'final', 'abstract', 'strictfp', 'sealed']);

class Parser {
  private i = 0;
  private classes: ClassDef[] = [];
  /** non-zero while parsing `case` labels, where `->` is not a lambda */
  private caseLabel = 0;
  /** names of the classes we are currently inside, for qualified nested types */
  private enclosing: string[] = [];

  constructor(private toks: Tok[]) {}

  /* ---------- token helpers ---------- */

  private peek(offset = 0): Tok {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)];
  }

  private at(v: string): boolean {
    const tok = this.peek();
    // a string or char literal that happens to contain an operator character
    // (`"-"`, `"("`) is a value, never punctuation
    return tok.v === v && tok.k !== 'str' && tok.k !== 'chr';
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
        this.skipAnnotation();
        continue;
      }
      // `public class Main` and friends: the modifiers change nothing here
      if (this.peek().k === 'id' && CLASS_MODIFIERS.has(this.peek().v)) {
        this.i++;
        continue;
      }
      if (this.at('class') || this.at('interface') || this.at('enum') || this.at('record')) {
        this.parseTypeDecl();
        continue;
      }
      this.fail(`Expected a class definition but found "${this.peek().v}"`);
    }
    return this.classes;
  }

  /** `@Override`, `@SuppressWarnings("unchecked")` — annotations carry no meaning for the trace */
  private skipAnnotation(): void {
    this.i++; // '@'
    if (this.peek().k === 'id') this.i++;
    if (this.at('(')) {
      let depth = 0;
      do {
        if (this.at('(')) depth++;
        else if (this.at(')')) depth--;
        this.i++;
      } while (depth > 0 && this.peek().k !== 'eof');
    }
  }

  /** class / interface / enum / record — the header differs, the members do not */
  private parseTypeDecl(): void {
    const keyword = this.peek().v;
    this.i++;
    if (keyword === 'record') {
      this.parseRecord();
      return;
    }
    const cls: ClassDef = {
      name: this.ident(),
      kind: keyword === 'enum' ? 'enum' : keyword === 'interface' ? 'interface' : 'class',
      interfaces: [],
      fields: [],
      methods: [],
    };
    if (this.enclosing.length) cls.qualified = [...this.enclosing, cls.name].join('.');
    if (this.eat('extends')) {
      const parent = this.dottedName();
      // an interface extends other interfaces; a class extends one superclass
      if (cls.kind === 'interface') cls.interfaces.push(parent);
      else cls.parent = parent;
    }
    if (this.eat('implements')) {
      cls.interfaces.push(this.dottedName());
      while (this.eat(',')) cls.interfaces.push(this.dottedName());
    }
    this.expect('{');
    this.classes.push(cls);
    if (cls.kind === 'enum') this.parseEnumConstants(cls);

    this.enclosing.push(cls.name);
    while (!this.at('}') && this.peek().k !== 'eof') {
      this.parseMember(cls);
    }
    this.enclosing.pop();
    this.expect('}');
  }

  private dottedName(): string {
    let name = this.ident();
    while (this.at('.') && this.peek(1).k === 'id') {
      this.i++;
      name += '.' + this.ident();
    }
    if (this.at('<')) this.skipGenerics();
    return name;
  }

  /** `enum Size { SMALL, LARGE(3); … }` — constants, then ordinary members */
  private parseEnumConstants(cls: ClassDef): void {
    const names: string[] = [];
    while (!this.at(';') && !this.at('}') && this.peek().k !== 'eof') {
      if (this.peek().k === 'id') {
        names.push(this.ident());
        if (this.at('(')) this.skipBalanced('(', ')');
        if (this.at('{')) this.skipBalanced('{', '}');
      } else {
        this.i++;
      }
      if (!this.eat(',')) break;
    }
    cls.constants = names;
    this.eat(';');
  }

  private skipBalanced(open: string, close: string): void {
    let depth = 0;
    do {
      if (this.at(open)) depth++;
      else if (this.at(close)) depth--;
      this.i++;
      if (this.peek().k === 'eof') this.fail(`Unclosed "${open}"`);
    } while (depth > 0);
  }

  /** `record Point(int x, int y)` is a final class: fields, a constructor and accessors */
  private parseRecord(): void {
    const name = this.ident();
    this.expect('(');
    const params: { type: TypeRef; name: string }[] = [];
    if (!this.at(')')) {
      do {
        const { type, name: paramName } = this.parseTypeAndName();
        params.push({ type, name: paramName });
      } while (this.eat(','));
    }
    this.expect(')');

    const body = (statements: Stmt[]) => ({ t: 'block' as const, body: statements, line: 0 });
    const cls: ClassDef = {
      name,
      kind: 'record',
      interfaces: [],
      fields: params.map((param) => ({ type: param.type, name: param.name, init: null, isStatic: false })),
      methods: [
        {
          name,
          ret: { name: 'void', dims: 0 },
          params: [...params],
          body: body(
            params.map((param) => ({
              t: 'expr' as const,
              line: 0,
              expr: { t: 'assign' as const, op: '=', target: { t: 'field' as const, target: { t: 'this' as const }, name: param.name }, value: { t: 'id' as const, name: param.name } },
            }))
          ),
          line: 0,
          isStatic: false,
          isCtor: true,
        },
        ...params.map((param) => ({
          name: param.name,
          ret: param.type,
          params: [] as { type: TypeRef; name: string }[],
          body: body([{ t: 'return' as const, line: 0, value: { t: 'field' as const, target: { t: 'this' as const }, name: param.name } }]),
          line: 0,
          isStatic: false,
          isCtor: false,
        })),
      ],
    };
    if (this.eat('implements')) {
      cls.interfaces.push(this.dottedName());
      while (this.eat(',')) cls.interfaces.push(this.dottedName());
    }
    this.expect('{');
    this.classes.push(cls);
    while (!this.at('}') && this.peek().k !== 'eof') this.parseMember(cls);
    this.expect('}');
  }

  private parseMember(cls: ClassDef): void {
    let isStatic = false;
    while (this.peek().k === 'id' && MODIFIERS.has(this.peek().v)) {
      if (this.peek().v === 'static') isStatic = true;
      this.i++;
    }
    if (this.at('@')) {
      this.skipAnnotation();
      return;
    }
    if (this.at('class') || this.at('interface') || this.at('enum') || this.at('record')) {
      this.parseTypeDecl();
      return;
    }

    // initializer block: `static { … }` or plain `{ … }`
    if (this.at('{')) {
      const block = this.parseBlock();
      const target = isStatic ? 'staticInit' : 'instanceInit';
      (cls[target] ??= []).push(block);
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
      // interface and abstract methods end at the semicolon
      if (this.eat(';')) {
        cls.methods.push({ name, ret: type, params, body: { t: 'block', body: [], line }, line, isStatic, isCtor: false });
        return;
      }
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
    // `String... args` is just `String[] args`
    if (this.at('...')) {
      this.i++;
      type.dims = Math.max(1, type.dims + 1);
    }
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
    // `Map.Entry<String, Integer>` is one dotted type name
    while (this.at('.') && this.peek(1).k === 'id') {
      this.i++;
      name += '.' + this.ident();
    }
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
      // `List<List<Integer>>` closes two levels with the single token `>>`
      if (this.at('<')) depth++;
      else if (this.at('>>>')) depth -= 3;
      else if (this.at('>>')) depth -= 2;
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
      if (!['=', ';', ',', '[', ':'].includes(after.v)) {
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
    // `int a = 1, b = 2;` declares several names with one type
    const decls: Stmt[] = [];
    let current = { type, name };
    for (;;) {
      let init: Expr | null = null;
      if (this.eat('=')) init = this.at('{') ? this.parseArrayInit() : this.parseExpr();
      decls.push({ t: 'vardecl', type: current.type, name: current.name, init, line });
      if (!this.eat(',')) break;
      const tok = this.peek();
      if (tok.k !== 'id') this.fail('Expected another variable name');
      this.i++;
      current = { type: current.type, name: tok.v };
    }
    this.expect(';');
    return decls.length === 1 ? decls[0] : { t: 'block', body: decls, line };
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

      // enhanced for: for (int v : values)
      const head = this.tryDecl();
      if (head && this.at(':')) {
        this.i++; // ':'
        const iter = this.parseExpr();
        this.expect(')');
        return { t: 'foreach', type: head.type, name: head.name, iter, body: this.parseStmt(), line };
      }

      let init: Stmt | null = null;
      if (!this.at(';')) {
        const decl = head;
        if (decl) {
          // `for (int i = 0, j = n - 1; …)` declares more than one variable
          const decls: Stmt[] = [];
          let current: { type: TypeRef; name: string } | null = decl;
          for (;;) {
            let value: Expr | null = null;
            if (this.eat('=')) value = this.at('{') ? this.parseArrayInit() : this.parseExpr();
            decls.push({ t: 'vardecl', type: current!.type, name: current!.name, init: value, line });
            if (!this.eat(',')) break;
            // `int i = 0, j = n - 1` — the type is implied for later names
            const nameTok = this.peek();
            if (nameTok.k !== 'id') this.fail('Expected another variable name');
            this.i++;
            current = { type: current!.type, name: nameTok.v };
          }
          init = decls.length === 1 ? decls[0] : { t: 'block', body: decls, line };
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

    if (this.at('switch')) return this.parseSwitchStmt();

    if (this.at('try')) {
      this.i++;
      const body = this.at('{') ? this.parseBlock() : this.parseStmt();
      const catches: { type: string; param: string; body: Stmt }[] = [];
      while (this.at('catch')) {
        this.i++;
        this.expect('(');
        const names: string[] = [];
        while (!this.at(')') && this.peek().k !== 'eof') {
          const tok = this.next();
          if (tok.k === 'id') names.push(tok.v);
        }
        this.expect(')');
        const param = names.length >= 2 ? names[names.length - 1] : 'e';
        const type = names.find((n) => n !== param) ?? 'Exception';
        catches.push({ type, param, body: this.parseBlock() });
      }
      let fin: Stmt | null = null;
      if (this.eat('finally')) fin = this.parseBlock();
      if (!catches.length && !fin) this.fail('try needs a catch or finally');
      return { t: 'try', body, catches, fin, line };
    }

    if (this.at('throw')) {
      this.i++;
      const value = this.parseExpr();
      this.expect(';');
      return { t: 'throw', value, line };
    }

    // only legal inside a block-bodied switch arm
    if (this.at('yield')) {
      this.i++;
      if (this.eat(';')) return { t: 'yield', value: null, line };
      const value = this.parseExpr();
      this.expect(';');
      return { t: 'yield', value, line };
    }

    const decl = this.tryDecl();
    if (decl) return this.finishDecl(decl.type, decl.name, line);

    const expr = this.parseExpr();
    this.expect(';');
    return { t: 'expr', expr, line };
  }

  /* ---------- switch ---------- */

  private parseSwitchStmt(): Stmt {
    const line = this.peek().line;
    this.expect('switch');
    this.expect('(');
    const sel = this.parseExpr();
    this.expect(')');
    this.expect('{');
    const groups: SwitchGroup[] = [];

    while (!this.at('}') && this.peek().k !== 'eof') {
      const { tests, def } = this.parseCaseLabels();
      if (this.eat('->')) {
        const body: Stmt[] = this.at('{') ? [this.parseBlock()] : [this.parseStmt()];
        groups.push({ tests, def, arrow: true, body });
      } else {
        this.expect(':');
        const body: Stmt[] = [];
        while (!this.at('}') && !this.at('case') && !this.at('default') && this.peek().k !== 'eof') {
          body.push(this.parseStmt());
        }
        groups.push({ tests, def, arrow: false, body });
      }
    }
    this.expect('}');
    return { t: 'switch', sel, groups, line };
  }

  private parseSwitchExpr(): Expr {
    this.expect('switch');
    this.expect('(');
    const sel = this.parseExpr();
    this.expect(')');
    this.expect('{');
    const arms: SwitchArm[] = [];
    while (!this.at('}') && this.peek().k !== 'eof') {
      const { tests, def } = this.parseCaseLabels();
      if (!this.eat('->')) this.fail('switch expressions need "case X -> value" arms');
      if (this.at('{')) {
        arms.push({ tests, def, value: null, body: this.parseBlock() });
      } else {
        const value = this.parseExpr();
        this.expect(';');
        arms.push({ tests, def, value, body: null });
      }
    }
    this.expect('}');
    return { t: 'switch', sel, arms };
  }

  private parseCaseLabels(): { tests: Expr[]; def: boolean } {
    if (this.eat('default')) return { tests: [], def: true };
    this.expect('case');
    this.caseLabel++;
    try {
      const tests = [this.parseTernary()];
      while (this.eat(',')) tests.push(this.parseTernary());
      return { tests, def: false };
    } finally {
      this.caseLabel--;
    }
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
    // `instanceof` is a keyword token, not a punctuation operator
    while ((this.peek().k === 'op' || this.peek().v === 'instanceof') && BIN_LEVELS[level].includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseBinary(level + 1);
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }

  private parseUnary(): Expr {
    // cast: (int) expr, (double) count, (String) value
    if (this.at('(') && this.castAhead()) {
      this.i++;
      const type = this.parseType();
      this.expect(')');
      return { t: 'cast', type, e: this.parseUnary() };
    }
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
        // `Type.<T>method(...)`
        if (this.at('<') && this.typeArgsAhead()) this.skipGenerics();
        let name = this.ident();
        // explicit type arguments: `Map.Entry.<String, Integer>comparingByValue()`
        if (this.at('<') && this.typeArgsAhead()) {
          this.skipGenerics();
          name = this.ident();
        }
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
      if (this.at('::')) {
        this.i++;
        const name = this.ident();
        expr = { t: 'mref', target: expr, name };
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

  /** true when `<` here opens type arguments of a method call, not a comparison */
  private typeArgsAhead(): boolean {
    let depth = 0;
    for (let k = this.i; k < Math.min(this.toks.length, this.i + 48); k++) {
      const v = this.toks[k].v;
      if (this.toks[k].k === 'eof') return false;
      if (v === '<') depth++;
      else if (v === '>') depth--;
      else if (v === '>>') depth -= 2;
      else if (v === '>>>') depth -= 3;
      else if (depth === 0) return false;
      if (depth <= 0) {
        const next = this.toks[k + 1];
        if (next?.v === '(') return true;
        // `.<T>method(` puts the method name between the type args and the call
        return next?.k === 'id' && this.toks[k + 2]?.v === '(';
      }
    }
    return false;
  }

  /** index of the `)` matching the `(` at `start`, or -1 */
  private matchParenAt(start: number): number {
    let depth = 0;
    for (let k = start; k < this.toks.length; k++) {
      const v = this.toks[k].v;
      if (this.toks[k].k === 'eof') return -1;
      if (v === '(') depth++;
      else if (v === ')') {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  private castAhead(): boolean {
    const name = this.peek(1);
    const close = this.peek(2);
    const next = this.peek(3);
    if (name.k !== 'id') return false;
    const known = PRIMITIVES.has(name.v) || /^[A-Z]/.test(name.v);
    return known && close.v === ')' && next.k !== 'eof' && next.v !== '->';
  }

  private lambdaAhead(): boolean {
    const end = this.matchParenAt(this.i);
    return end > 0 && this.toks[end + 1]?.v === '->';
  }

  private parseLambda(): Expr {
    const line = this.peek().line;
    const params: string[] = [];
    this.expect('(');
    if (!this.at(')')) {
      do {
        if (this.peek().v === 'final') this.i++;
        // optional parameter type: (int a) / (String s)
        if (this.peek().k === 'id' && this.peek(1).k === 'id') this.i++;
        params.push(this.ident());
      } while (this.eat(','));
    }
    this.expect(')');
    this.expect('->');
    const { body, block } = this.parseLambdaBody();
    return { t: 'lam', params, body, block, line };
  }

  private parseLambdaBody(): { body: Expr | Stmt; block: boolean } {
    if (this.at('{')) return { body: this.parseBlock(), block: true };
    return { body: this.parseAssign(), block: false };
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
    let name = this.ident();
    // `new Outer.Node()`
    while (this.at('.') && this.peek(1).k === 'id') {
      this.i++;
      name += '.' + this.ident();
    }
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
      const isDouble = !!tok.isDouble;
      const isRadix = /^0[xXbB]/.test(tok.v);
      const isLong = !isDouble && !isRadix && /[Ll]$/.test(tok.v);
      // `0xFF` ends in an F that is a digit, not a float suffix
      const digits = (isRadix ? tok.v : tok.v.replace(/[LlFfDd]$/, '')).replace(/_/g, '');
      return { t: 'num', v: Number(digits), isDouble, isLong };
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
    if (tok.v === 'super') {
      this.i++;
      // super(...) is a constructor call on the parent
      if (this.at('(')) return { t: 'call', callee: { t: 'super' }, args: this.parseArgs() };
      return { t: 'super' };
    }
    if (tok.v === 'switch') return this.parseSwitchExpr();
    if (tok.v === 'new') {
      this.i++;
      return this.parseNew();
    }
    if (tok.v === '(') {
      if (this.lambdaAhead()) return this.parseLambda();
      this.i++;
      const inner = this.parseExpr();
      this.expect(')');
      return inner;
    }
    if (tok.k === 'id') {
      this.i++;
      // `case RED ->` is a switch label, not a lambda
      if (this.at('->') && !this.caseLabel) {
        this.i++;
        const { body, block } = this.parseLambdaBody();
        return { t: 'lam', params: [tok.v], body, block, line: tok.line };
      }
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
    case 'lam':
      return `${e.params.length === 1 ? e.params[0] : `(${e.params.join(', ')})`} -> ${e.block ? '{ … }' : src(e.body as Expr)}`;
    case 'mref':
      return `${src(e.target)}::${e.name}`;
    case 'cast':
      return `(${e.type.name}${'[]'.repeat(e.type.dims)}) ${src(e.e)}`;
    case 'super':
      return 'super';
    case 'switch':
      return `switch (${src(e.sel)})`;
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
