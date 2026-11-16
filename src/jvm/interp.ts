import { parseJava, src, type ClassDef, type Expr, type MethodDef, type Stmt, type TypeRef } from './parser';
import { ParseError } from './types';
import type { Effect, HeapObj, StepKind, Trace, TraceFrame, TraceObj, TraceStep, TraceVal, Val } from './types';

const MAX_STEPS = 4000;
const MAX_DEPTH = 90;
const MAX_HEAP_OBJECTS = 300;
const MAX_ARRAY = 400;

const INT = (v: number): Val => ({ t: 'int', v: Math.trunc(v) });
const DBL = (v: number): Val => ({ t: 'double', v });
const BOOL = (v: boolean): Val => ({ t: 'bool', v });
const STR = (v: string): Val => ({ t: 'str', v });
const CHR = (v: string): Val => ({ t: 'char', v });
const NULLV: Val = { t: 'null' };

/** Names that behave like static namespaces even though they are not user classes. */
const BUILTIN_NS = new Set([
  'System', 'Math', 'Integer', 'Arrays', 'Character', 'String', 'Collections',
  'ArrayList', 'List', 'Map', 'HashMap', 'Double', 'Long', 'Boolean', 'Objects',
]);

class RuntimeError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

class ReturnSignal {
  constructor(public value: Val) {}
}
class BreakSignal {}
class ContinueSignal {}

type VarSlot = { type: TypeRef; value: Val; prev?: Val };
type Frame = {
  id: number;
  owner: string;
  method: string;
  line: number;
  vars: Map<string, VarSlot>;
  thisVal: Val | null;
};

function typeName(type: TypeRef): string {
  return type.name + '[]'.repeat(type.dims);
}

class Machine {
  private classMap = new Map<string, ClassDef>();
  private heap = new Map<number, HeapObj>();
  private nextId = 1;
  private frames: Frame[] = [];
  private frameSeq = 0;
  private statics = new Map<string, Map<string, VarSlot>>();
  private staticReady = new Set<string>();
  private out = '';
  private steps: TraceStep[] = [];
  private effects: Effect[] = [];
  private entry = '';

  constructor(private classes: ClassDef[]) {
    for (const cls of classes) this.classMap.set(cls.name, cls);
  }

  /* ---------- trace ---------- */

  private top(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  private snap(kind: StepKind, note: string): void {
    const line = this.top()?.line ?? 0;
    if (this.steps.length >= MAX_STEPS) {
      throw new RuntimeError(`Step limit (${MAX_STEPS}) reached — is there an infinite loop?`, line);
    }
    this.steps.push({
      line,
      kind,
      note,
      stack: this.serializeFrames(),
      heap: this.serializeHeap(),
      stdout: this.out,
      effects: this.effects,
    });
    this.effects = [];
  }

  private serializeFrames(): TraceFrame[] {
    return this.frames.map((f) => ({
      id: f.id,
      method: f.method,
      owner: f.owner,
      line: f.line,
      thisRef: f.thisVal && f.thisVal.t === 'ref' ? this.toTrace(f.thisVal) : undefined,
      vars: [...f.vars.entries()].map(([name, slot]) => ({
        name,
        type: typeName(slot.type),
        value: this.toTrace(slot.value),
        prev: slot.prev ? this.toTrace(slot.prev) : undefined,
      })),
    }));
  }

  private serializeHeap(): TraceObj[] {
    const out: TraceObj[] = [];
    for (const obj of this.heap.values()) {
      if (out.length >= 70) break;
      if (obj.kind === 'array') {
        out.push({
          id: obj.id,
          kind: 'array',
          label: `${obj.elemType}[${obj.cells.length}]`,
          type: obj.elemType,
          cells: obj.cells.map((c) => this.toTrace(c)),
        });
      } else if (obj.kind === 'list') {
        out.push({
          id: obj.id,
          kind: 'list',
          label: `ArrayList<${obj.elemType}>[${obj.items.length}]`,
          type: `ArrayList<${obj.elemType}>`,
          cells: obj.items.map((c) => this.toTrace(c)),
        });
      } else {
        out.push({
          id: obj.id,
          kind: 'object',
          label: obj.className,
          type: obj.className,
          cells: [],
          fields: obj.fields.map((f) => ({ name: f.name, value: this.toTrace(f.value) })),
        });
      }
    }
    return out;
  }

  private toTrace(v: Val): TraceVal {
    if (v.t === 'ref') return { kind: 'ref', id: v.id, type: this.refLabel(v.id) };
    if (v.t === 'null') return { kind: 'null', type: 'null' };
    if (v.t === 'ns') return { kind: 'ns', text: v.name, type: v.name };
    let text = '?';
    if (v.t === 'str') text = `"${v.v}"`;
    else if (v.t === 'char') text = `'${v.v}'`;
    else if (v.t === 'bool' || v.t === 'int' || v.t === 'double') text = String(v.v);
    return { kind: 'prim', text, type: v.t };
  }

  /* ---------- text helpers ---------- */

  private refLabel(id: number): string {
    const o = this.heap.get(id);
    if (!o) return `@${id}`;
    if (o.kind === 'array') return `${o.elemType}[${o.cells.length}]`;
    if (o.kind === 'list') return `ArrayList`;
    return o.className;
  }

  private str(v: Val): string {
    switch (v.t) {
      case 'int':
        return String(v.v);
      case 'double':
        return Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v);
      case 'bool':
        return String(v.v);
      case 'char':
      case 'str':
        return v.v;
      case 'null':
        return 'null';
      case 'ref':
        return `${this.refLabel(v.id)}@${v.id}`;
      default:
        return '?';
    }
  }

  private text(v: Val): string {
    if (v.t === 'str') return `"${v.v}"`;
    if (v.t === 'char') return `'${v.v}'`;
    return this.str(v);
  }

  /* ---------- heap ---------- */

  private alloc(partial: any): any {
    if (this.heap.size >= MAX_HEAP_OBJECTS) {
      throw new RuntimeError(`Too many heap objects (${MAX_HEAP_OBJECTS})`, this.top()?.line ?? 0);
    }
    const id = this.nextId++;
    const obj = { ...partial, id };
    this.heap.set(id, obj);
    return obj;
  }

  private defaultFor(type: TypeRef): Val {
    if (type.dims > 0) return NULLV;
    switch (type.name) {
      case 'int':
      case 'long':
      case 'short':
      case 'byte':
        return INT(0);
      case 'double':
      case 'float':
        return DBL(0);
      case 'boolean':
        return BOOL(false);
      case 'char':
        return CHR('\0');
      default:
        return NULLV;
    }
  }

  private coerce(type: TypeRef, v: Val): Val {
    if (type.dims > 0) return v;
    switch (type.name) {
      case 'int':
      case 'long':
      case 'short':
      case 'byte':
        if (v.t === 'double') return INT(v.v);
        if (v.t === 'char') return INT(v.v.charCodeAt(0));
        return v;
      case 'double':
      case 'float':
        if (v.t === 'int') return DBL(v.v);
        if (v.t === 'char') return DBL(v.v.charCodeAt(0));
        return v;
      case 'char':
        if (v.t === 'int') return CHR(String.fromCharCode(v.v));
        return v;
      default:
        return v;
    }
  }

  private inferType(v: Val): TypeRef {
    if (v.t === 'ref') {
      const o = this.heap.get(v.id);
      if (o?.kind === 'array') return { name: o.elemType, dims: 1 };
      if (o?.kind === 'object') return { name: o.className, dims: 0 };
      return { name: 'Object', dims: 0 };
    }
    return { name: v.t === 'bool' ? 'boolean' : v.t === 'char' ? 'char' : v.t, dims: 0 };
  }

  /* ---------- statics ---------- */

  private ensureStatics(cls: ClassDef): void {
    if (this.staticReady.has(cls.name)) return;
    this.staticReady.add(cls.name);
    const store = new Map<string, VarSlot>();
    this.statics.set(cls.name, store);
    for (const field of cls.fields) {
      if (!field.isStatic) continue;
      const value = field.init ? this.eval(field.init) : this.defaultFor(field.type);
      store.set(field.name, { type: field.type, value: this.coerce(field.type, value) });
    }
  }

  private staticSlot(className: string, name: string): VarSlot | undefined {
    const cls = this.classMap.get(className);
    if (!cls) return undefined;
    this.ensureStatics(cls);
    return this.statics.get(className)?.get(name);
  }

  /* ---------- entry ---------- */

  run(): Trace {
    const mainCls = this.classes.find((c) => c.methods.some((m) => m.name === 'main'));
    if (!mainCls) {
      return { steps: [], stdout: '', heap: [], error: 'No main method found. Add: public static void main(String[] args).' };
    }
    const main = mainCls.methods.find((m) => m.name === 'main')!;
    this.entry = mainCls.name;

    const argsArray = this.alloc({ kind: 'array', elemType: 'String', cells: [], dims: [0] });

    try {
      this.invoke(mainCls, main, null, [{ t: 'ref', id: argsArray.id }]);
      this.snap('end', 'Program finished.');
    } catch (e) {
      if (e instanceof RuntimeError) {
        this.steps.push({
          line: e.line,
          kind: 'error',
          note: `${e.message}`,
          stack: this.serializeFrames(),
          heap: this.serializeHeap(),
          stdout: this.out,
          effects: [],
        });
        return { steps: this.steps, stdout: this.out, heap: this.serializeHeap(), error: e.message, entry: this.entry };
      }
      throw e;
    }

    return { steps: this.steps, stdout: this.out, heap: this.serializeHeap(), entry: this.entry };
  }

  /* ---------- statements ---------- */

  private exec(s: Stmt): void {
    switch (s.t) {
      case 'block':
        for (const st of s.body) this.exec(st);
        return;

      case 'empty':
        return;

      case 'vardecl': {
        const frame = this.top()!;
        frame.line = s.line;
        const raw = s.init ? this.eval(s.init) : this.defaultFor(s.type);
        const type = s.type.name === 'var' ? this.inferType(raw) : s.type;
        const value = this.coerce(type, raw);
        const existing = frame.vars.get(s.name);
        if (existing) {
          existing.prev = existing.value;
          existing.value = value;
          existing.type = type;
        } else {
          frame.vars.set(s.name, { type, value });
        }
        this.snap('stmt', `${s.name} = ${this.text(value)}   (${typeName(type)})`);
        return;
      }

      case 'expr': {
        this.top()!.line = s.line;
        this.eval(s.expr);
        this.snap(this.effects.length ? 'write' : 'stmt', src(s.expr));
        return;
      }

      case 'if': {
        this.top()!.line = s.line;
        const cond = this.truthy(this.eval(s.cond));
        this.snap('stmt', `if (${src(s.cond)}) → ${cond}`);
        this.exec(cond ? s.then : s.else ?? { t: 'empty', line: s.line });
        return;
      }

      case 'while': {
        for (;;) {
          this.top()!.line = s.line;
          const cond = this.truthy(this.eval(s.cond));
          this.snap('stmt', `while (${src(s.cond)}) → ${cond}`);
          if (!cond) return;
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (!(e instanceof ContinueSignal)) throw e;
          }
        }
      }

      case 'dowhile': {
        for (;;) {
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          this.top()!.line = s.line;
          const cond = this.truthy(this.eval(s.cond));
          this.snap('stmt', `while (${src(s.cond)}) → ${cond}`);
          if (!cond) return;
        }
      }

      case 'for': {
        if (s.init) this.exec(s.init);
        for (;;) {
          this.top()!.line = s.line;
          const cond = s.cond ? this.truthy(this.eval(s.cond)) : true;
          if (s.cond) this.snap('stmt', `for (…; ${src(s.cond)}; …) → ${cond}`);
          if (!cond) return;
          try {
            this.exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          if (s.update) this.eval(s.update);
        }
      }

      case 'return': {
        this.top()!.line = s.line;
        const value = s.value ? this.eval(s.value) : NULLV;
        this.snap('stmt', `return ${this.text(value)}`);
        throw new ReturnSignal(value);
      }

      case 'break':
        throw new BreakSignal();

      case 'continue':
        throw new ContinueSignal();
    }
  }

  private truthy(v: Val): boolean {
    if (v.t === 'bool') return v.v;
    throw new RuntimeError(`Condition must be boolean, got ${v.t}`, this.top()?.line ?? 0);
  }

  private num(v: Val): number {
    if (v.t === 'int' || v.t === 'double') return Math.trunc(v.v);
    if (v.t === 'char') return v.v.charCodeAt(0);
    if (v.t === 'bool') return v.v ? 1 : 0;
    throw new RuntimeError(`Expected a number, got ${v.t}`, this.top()?.line ?? 0);
  }

  /* ---------- frames & variables ---------- */

  private readIdent(name: string): Val {
    const frame = this.top();
    if (!frame) throw new RuntimeError(`cannot find symbol: ${name}`, 0);
    const slot = frame.vars.get(name);
    if (slot) return slot.value;

    if (frame.thisVal && frame.thisVal.t === 'ref') {
      const obj = this.heap.get(frame.thisVal.id);
      if (obj?.kind === 'object') {
        const field = obj.fields.find((f) => f.name === name);
        if (field) return field.value;
      }
    }

    const staticSlot = this.staticSlot(frame.owner, name);
    if (staticSlot) return staticSlot.value;

    if (this.classMap.has(name) || BUILTIN_NS.has(name)) return { t: 'ns', name };
    throw new RuntimeError(`cannot find symbol: ${name}`, frame.line);
  }

  private written(name: string, value: Val): Val {
    const frame = this.top()!;
    const slot = frame.vars.get(name);
    if (slot) {
      slot.prev = slot.value;
      slot.value = this.coerce(slot.type, value);
      return slot.value;
    }

    if (frame.thisVal && frame.thisVal.t === 'ref') {
      const obj = this.heap.get(frame.thisVal.id);
      if (obj?.kind === 'object') {
        const field = obj.fields.find((f) => f.name === name);
        if (field) {
          const prev = field.value;
          field.value = value;
          this.effects.push({ to: { obj: obj.id, field: name }, value: this.toTrace(value), prev: this.toTrace(prev) });
          return value;
        }
      }
    }

    const staticSlot = this.staticSlot(frame.owner, name);
    if (staticSlot) {
      staticSlot.prev = staticSlot.value;
      staticSlot.value = value;
      return value;
    }

    throw new RuntimeError(`cannot find symbol: ${name}`, frame.line);
  }

  /* ---------- expressions ---------- */

  private eval(e: Expr): Val {
    switch (e.t) {
      case 'num':
        return e.isDouble ? DBL(e.v) : INT(e.v);
      case 'str':
        return STR(e.v);
      case 'char':
        return CHR(e.v);
      case 'bool':
        return BOOL(e.v);
      case 'null':
        return NULLV;
      case 'this':
        return this.top()?.thisVal ?? NULLV;
      case 'id':
        return this.readIdent(e.name);
      case 'seq': {
        let last: Val = NULLV;
        for (const item of e.items) last = this.eval(item);
        return last;
      }
      case 'bin': {
        if (e.op === '&&') {
          const left = this.truthy(this.eval(e.l));
          return BOOL(left && this.truthy(this.eval(e.r)));
        }
        if (e.op === '||') {
          const left = this.truthy(this.eval(e.l));
          return BOOL(left || this.truthy(this.eval(e.r)));
        }
        return this.binary(e.op, this.eval(e.l), this.eval(e.r));
      }
      case 'un':
        return this.unary(e);
      case 'assign':
        return this.assign(e);
      case 'cond':
        return this.truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case 'field':
        return this.readField(this.eval(e.target), e.name);
      case 'index': {
        const arr = this.arrayOf(this.eval(e.target));
        const index = this.num(this.eval(e.index));
        if (index < 0 || index >= arr.cells.length) {
          throw new RuntimeError(`ArrayIndexOutOfBoundsException: index ${index}, length ${arr.cells.length}`, this.top()?.line ?? 0);
        }
        return arr.cells[index];
      }
      case 'new':
        return this.construct(e);
      case 'call':
        return this.call(e);
    }
  }

  private binary(op: string, a: Val, b: Val): Val {
    if (op === '+') {
      if (a.t === 'str' || b.t === 'str') return STR(this.str(a) + this.str(b));
    }

    if (op === '==' || op === '!=') {
      const same = this.equals(a, b);
      return BOOL(op === '==' ? same : !same);
    }

    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      const left = this.numeric(a);
      const right = this.numeric(b);
      const r = op === '<' ? left < right : op === '>' ? left > right : op === '<=' ? left <= right : left >= right;
      return BOOL(r);
    }

    const left = this.numeric(a);
    const right = this.numeric(b);
    const useDouble = a.t === 'double' || b.t === 'double';
    let result = 0;
    switch (op) {
      case '-':
        result = left - right;
        break;
      case '*':
        result = left * right;
        break;
      case '/':
        if (right === 0) throw new RuntimeError('ArithmeticException: division by zero', this.top()?.line ?? 0);
        result = useDouble ? left / right : Math.trunc(left / right);
        break;
      case '%':
        if (right === 0) throw new RuntimeError('ArithmeticException: modulo by zero', this.top()?.line ?? 0);
        result = useDouble ? left % right : left % right;
        break;
      case '+':
        result = left + right;
        break;
      default:
        throw new RuntimeError(`Unsupported operator ${op}`, this.top()?.line ?? 0);
    }
    return useDouble ? DBL(result) : INT(result);
  }

  private numeric(v: Val): number {
    if (v.t === 'int' || v.t === 'double') return v.v;
    if (v.t === 'char') return v.v.charCodeAt(0);
    if (v.t === 'bool') return v.v ? 1 : 0;
    throw new RuntimeError(`Expected a number, found ${v.t}`, this.top()?.line ?? 0);
  }

  private equals(a: Val, b: Val): boolean {
    if (a.t === 'null' || b.t === 'null') return a.t === 'null' && b.t === 'null';
    if (a.t === 'ref' && b.t === 'ref') return a.id === b.id;
    if (a.t === 'str' && b.t === 'str') return a.v === b.v;
    if (a.t === 'ref' || b.t === 'ref') return false;
    return this.numeric(a) === this.numeric(b);
  }

  private unary(e: Extract<Expr, { t: 'un' }>): Val {
    if (e.op === '!') return BOOL(!this.truthy(this.eval(e.e)));
    if (e.op === '-' || e.op === '+') {
      const v = this.eval(e.e);
      if (v.t === 'double') return e.op === '-' ? DBL(-v.v) : v;
      const n = this.numeric(v);
      return INT(e.op === '-' ? -n : n);
    }
    const old = this.readTarget(e.e);
    const step = e.op === '++' ? 1 : -1;
    const next = old.t === 'double' ? DBL(old.v + step) : INT(this.numeric(old) + step);
    this.writeTarget(e.e, next);
    return e.prefix ? next : old;
  }

  private readTarget(target: Expr): Val {
    return this.eval(target);
  }

  private writeTarget(target: Expr, value: Val): Val {
    const frame = this.top()!;

    if (target.t === 'id') return this.written(target.name, value);

    if (target.t === 'index') {
      const arr = this.arrayOf(this.eval(target.target));
      const index = this.num(this.eval(target.index));
      if (index < 0 || index >= arr.cells.length) {
        throw new RuntimeError(`ArrayIndexOutOfBoundsException: index ${index}, length ${arr.cells.length}`, frame.line);
      }
      const prev = arr.cells[index];
      const coerced =
        arr.elemType === 'int' || arr.elemType === 'long' || arr.elemType === 'short' || arr.elemType === 'byte'
          ? this.coerce({ name: arr.elemType, dims: 0 }, value)
          : value;
      arr.cells[index] = coerced;
      this.effects.push({ to: { obj: arr.id, index }, value: this.toTrace(coerced), prev: this.toTrace(prev) });
      return coerced;
    }

    if (target.t === 'field') {
      const recv = this.eval(target.target);
      if (recv.t === 'ref') {
        const obj = this.heap.get(recv.id);
        if (obj?.kind !== 'object') throw new RuntimeError(`Cannot write field ${target.name}`, frame.line);
        const field = obj.fields.find((f) => f.name === target.name);
        if (!field) throw new RuntimeError(`cannot find symbol: ${target.name}`, frame.line);
        const prev = field.value;
        field.value = value;
        this.effects.push({
          to: { obj: obj.id, field: target.name },
          value: this.toTrace(value),
          prev: this.toTrace(prev),
        });
        return value;
      }
      if (recv.t === 'ns') {
        const slot = this.staticSlot(recv.name, target.name);
        if (!slot) throw new RuntimeError(`cannot find symbol: ${recv.name}.${target.name}`, frame.line);
        slot.prev = slot.value;
        slot.value = value;
        return value;
      }
      throw new RuntimeError('NullPointerException: cannot write a field of null', frame.line);
    }

    throw new RuntimeError('Invalid assignment target', frame.line);
  }

  private assign(e: Extract<Expr, { t: 'assign' }>): Val {
    if (e.op === '=') {
      return this.writeTarget(e.target, this.eval(e.value));
    }
    const current = this.readTarget(e.target);
    const rhs = this.eval(e.value);
    const combined = this.binary(e.op[0], current, rhs);
    return this.writeTarget(e.target, combined);
  }

  private arrayOf(v: Val): Extract<HeapObj, { kind: 'array' }> {
    if (v.t !== 'ref') throw new RuntimeError('NullPointerException: array is null', this.top()?.line ?? 0);
    const obj = this.heap.get(v.id);
    if (!obj || obj.kind !== 'array') throw new RuntimeError('Expected an array', this.top()?.line ?? 0);
    return obj;
  }

  private readField(target: Val, name: string): Val {
    if (target.t === 'ns') {
      if (target.name === 'System' && name === 'out') return { t: 'stream' };
      const slot = this.staticSlot(target.name, name);
      if (slot) return slot.value;
      const constant = this.constant(target.name, name);
      if (constant) return constant;
      throw new RuntimeError(`cannot find symbol: ${target.name}.${name}`, this.top()?.line ?? 0);
    }
    if (target.t === 'null') {
      throw new RuntimeError(`NullPointerException: cannot read "${name}" of null`, this.top()?.line ?? 0);
    }
    if (target.t === 'ref') {
      const obj = this.heap.get(target.id);
      if (!obj) throw new RuntimeError('NullPointerException', this.top()?.line ?? 0);
      if (obj.kind === 'array' && name === 'length') return INT(obj.cells.length);
      if (obj.kind === 'list' && name === 'size') return INT(obj.items.length);
      if (obj.kind === 'object') {
        const field = obj.fields.find((f) => f.name === name);
        if (field) return field.value;
      }
      throw new RuntimeError(`${this.refLabel(target.id)} has no field "${name}"`, this.top()?.line ?? 0);
    }
    throw new RuntimeError(`Cannot read field "${name}"`, this.top()?.line ?? 0);
  }

  private constant(className: string, name: string): Val | null {
    if (className === 'Integer' && name === 'MAX_VALUE') return INT(2147483647);
    if (className === 'Integer' && name === 'MIN_VALUE') return INT(-2147483648);
    if (className === 'Math' && name === 'PI') return DBL(Math.PI);
    if (className === 'Math' && name === 'E') return DBL(Math.E);
    if (className === 'Character' && name === 'MAX_VALUE') return CHR('\uffff');
    return null;
  }

  /* ---------- construction ---------- */

  private construct(e: Extract<Expr, { t: 'new' }>): Val {
    if (e.init) return this.arrayInit(e.init, e.name || 'int');

    if (e.dims.length > 0) {
      const sizes = e.dims.map((d) => (d ? this.num(this.eval(d)) : 0));
      for (const size of sizes) {
        if (size < 0 || size > MAX_ARRAY) throw new RuntimeError(`Bad array size ${size}`, this.top()?.line ?? 0);
      }
      return this.makeArray(e.name, sizes, 0);
    }

    if (e.name === 'ArrayList' || e.name === 'LinkedList') {
      const list = this.alloc({ kind: 'list', elemType: 'Object', items: [] as Val[] });
      return { t: 'ref', id: list.id };
    }

    const cls = this.classMap.get(e.name);
    if (!cls) throw new RuntimeError(`unknown class "${e.name}"`, this.top()?.line ?? 0);
    this.ensureStatics(cls);
    const args = e.args.map((a) => this.eval(a));

    const obj = this.alloc({ kind: 'object', className: cls.name, fields: [] as { name: string; value: Val }[] });
    const ref: Val = { t: 'ref', id: obj.id };

    const frame = this.top()!;
    const savedThis = frame.thisVal;
    frame.thisVal = ref;
    try {
      for (const field of cls.fields) {
        if (field.isStatic) continue;
        const value = field.init ? this.eval(field.init) : this.defaultFor(field.type);
        obj.fields.push({ name: field.name, value: this.coerce(field.type, value) });
      }
    } finally {
      frame.thisVal = savedThis;
    }

    const ctor = cls.methods.find((m) => m.isCtor && m.params.length === args.length);
    if (ctor) this.invoke(cls, ctor, ref, args);
    else if (args.length > 0) throw new RuntimeError(`No constructor ${cls.name}(${args.length} args)`, frame.line);

    return ref;
  }

  private arrayInit(items: Expr[], elemType: string): Val {
    const cells = items.map((item) => {
      if (item.t === 'new' && item.init) return this.arrayInit(item.init, elemType);
      return this.eval(item);
    });
    if (cells.length > MAX_ARRAY) throw new RuntimeError('Array too large to visualize', this.top()?.line ?? 0);
    return { t: 'ref', id: this.alloc({ kind: 'array', elemType, cells, dims: [cells.length] }).id };
  }

  private makeArray(elemType: string, sizes: number[], level: number): Val {
    const size = sizes[level] ?? 0;
    const last = level === sizes.length - 1;
    const cells: Val[] = [];
    for (let i = 0; i < size; i++) {
      cells.push(last ? this.defaultFor({ name: elemType, dims: 0 }) : this.makeArray(elemType, sizes, level + 1));
    }
    const obj = this.alloc({
      kind: 'array',
      elemType: last ? elemType : `${elemType}[]`,
      cells,
      dims: sizes.slice(level),
    });
    return { t: 'ref', id: obj.id };
  }

  /* ---------- calls ---------- */

  private invoke(cls: ClassDef, method: MethodDef, thisVal: Val | null, args: Val[], skipSnapshot = false): Val {
    if (this.frames.length >= MAX_DEPTH) {
      throw new RuntimeError(`StackOverflowError: recursion deeper than ${MAX_DEPTH} frames`, this.top()?.line ?? 0);
    }
    this.ensureStatics(cls);

    const frame: Frame = {
      id: ++this.frameSeq,
      owner: cls.name,
      method: method.name,
      line: method.line,
      vars: new Map(),
      thisVal,
    };
    method.params.forEach((param, i) => {
      frame.vars.set(param.name, { type: param.type, value: this.coerce(param.type, args[i] ?? NULLV) });
    });

    this.frames.push(frame);
    if (!skipSnapshot) {
      this.snap('call', `${method.isCtor ? 'new ' + cls.name : cls.name + '.' + method.name}(${args.map((a) => this.text(a)).join(', ')})`);
    }

    let result: Val = NULLV;
    let failed = false;
    try {
      this.exec(method.body);
    } catch (e) {
      if (e instanceof ReturnSignal) result = e.value;
      else {
        failed = true;
        this.frames.pop();
        throw e;
      }
    }

    if (!failed) {
      this.snap('return', `return${result.t === 'null' ? ' (void)' : ' ' + this.text(result)}`);
      this.frames.pop();
    }
    return result;
  }

  private call(e: Extract<Expr, { t: 'call' }>): Val {
    const { callee, args } = e;

    if (callee.t === 'id') {
      const frame = this.top()!;
      const cls = this.classMap.get(frame.owner);
      if (!cls) throw new RuntimeError(`unknown class ${frame.owner}`, frame.line);
      const method = cls.methods.find((m) => m.name === callee.name && !m.isCtor && m.params.length === args.length);
      if (!method) throw new RuntimeError(`cannot find method ${callee.name}(${args.length} args)`, frame.line);
      const values = args.map((a) => this.eval(a));
      return this.invoke(cls, method, method.isStatic ? null : frame.thisVal, values);
    }

    if (callee.t === 'field') {
      const receiver = this.eval(callee.target);
      const values = args.map((a) => this.eval(a));
      return this.callOn(receiver, callee.name, values);
    }

    throw new RuntimeError('Unsupported call target', this.top()?.line ?? 0);
  }

  private callOn(receiver: Val, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;

    if (receiver.t === 'stream') {
      if (name === 'println') {
        const text = args.length ? this.str(args[0]) : '';
        this.out += text + '\n';
        this.snap('stmt', `println("${text}")`);
        return NULLV;
      }
      if (name === 'print') {
        const text = args.length ? this.str(args[0]) : '';
        this.out += text;
        this.snap('stmt', `print("${text}")`);
        return NULLV;
      }
      if (name === 'printf') {
        const fmt = args.length ? this.str(args[0]) : '';
        const text = this.printf(fmt, args.slice(1));
        this.out += text;
        this.snap('stmt', `printf → ${text.trim()}`);
        return NULLV;
      }
      throw new RuntimeError(`System.out.${name} is not supported`, line);
    }

    if (receiver.t === 'ns') return this.staticCall(receiver.name, name, args);

    if (receiver.t === 'str') return this.stringCall(receiver.v, name, args);

    if (receiver.t === 'null') throw new RuntimeError(`NullPointerException: calling ${name}() on null`, line);

    if (receiver.t === 'ref') {
      const obj = this.heap.get(receiver.id);
      if (!obj) throw new RuntimeError('NullPointerException', line);

      if (obj.kind === 'list') return this.listCall(obj, name, args);

      if (obj.kind === 'object') {
        const cls = this.classMap.get(obj.className);
        const method = cls?.methods.find((m) => m.name === name && !m.isCtor && m.params.length === args.length);
        if (!cls || !method) throw new RuntimeError(`${obj.className} has no method ${name}()`, line);
        return this.invoke(cls, method, receiver, args);
      }

      throw new RuntimeError(`Cannot call ${name}() on an array`, line);
    }

    throw new RuntimeError(`Cannot call ${name}() on ${receiver.t}`, line);
  }

  private printf(fmt: string, args: Val[]): string {
    let i = 0;
    return fmt.replace(/%[-0-9.]*[dsfcn%]/g, (match) => {
      if (match.endsWith('%')) return '%';
      if (match.endsWith('n')) return '\n';
      const arg = args[i++];
      if (!arg) return match;
      if (match.endsWith('f')) return Number(this.numeric(arg)).toFixed(6);
      return this.str(arg);
    });
  }

  private staticCall(className: string, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;

    switch (`${className}.${name}`) {
      case 'Math.max':
        return args[0]?.t === 'double' || args[1]?.t === 'double'
          ? DBL(Math.max(this.numeric(args[0]), this.numeric(args[1])))
          : INT(Math.max(this.numeric(args[0]), this.numeric(args[1])));
      case 'Math.min':
        return args[0]?.t === 'double' || args[1]?.t === 'double'
          ? DBL(Math.min(this.numeric(args[0]), this.numeric(args[1])))
          : INT(Math.min(this.numeric(args[0]), this.numeric(args[1])));
      case 'Math.abs': {
        const v = this.numeric(args[0]);
        return args[0]?.t === 'double' ? DBL(Math.abs(v)) : INT(Math.abs(v));
      }
      case 'Math.pow':
        return DBL(Math.pow(this.numeric(args[0]), this.numeric(args[1])));
      case 'Math.sqrt':
        return DBL(Math.sqrt(this.numeric(args[0])));
      case 'Math.floor':
        return DBL(Math.floor(this.numeric(args[0])));
      case 'Math.ceil':
        return DBL(Math.ceil(this.numeric(args[0])));
      case 'Math.round':
        return INT(Math.round(this.numeric(args[0])));
      case 'Math.random':
        return DBL(Math.random());
      case 'Integer.parseInt':
        return INT(parseInt(this.str(args[0]), 10) || 0);
      case 'Integer.toString':
        return STR(String(this.numeric(args[0])));
      case 'String.valueOf':
        return STR(this.str(args[0] ?? NULLV));
      case 'Character.isDigit':
        return BOOL(/[0-9]/.test(this.str(args[0])));
      case 'Character.isLetter':
        return BOOL(/[A-Za-z]/.test(this.str(args[0])));
      case 'Arrays.toString': {
        const arr = this.arrayOf(args[0]);
        return STR(`[${arr.cells.map((c) => this.str(c)).join(', ')}]`);
      }
      case 'Arrays.deepToString': {
        const arr = this.arrayOf(args[0]);
        return STR(`[${arr.cells.map((c) => (c.t === 'ref' ? this.str(c) : this.str(c))).join(', ')}]`);
      }
      case 'Arrays.sort': {
        const arr = this.arrayOf(args[0]);
        arr.cells.sort((x, y) => this.numeric(x) - this.numeric(y));
        return NULLV;
      }
      case 'Collections.reverse': {
        const obj = this.heap.get(args[0]?.t === 'ref' ? args[0].id : -1);
        if (obj?.kind === 'list') obj.items.reverse();
        return NULLV;
      }
    }

    const cls = this.classMap.get(className);
    if (cls) {
      const method = cls.methods.find((m) => m.name === name && !m.isCtor && m.params.length === args.length);
      if (method) return this.invoke(cls, method, method.isStatic ? null : args[0] ?? null, args);
    }

    throw new RuntimeError(`Unsupported call ${className}.${name}()`, line);
  }

  private stringCall(text: string, name: string, args: Val[]): Val {
    switch (name) {
      case 'length':
        return INT(text.length);
      case 'charAt':
        return CHR(text[this.num(args[0])] ?? '');
      case 'substring':
        return STR(args.length > 1 ? text.slice(this.num(args[0]), this.num(args[1])) : text.slice(this.num(args[0])));
      case 'indexOf':
        return INT(text.indexOf(this.str(args[0])));
      case 'equals':
        return BOOL(text === this.str(args[0]));
      case 'equalsIgnoreCase':
        return BOOL(text.toLowerCase() === this.str(args[0]).toLowerCase());
      case 'toUpperCase':
        return STR(text.toUpperCase());
      case 'toLowerCase':
        return STR(text.toLowerCase());
      case 'isEmpty':
        return BOOL(text.length === 0);
      case 'contains':
        return BOOL(text.includes(this.str(args[0])));
      case 'trim':
        return STR(text.trim());
      case 'toString':
        return STR(text);
      case 'split':
        return STR(text);
      default:
        throw new RuntimeError(`String.${name}() is not supported`, this.top()?.line ?? 0);
    }
  }

  private listCall(obj: Extract<HeapObj, { kind: 'list' }>, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    switch (name) {
      case 'add': {
        if (args.length === 2) {
          const index = this.num(args[0]);
          obj.items.splice(index, 0, args[1]);
          this.effects.push({ to: { obj: obj.id, index }, value: this.toTrace(args[1]) });
        } else {
          obj.items.push(args[0]);
          this.effects.push({ to: { obj: obj.id, index: obj.items.length - 1 }, value: this.toTrace(args[0]) });
        }
        return NULLV;
      }
      case 'get': {
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new RuntimeError(`IndexOutOfBoundsException: ${index}`, line);
        return obj.items[index];
      }
      case 'set': {
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new RuntimeError(`IndexOutOfBoundsException: ${index}`, line);
        const prev = obj.items[index];
        obj.items[index] = args[1];
        this.effects.push({ to: { obj: obj.id, index }, value: this.toTrace(args[1]), prev: this.toTrace(prev) });
        return prev;
      }
      case 'size':
        return INT(obj.items.length);
      case 'remove': {
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new RuntimeError(`IndexOutOfBoundsException: ${index}`, line);
        const removed = obj.items.splice(index, 1)[0];
        return removed;
      }
      case 'isEmpty':
        return BOOL(obj.items.length === 0);
      case 'contains':
        return BOOL(obj.items.some((item) => this.equals(item, args[0])));
      case 'clear':
        obj.items.length = 0;
        return NULLV;
      case 'toString':
        return STR(`[${obj.items.map((i) => this.str(i)).join(', ')}]`);
      default:
        throw new RuntimeError(`ArrayList.${name}() is not supported`, line);
    }
  }
}

export function runJava(source: string): Trace {
  try {
    const classes = parseJava(source);
    return new Machine(classes).run();
  } catch (e) {
    if (e instanceof ParseError) {
      return {
        steps: [],
        stdout: '',
        heap: [],
        compileError: { line: e.line, message: e.message },
      };
    }
    return { steps: [], stdout: '', heap: [], error: (e as Error).message };
  }
}
