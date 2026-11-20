import { Stdin } from '../lang/stdin';
import { parseJava, src, type ClassDef, type Expr, type MethodDef, type Stmt, type TypeRef } from './parser';
import { ParseError } from './types';
import type { Effect, HeapObj, StepKind, Trace, TraceFrame, TraceObj, TraceStep, TraceVal, Val } from './types';

const MAX_STEPS = 4000;
const MAX_DEPTH = 90;
const MAX_HEAP_OBJECTS = 300;
const MAX_ARRAY = 400;

// `int` wraps at 32 bits in Java, so 2**31 - 1 + 1 is negative here too
const INT = (v: number): Val => ({ t: 'int', v: Math.trunc(v) | 0 });
const LONG = (v: number): Val => ({ t: 'long', v: Math.trunc(v) });
const DBL = (v: number): Val => ({ t: 'double', v });
const BOOL = (v: boolean): Val => ({ t: 'bool', v });
const STR = (v: string): Val => ({ t: 'str', v });
const CHR = (v: string): Val => ({ t: 'char', v });
const NULLV: Val = { t: 'null' };
const OUTV: Val = { t: 'out' };

type FnSpec =
  | { kind: 'lambda'; params: string[]; body: Expr | Stmt; block: boolean; line: number }
  | { kind: 'ref'; target: Val; name: string }
  /** builtin accessor used by Map.Entry.comparingByKey / comparingByValue */
  | { kind: 'entry'; field: 'key' | 'value' }
  /** `String[]::new` */
  | { kind: 'newArray'; elemType: string };

/** Names that behave like static namespaces even though they are not user classes. */
const BUILTIN_NS = new Set([
  'System', 'Math', 'Integer', 'Arrays', 'Character', 'String', 'Collections',
  'ArrayList', 'List', 'Map', 'HashMap', 'Double', 'Long', 'Boolean', 'Objects',
  'Stream', 'IntStream', 'Collectors', 'Set', 'HashSet', 'LinkedHashSet', 'TreeSet',
  'TreeMap', 'LinkedHashMap', 'LinkedList', 'Function', 'Comparator',
  'StringBuilder', 'StringBuffer', 'Map', 'Entry', 'System', 'Optional', 'PrintStream',
]);

/** exceptions the visualizer can throw, throw again and catch */
const BUILTIN_EXCEPTIONS = new Set([
  'Exception', 'RuntimeException', 'IllegalArgumentException', 'IllegalStateException',
  'ArithmeticException', 'NullPointerException', 'IndexOutOfBoundsException',
  'ArrayIndexOutOfBoundsException', 'UnsupportedOperationException', 'NoSuchElementException',
  'NumberFormatException', 'IllegalThreadStateException', 'InputMismatchException',
]);

class RuntimeError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

class ReturnSignal {
  constructor(public value: Val) {}
}
class BreakSignal {
  constructor(public label?: string) {}
}
class ContinueSignal {
  constructor(public label?: string) {}
}
/** a Java exception: catchable, unlike RuntimeError (an unsupported construct) */
class JavaException {
  constructor(public type: string, public message: string) {}
}
class YieldSignal {
  constructor(public value: Val) {}
}

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
  private fns = new Map<number, FnSpec>();
  private fnSeq = 0;

  constructor(private classes: ClassDef[], private input: Stdin = new Stdin()) {
    for (const cls of classes) {
      // a simple name only wins if no earlier class claimed it, so `Outer.Node`
      // never shadows a top-level `Node` that the program refers to plainly
      if (!this.classMap.has(cls.name)) this.classMap.set(cls.name, cls);
    }
    for (const cls of classes) {
      if (cls.qualified) this.classMap.set(cls.qualified, cls);
    }
  }

  /* ---------- class hierarchy ---------- */

  /** the class itself and then its ancestors */
  private chainOf(cls: ClassDef | undefined): ClassDef[] {
    const out: ClassDef[] = [];
    let current = cls;
    let guard = 0;
    while (current && guard++ < 24) {
      out.push(current);
      current = current.parent ? this.classMap.get(current.parent) : undefined;
    }
    return out;
  }

  /** most-derived first, so an override wins */
  private findMethod(cls: ClassDef | undefined, name: string, arity: number): { cls: ClassDef; method: MethodDef } | null {
    for (const owner of this.chainOf(cls)) {
      const method = owner.methods.find((m) => m.name === name && !m.isCtor && m.params.length === arity);
      if (method) return { cls: owner, method };
      // `void f(int... xs)` accepts any number of trailing arguments
      const variadic = owner.methods.find((m) => {
        if (m.name !== name || m.isCtor) return false;
        const last = m.params[m.params.length - 1];
        return !!last && last.type.dims > 0 && arity >= m.params.length - 1;
      });
      if (variadic) return { cls: owner, method: variadic };
    }
    // a default method body can live on an implemented interface
    for (const owner of this.chainOf(cls)) {
      for (const ifaceName of owner.interfaces) {
        const iface = this.classMap.get(ifaceName);
        const method = iface?.methods.find(
          (m) => m.name === name && !m.isCtor && m.params.length === arity && m.body.t === 'block' && m.body.body.length > 0
        );
        if (iface && method) return { cls: iface, method };
      }
    }
    return null;
  }

  private findCtor(cls: ClassDef, arity: number): { cls: ClassDef; method: MethodDef } | null {
    for (const owner of this.chainOf(cls)) {
      const ctor = owner.methods.find((m) => m.isCtor && m.params.length === arity);
      if (ctor) return { cls: owner, method: ctor };
    }
    return null;
  }

  /** inherited instance fields, base class first */
  private fieldChain(cls: ClassDef) {
    const out: { type: TypeRef; name: string; init: Expr | null; isStatic: boolean }[] = [];
    for (const owner of this.chainOf(cls).reverse()) {
      for (const field of owner.fields) {
        if (field.isStatic) continue;
        if (out.some((f) => f.name === field.name)) continue;
        out.push(field);
      }
    }
    return out;
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
        const kindLabel = this.refLabel(obj.id);
        out.push({
          id: obj.id,
          kind: 'list',
          label: `${kindLabel}[${obj.items.length}]`,
          type: obj.elemType === 'Set' || obj.elemType === 'TreeSet' ? 'Set' : `ArrayList<${obj.elemType}>`,
          cells: obj.items.map((c) => this.toTrace(c)),
        });
      } else if (obj.kind === 'map') {
        out.push({
          id: obj.id,
          kind: 'object',
          label: `${obj.mapType}{${obj.entries.length}}`,
          type: obj.mapType,
          cells: [],
          fields: obj.entries.slice(0, 8).map((entry) => ({ name: this.str(entry.key), value: this.toTrace(entry.value) })),
        });
      } else if (obj.kind === 'iterator') {
        // iterators are plumbing, not data worth drawing
      } else if (obj.kind === 'builder') {
        out.push({
          id: obj.id,
          kind: 'object',
          label: `StringBuilder[${obj.text.length}]`,
          type: 'StringBuilder',
          cells: [],
          fields: [{ name: 'text', value: this.toTrace(STR(obj.text)) }],
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
    else if (v.t === 'bool' || v.t === 'int' || v.t === 'long' || v.t === 'double') text = String(v.v);
    else if (v.t === 'enum') text = v.name;
    else if (v.t === 'exc') text = v.type;
    return { kind: 'prim', text, type: v.t };
  }

  /* ---------- text helpers ---------- */

  private refLabel(id: number): string {
    const o = this.heap.get(id);
    if (!o) return `@${id}`;
    if (o.kind === 'array') return `${o.elemType}[${o.cells.length}]`;
    if (o.kind === 'list') {
      if (o.elemType === 'Set' || o.elemType === 'TreeSet') return 'Set';
      if (o.elemType === 'Stack') return 'Stack';
      if (o.elemType === 'Queue' || o.elemType === 'Deque' || o.elemType === 'ArrayDeque') return 'Queue';
      if (o.elemType === 'PriorityQueue') return 'PriorityQueue';
      return 'ArrayList';
    }
    if (o.kind === 'map') return o.mapType;
    if (o.kind === 'builder') return 'StringBuilder';
    if (o.kind === 'iterator') return 'Iterator';
    return o.className;
  }

  private str(v: Val): string {
    switch (v.t) {
      case 'int':
      case 'long':
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
      case 'ref': {
        const obj = this.heap.get(v.id);
        if (obj?.kind === 'list') return `[${obj.items.map((item) => this.str(item)).join(', ')}]`;
        if (obj?.kind === 'map') return `{${obj.entries.map((e) => `${this.str(e.key)}=${this.str(e.value)}`).join(', ')}}`;
        if (obj?.kind === 'builder') return obj.text;
        return `${this.refLabel(v.id)}@${v.id}`;
      }
      case 'enum':
        return v.name;
      case 'exc':
        return v.message ? `${v.type}: ${v.message}` : v.type;
      case 'opt':
        return v.empty ? 'Optional.empty' : `Optional[${this.str(v.value)}]`;
      case 'scanner':
        return 'java.util.Scanner';
      case 'in':
        return 'System.in';
      default:
        return '?';
    }
  }

  private text(v: Val): string {
    if (v.t === 'str') return `"${v.v}"`;
    if (v.t === 'char') return `'${v.v}'`;
    if (v.t === 'fn') return 'lambda';
    if (v.t === 'stream') return `stream[${v.items.length}]`;
    if (v.t === 'opt') return v.empty ? 'Optional.empty' : `Optional[${this.text(v.value)}]`;
    if (v.t === 'collector') return `Collectors.${v.kind}`;
    if (v.t === 'out') return 'System.out';
    if (v.t === 'in') return 'System.in';
    if (v.t === 'scanner') return 'Scanner';
    if (v.t === 'enum') return `${v.type}.${v.name}`;
    if (v.t === 'exc') return v.type;
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
      case 'short':
      case 'byte':
        return INT(0);
      case 'long':
        return LONG(0);
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
      case 'long':
        if (v.t === 'double') return LONG(v.v);
        if (v.t === 'char') return LONG(v.v.charCodeAt(0));
        if (v.t === 'int') return LONG(v.v);
        return v;
      case 'int':
      case 'short':
      case 'byte':
        if (v.t === 'double') return INT(v.v);
        if (v.t === 'long') return INT(v.v);
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
    if (v.t === 'enum' || v.t === 'exc') return { name: v.type, dims: 0 };
    if (
      v.t === 'fn' ||
      v.t === 'stream' ||
      v.t === 'opt' ||
      v.t === 'collector' ||
      v.t === 'out' ||
      v.t === 'in' ||
      v.t === 'scanner' ||
      v.t === 'ns'
    ) {
      return { name: 'Object', dims: 0 };
    }
    return { name: v.t === 'bool' ? 'boolean' : v.t === 'char' ? 'char' : v.t === 'long' ? 'long' : v.t, dims: 0 };
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
    // enum constants behave like static fields of the enum type
    (cls.constants ?? []).forEach((name, ordinal) => {
      store.set(name, { type: { name: cls.name, dims: 0 }, value: { t: 'enum', type: cls.name, name, ordinal } });
    });
    // static initializer blocks run once, when the class is first touched
    if (cls.staticInit?.length) {
      const temp = this.frames.length === 0;
      if (temp) {
        this.frames.push({ id: ++this.frameSeq, owner: cls.name, method: '<clinit>', line: 0, vars: new Map(), thisVal: null });
      }
      try {
        for (const block of cls.staticInit) this.exec(block);
      } finally {
        if (temp) this.frames.pop();
      }
    }
  }

  private staticSlot(className: string, name: string): VarSlot | undefined {
    const cls = this.classMap.get(className);
    if (!cls) return undefined;
    for (const owner of this.chainOf(cls)) {
      this.ensureStatics(owner);
      const slot = this.statics.get(owner.name)?.get(name);
      if (slot) return slot;
    }
    return undefined;
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
      if (e instanceof JavaException) {
        const message = `Exception in thread "main" ${e.type}${e.message ? ': ' + e.message : ''}`;
        this.steps.push({
          line: this.top()?.line ?? 0,
          kind: 'error',
          note: message,
          stack: this.serializeFrames(),
          heap: this.serializeHeap(),
          stdout: this.out,
          effects: [],
        });
        return { steps: this.steps, stdout: this.out, heap: this.serializeHeap(), error: message, entry: this.entry };
      }
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
            const signal = this.loopSignal(e, s.label);
            if (signal === 'break') return;
            if (signal !== 'continue') throw e;
          }
        }
      }

      case 'dowhile': {
        for (;;) {
          try {
            this.exec(s.body);
          } catch (e) {
            const signal = this.loopSignal(e, s.label);
            if (signal === 'break') return;
            if (signal !== 'continue') throw e;
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
            const signal = this.loopSignal(e, s.label);
            if (signal === 'break') return;
            if (signal !== 'continue') throw e;
          }
          if (s.update) this.eval(s.update);
        }
      }

      case 'foreach': {
        const frame = this.top()!;
        frame.line = s.line;
        const items = this.itemsOf(this.eval(s.iter), s.line);
        if (items.length === 0) this.snap('stmt', `for (… : ${src(s.iter)}) → nothing to iterate`);
        for (const item of items) {
          frame.line = s.line;
          const type = s.type.name === 'var' ? this.inferType(item) : s.type;
          const value = this.coerce(type, item);
          const existing = frame.vars.get(s.name);
          if (existing) {
            existing.prev = existing.value;
            existing.value = value;
            existing.type = type;
          } else {
            frame.vars.set(s.name, { type, value });
          }
          this.snap('stmt', `${typeName(type)} ${s.name} = ${this.text(value)}`);
          try {
            this.exec(s.body);
          } catch (e) {
            const signal = this.loopSignal(e, s.label);
            if (signal === 'break') return;
            if (signal !== 'continue') throw e;
          }
        }
        return;
      }

      case 'return': {
        this.top()!.line = s.line;
        const value = s.value ? this.eval(s.value) : NULLV;
        this.snap('stmt', `return ${this.text(value)}`);
        throw new ReturnSignal(value);
      }

      case 'break':
        throw new BreakSignal(s.label);

      case 'continue':
        throw new ContinueSignal(s.label);

      case 'switch': {
        this.top()!.line = s.line;
        const sel = this.eval(s.sel);
        const label = sel.t === 'enum' ? sel.name : this.text(sel);
        let index = -1;
        for (let g = 0; g < s.groups.length; g++) {
          const group = s.groups[g];
          if (group.def) continue;
          if (group.tests.some((test) => this.equals(sel, this.caseValue(test, sel)))) {
            index = g;
            break;
          }
        }
        if (index < 0) index = s.groups.findIndex((g) => g.def);
        this.snap('stmt', `switch (${src(s.sel)}) → ${label}`);
        if (index < 0) return;

        // `case X -> body` runs one arm; `case X: body` falls through until break
        if (s.groups[index].arrow) {
          for (const st of s.groups[index].body) this.exec(st);
          return;
        }
        for (let g = index; g < s.groups.length; g++) {
          try {
            for (const st of s.groups[g].body) this.exec(st);
          } catch (e) {
            if (e instanceof BreakSignal && !e.label) return;
            throw e;
          }
        }
        return;
      }

      case 'try': {
        this.top()!.line = s.line;
        try {
          try {
            this.exec(s.body);
          } catch (e) {
            if (!(e instanceof JavaException) || !s.catches.length) throw e;
            const handler =
              s.catches.find((c) => this.catchesType(e.type, c.type)) ??
              s.catches.find((c) => ['Exception', 'Throwable', 'RuntimeException'].includes(c.type)) ??
              s.catches[0];
            const frame = this.top()!;
            frame.vars.set(handler.param, {
              type: { name: handler.type, dims: 0 },
              value: { t: 'exc', type: e.type, message: e.message },
            });
            this.snap('stmt', `catch (${handler.type} ${handler.param}) → ${e.type}: ${e.message}`);
            this.exec(handler.body);
          }
        } finally {
          if (s.fin) this.exec(s.fin);
        }
        return;
      }

      case 'throw': {
        this.top()!.line = s.line;
        const value = this.eval(s.value);
        const thrown = value.t === 'exc' ? value : this.asException(value);
        this.snap('stmt', `throw ${thrown.type}${thrown.message ? ': ' + thrown.message : ''}`);
        throw new JavaException(thrown.type, thrown.message);
      }

      case 'yield':
        throw new YieldSignal(s.value ? this.eval(s.value) : NULLV);
    }
  }

  /** `case RED:` may name an enum constant without the `Color.` prefix */
  private caseValue(test: Expr, sel: Val): Val {
    if (sel.t === 'enum' && test.t === 'id') {
      const cls = this.classMap.get(sel.type);
      const at = (cls?.constants ?? []).indexOf(test.name);
      if (at >= 0) return { t: 'enum', type: sel.type, name: test.name, ordinal: at };
    }
    return this.eval(test);
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
        return e.isDouble ? DBL(e.v) : e.isLong ? LONG(e.v) : INT(e.v);
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
      case 'lam': {
        const id = ++this.fnSeq;
        this.fns.set(id, { kind: 'lambda', params: e.params, body: e.body, block: e.block, line: e.line });
        return { t: 'fn', id };
      }
      case 'mref': {
        const id = ++this.fnSeq;
        // `String[]::new` is an array constructor, not a method on a value
        if (e.name === 'new' && e.target.t === 'id') {
          this.fns.set(id, { kind: 'newArray', elemType: e.target.name });
          return { t: 'fn', id };
        }
        this.fns.set(id, { kind: 'ref', target: this.eval(e.target), name: e.name });
        return { t: 'fn', id };
      }
      case 'cast':
        return this.coerce(e.type, this.eval(e.e));
      case 'index': {
        const arr = this.arrayOf(this.eval(e.target));
        const index = this.num(this.eval(e.index));
        if (index < 0 || index >= arr.cells.length) {
          throw new JavaException('ArrayIndexOutOfBoundsException', `Index ${index} out of bounds for length ${arr.cells.length}`);
        }
        return arr.cells[index];
      }
      case 'new':
        return this.construct(e);
      case 'call':
        return this.call(e);
      case 'super':
        return this.top()?.thisVal ?? NULLV;
      case 'switch': {
        const sel = this.eval(e.sel);
        const arm =
          e.arms.find((a) => !a.def && a.tests.some((test) => this.equals(sel, this.caseValue(test, sel)))) ??
          e.arms.find((a) => a.def);
        if (!arm) throw new RuntimeError('switch expression matched no arm', this.top()?.line ?? 0);
        if (arm.value) return this.eval(arm.value);
        try {
          this.exec(arm.body!);
        } catch (err) {
          if (err instanceof YieldSignal) return err.value;
          throw err;
        }
        return NULLV;
      }
    }
  }

  private binary(op: string, a: Val, b: Val): Val {
    if (op === 'instanceof') {
      const target = b.t === 'ns' ? b.name : b.t === 'str' ? b.v : '';
      if (a.t === 'null') return BOOL(false);
      if (a.t === 'str') return BOOL(['String', 'Object', 'CharSequence'].includes(target));
      if (a.t === 'enum') return BOOL(a.type === target || ['Enum', 'Object'].includes(target));
      if (a.t !== 'ref') return BOOL(false);
      const obj = this.heap.get(a.id);
      if (!obj) return BOOL(false);
      if (obj.kind === 'object') {
        const cls = this.classMap.get(obj.className);
        if (cls && (cls.name === target || this.chainOf(cls).some((c) => c.name === target))) return BOOL(true);
        return BOOL(cls?.interfaces.includes(target) === true || this.chainOf(cls).some((c) => c.interfaces.includes(target)));
      }
      if (obj.kind === 'array') return BOOL(['Object', 'Cloneable'].includes(target));
      if (obj.kind === 'list') {
        return BOOL(['List', 'ArrayList', 'Collection', 'Iterable', 'Set', 'Queue', 'Deque', 'Stack', 'Object'].includes(target));
      }
      if (obj.kind === 'map') return BOOL(['Map', 'HashMap', 'TreeMap', 'LinkedHashMap', 'Object'].includes(target));
      if (obj.kind === 'builder') return BOOL(['StringBuilder', 'CharSequence', 'Object'].includes(target));
      return BOOL(false);
    }

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
    const useLong = !useDouble && (a.t === 'long' || b.t === 'long');
    let result = 0;
    switch (op) {
      case '-':
        result = left - right;
        break;
      case '*':
        result = left * right;
        break;
      case '/':
        if (right === 0) {
          if (useDouble) return DBL(left / right);
          throw new JavaException('ArithmeticException', '/ by zero');
        }
        result = useDouble ? left / right : Math.trunc(left / right);
        break;
      case '%':
        if (right === 0) throw new JavaException('ArithmeticException', '/ by zero');
        result = useDouble ? left % right : left % right;
        break;
      case '+':
        result = left + right;
        break;
      // bitwise and shift operators work on 32-bit ints
      case '&':
        return INT(left & right);
      case '|':
        return INT(left | right);
      case '^':
        return INT(left ^ right);
      case '<<':
        return INT(left << (right & 31));
      case '>>':
        return INT(left >> (right & 31));
      case '>>>':
        return INT((left >>> (right & 31)) | 0);
      default:
        throw new RuntimeError(`Unsupported operator ${op}`, this.top()?.line ?? 0);
    }
    return useDouble ? DBL(result) : useLong ? LONG(result) : INT(result);
  }

  private numeric(v: Val): number {
    if (v.t === 'int' || v.t === 'long' || v.t === 'double') return v.v;
    if (v.t === 'char') return v.v.charCodeAt(0);
    if (v.t === 'bool') return v.v ? 1 : 0;
    throw new RuntimeError(`Expected a number, found ${v.t}`, this.top()?.line ?? 0);
  }

  private equals(a: Val, b: Val): boolean {
    if (a.t === 'null' || b.t === 'null') return a.t === 'null' && b.t === 'null';
    if (a.t === 'ref' && b.t === 'ref') return a.id === b.id;
    if (a.t === 'str' && b.t === 'str') return a.v === b.v;
    if (a.t === 'enum' && b.t === 'enum') return a.type === b.type && a.name === b.name;
    if (a.t === 'enum' || b.t === 'enum') return false;
    if (a.t === 'ref' || b.t === 'ref') return false;
    return this.numeric(a) === this.numeric(b);
  }

  private unary(e: Extract<Expr, { t: 'un' }>): Val {
    if (e.op === '!') return BOOL(!this.truthy(this.eval(e.e)));
    if (e.op === '~') return INT(~this.numeric(this.eval(e.e)));
    if (e.op === '-' || e.op === '+') {
      const v = this.eval(e.e);
      if (v.t === 'double') return e.op === '-' ? DBL(-v.v) : v;
      const n = this.numeric(v);
      return INT(e.op === '-' ? -n : n);
    }
    const old = this.readTarget(e.e);
    const step = e.op === '++' ? 1 : -1;
    const next = old.t === 'double' ? DBL(old.v + step) : old.t === 'long' ? LONG(old.v + step) : INT(this.numeric(old) + step);
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
        throw new JavaException('ArrayIndexOutOfBoundsException', `Index ${index} out of bounds for length ${arr.cells.length}`);
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

  /** the values a `for (T x : seq)` walks: array cells or list items */
  private itemsOf(v: Val, line: number): Val[] {
    if (v.t === 'null') throw new RuntimeError('NullPointerException: cannot iterate over null', line);
    if (v.t !== 'ref') throw new RuntimeError('for-each needs an array or a list', line);
    const obj = this.heap.get(v.id);
    if (!obj) throw new RuntimeError('NullPointerException', line);
    if (obj.kind === 'array') return obj.cells;
    if (obj.kind === 'list') return obj.items;
    throw new RuntimeError(`for-each cannot iterate ${this.refLabel(v.id)}`, line);
  }

  private arrayOf(v: Val): Extract<HeapObj, { kind: 'array' }> {
    if (v.t !== 'ref') throw new RuntimeError('NullPointerException: array is null', this.top()?.line ?? 0);
    const obj = this.heap.get(v.id);
    if (!obj || obj.kind !== 'array') throw new RuntimeError('Expected an array', this.top()?.line ?? 0);
    return obj;
  }

  private readField(target: Val, name: string): Val {
    if (target.t === 'ns') {
      if (target.name === 'System' && name === 'out') return OUTV;
      if (target.name === 'System' && name === 'in') return { t: 'in' };
      // `Map.Entry` used as a namespace for comparingByKey/comparingByValue
      if (target.name === 'Map' && name === 'Entry') return { t: 'ns', name: 'Map.Entry' };
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

  /* ---------- Scanner ---------- */

  /** every read lands in the trace, so the Inputs panel explains itself */
  private scannerCall(name: string): Val {
    const line = this.top()?.line ?? 0;
    const take = (what: 'line' | 'token') => {
      const value = what === 'line' ? this.input.nextLine() : this.input.next();
      if (value === null) {
        throw new JavaException('NoSuchElementException', what === 'line' ? 'No line found' : 'No more tokens');
      }
      return value;
    };

    switch (name) {
      case 'nextLine': {
        const text = take('line');
        this.snap('stmt', `read line → "${text}"`);
        return STR(text);
      }
      case 'next': {
        const text = take('token');
        this.snap('stmt', `read → "${text}"`);
        return STR(text);
      }
      case 'nextInt':
      case 'nextLong': {
        const token = take('token');
        if (!/^[+-]?\d+$/.test(token)) {
          throw new JavaException('InputMismatchException', `For input string: "${token}"`);
        }
        this.snap('stmt', `read ${name === 'nextInt' ? 'int' : 'long'} → ${token}`);
        return name === 'nextInt' ? INT(Number(token)) : LONG(Number(token));
      }
      case 'nextDouble': {
        const token = take('token');
        const value = Number(token);
        if (!Number.isFinite(value)) throw new JavaException('InputMismatchException', `For input string: "${token}"`);
        this.snap('stmt', `read double → ${token}`);
        return DBL(value);
      }
      case 'nextBoolean': {
        const token = take('token').toLowerCase();
        if (token !== 'true' && token !== 'false') {
          throw new JavaException('InputMismatchException', 'Expected true or false');
        }
        this.snap('stmt', `read boolean → ${token}`);
        return BOOL(token === 'true');
      }
      case 'hasNext':
        return BOOL(this.input.hasNext());
      case 'hasNextLine':
        return BOOL(this.input.hasNextLine());
      case 'hasNextInt':
      case 'hasNextLong': {
        const token = this.input.peek();
        return BOOL(token !== null && /^[+-]?\d+$/.test(token));
      }
      case 'hasNextDouble': {
        const token = this.input.peek();
        return BOOL(token !== null && Number.isFinite(Number(token)));
      }
      case 'close':
        return NULLV;
      default:
        throw new RuntimeError(
          `Scanner.${name}() is not supported — use next(), nextLine(), nextInt() or nextDouble()`,
          line
        );
    }
  }

  /* ---------- construction ---------- */

  private construct(e: Extract<Expr, { t: 'new' }>): Val {
    if (e.init) return this.arrayInit(e.init, e.name || this.inferElemType(e.init));

    if (e.dims.length > 0) {
      const sizes = e.dims.map((d) => (d ? this.num(this.eval(d)) : 0));
      for (const size of sizes) {
        if (size < 0 || size > MAX_ARRAY) throw new RuntimeError(`Bad array size ${size}`, this.top()?.line ?? 0);
      }
      return this.makeArray(e.name, sizes, 0);
    }

    // Scanner reads the shared standard-input buffer; whether the argument is
    // System.in or a literal string makes no difference to the trace
    if (e.name === 'Scanner') return { t: 'scanner' };

    // a constructor argument is either a comparator or a collection to copy
    const ctorArg = () => {
      if (!e.args.length) return { cmp: undefined as Val | undefined, source: undefined as Val | undefined };
      const value = this.eval(e.args[0]);
      if (value.t === 'cmpr') return { cmp: value as Val, source: undefined as Val | undefined };
      return { cmp: undefined as Val | undefined, source: value };
    };

    if (e.name === 'ArrayList' || e.name === 'LinkedList') {
      // `new ArrayList<>(other)` copies the elements it is given
      const { source } = ctorArg();
      const items = source ? [...this.elementsOf(source)] : [];
      const list = this.alloc({ kind: 'list', elemType: 'Object', items: items as Val[] });
      return { t: 'ref', id: list.id };
    }

    // queues, deques, stacks and priority queues all read as a list of values
    // (a user class named `Stack` still wins — see the classMap lookup below)
    if (!this.classMap.has(e.name) && ['Stack', 'Queue', 'Deque', 'ArrayDeque', 'PriorityQueue'].includes(e.name)) {
      const { cmp, source } = ctorArg();
      const items = source ? [...this.elementsOf(source)] : [];
      const list = this.alloc({ kind: 'list', elemType: e.name === 'Stack' ? 'Stack' : e.name, items, cmp });
      return { t: 'ref', id: list.id };
    }

    if (e.name === 'HashMap' || e.name === 'TreeMap' || e.name === 'LinkedHashMap' || e.name === 'Map') {
      const { cmp, source } = ctorArg();
      const entries: { key: Val; value: Val }[] = [];
      if (source) {
        const from = source.t === 'ref' ? this.heap.get(source.id) : undefined;
        if (from?.kind === 'map') entries.push(...from.entries.map((entry) => ({ key: entry.key, value: entry.value })));
      }
      const mapType = e.name === 'Map' ? 'HashMap' : e.name;
      if (mapType === 'TreeMap' && entries.length) entries.sort((a, b) => this.compareValues(a.key, b.key, cmp));
      const map = this.alloc({ kind: 'map', mapType, entries, cmp });
      return { t: 'ref', id: map.id };
    }

    if (e.name === 'HashSet' || e.name === 'LinkedHashSet' || e.name === 'TreeSet' || e.name === 'Set') {
      const { cmp, source } = ctorArg();
      const items: Val[] = [];
      for (const item of source ? this.elementsOf(source) : []) {
        if (!items.some((seen) => this.equals(seen, item))) items.push(item);
      }
      if (e.name === 'TreeSet') items.sort((a, b) => this.compareValues(a, b, cmp));
      const set = this.alloc({ kind: 'list', elemType: e.name === 'TreeSet' ? 'TreeSet' : 'Set', items, cmp });
      return { t: 'ref', id: set.id };
    }

    // `new String(char[])`
    if (e.name === 'String' && e.args.length) {
      const arg = this.eval(e.args[0]);
      if (arg.t === 'ref') {
        const src = this.heap.get(arg.id);
        if (src?.kind === 'array') return STR(src.cells.map((cell) => this.str(cell)).join(''));
      }
      return STR(this.str(arg));
    }

    if (BUILTIN_EXCEPTIONS.has(e.name)) {
      const message = e.args.length ? this.str(this.eval(e.args[0])) : '';
      return { t: 'exc', type: e.name, message };
    }

    if (e.name === 'StringBuilder' || e.name === 'StringBuffer') {
      const text = e.args.length ? this.str(this.eval(e.args[0])) : '';
      const builder = this.alloc({ kind: 'builder', text });
      return { t: 'ref', id: builder.id };
    }

    // `new Outer.Node()` — nested classes are registered under their simple name
    const cls = this.classMap.get(e.name) ?? this.classMap.get(e.name.split('.').pop() ?? '');
    if (!cls) throw new RuntimeError(`unknown class "${e.name}"`, this.top()?.line ?? 0);
    this.ensureStatics(cls);
    const args = e.args.map((a) => this.eval(a));

    const obj = this.alloc({ kind: 'object', className: cls.name, fields: [] as { name: string; value: Val }[] });
    const ref: Val = { t: 'ref', id: obj.id };

    const frame = this.top()!;
    const savedThis = frame.thisVal;
    frame.thisVal = ref;
    try {
      // inherited fields exist on the object too, base class first
      for (const field of this.fieldChain(cls)) {
        const value = field.init ? this.eval(field.init) : this.defaultFor(field.type);
        obj.fields.push({ name: field.name, value: this.coerce(field.type, value) });
      }
      // then the instance initializer blocks, again base class first
      for (const owner of this.chainOf(cls).reverse()) {
        for (const block of owner.instanceInit ?? []) this.exec(block);
      }
    } finally {
      frame.thisVal = savedThis;
    }

    const ctor = this.findCtor(cls, args.length);
    if (ctor) this.invoke(ctor.cls, ctor.method, ref, args);
    else if (args.length > 0) throw new RuntimeError(`No constructor ${cls.name}(${args.length} args)`, frame.line);

    return ref;
  }

  /** `{'h', 'i'}` is a char[] even though the literal names no type */
  private inferElemType(items: Expr[]): string {
    const first = items[0];
    if (!first) return 'int';
    switch (first.t) {
      case 'char':
        return 'char';
      case 'str':
        return 'String';
      case 'bool':
        return 'boolean';
      case 'num':
        return first.isDouble ? 'double' : first.isLong ? 'long' : 'int';
      default:
        return 'Object';
    }
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
      // the last `T... xs` parameter collects every remaining argument
      if (i === method.params.length - 1 && param.type.dims > 0) {
        if (args.length === method.params.length && args[i]?.t === 'ref') {
          frame.vars.set(param.name, { type: { name: param.type.name, dims: 1 }, value: args[i] });
          return;
        }
        const cells = args.slice(i).map((value) => this.coerce({ name: param.type.name, dims: 0 }, value));
        const packed: Val = { t: 'ref', id: this.alloc({ kind: 'array', elemType: param.type.name, cells, dims: [cells.length] }).id };
        frame.vars.set(param.name, { type: { name: param.type.name, dims: 1 }, value: packed });
        return;
      }
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
      // the declared return type decides the value's kind, so `double area()` keeps 9.0
      if (!method.isCtor && result.t !== 'null') result = this.coerce(method.ret, result);
      this.snap('return', `return${result.t === 'null' ? ' (void)' : ' ' + this.text(result)}`);
      this.frames.pop();
    }
    return result;
  }

  private call(e: Extract<Expr, { t: 'call' }>): Val {
    const { callee, args } = e;
    const frame = this.top()!;

    // super(...) runs the parent constructor on the object being built
    if (callee.t === 'super') {
      const cls = this.classMap.get(frame.owner);
      const parentName = cls?.parent;
      const parent = parentName ? this.classMap.get(parentName) : undefined;
      // `class Boom extends RuntimeException` — super(msg) only records the message
      if (!parent && parentName && BUILTIN_EXCEPTIONS.has(parentName) && frame.thisVal?.t === 'ref') {
        const obj = this.heap.get(frame.thisVal.id);
        if (obj?.kind === 'object') {
          const message = args.length ? this.str(this.eval(args[0])) : '';
          obj.fields = obj.fields.filter((f) => f.name !== 'message');
          obj.fields.push({ name: 'message', value: STR(message) });
        }
        return NULLV;
      }
      if (!parent) throw new RuntimeError(`${cls?.name ?? 'this'} has no superclass`, frame.line);
      const ctor = this.findCtor(parent, args.length);
      if (!ctor) throw new RuntimeError(`no constructor ${parent.name}(${args.length} args)`, frame.line);
      return this.invoke(ctor.cls, ctor.method, frame.thisVal, args.map((a) => this.eval(a)), true);
    }

    if (callee.t === 'id') {
      const cls = this.classMap.get(frame.owner);
      if (!cls) throw new RuntimeError(`unknown class ${frame.owner}`, frame.line);
      // a call on `this` dispatches on the real object, so overrides win
      let lookup = cls;
      if (frame.thisVal?.t === 'ref') {
        const self = this.heap.get(frame.thisVal.id);
        if (self?.kind === 'object') lookup = this.classMap.get(self.className) ?? cls;
      }
      const found = this.findMethod(lookup, callee.name, args.length);
      if (!found) throw new RuntimeError(`cannot find method ${callee.name}(${args.length} args)`, frame.line);
      const values = args.map((a) => this.eval(a));
      return this.invoke(found.cls, found.method, found.method.isStatic ? null : frame.thisVal, values);
    }

    if (callee.t === 'field') {
      // super.method(...) starts the lookup at the parent
      if (callee.target.t === 'super') {
        const cls = this.classMap.get(frame.owner);
        const parent = cls?.parent ? this.classMap.get(cls.parent) : undefined;
        const found = this.findMethod(parent, callee.name, args.length);
        if (!found) throw new RuntimeError(`no super method ${callee.name}()`, frame.line);
        return this.invoke(found.cls, found.method, frame.thisVal, args.map((a) => this.eval(a)));
      }
      const receiver = this.eval(callee.target);
      const values = args.map((a) => this.eval(a));
      return this.callOn(receiver, callee.name, values);
    }

    throw new RuntimeError('Unsupported call target', this.top()?.line ?? 0);
  }

  private callOn(receiver: Val, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;

    if (receiver.t === 'stream') return this.streamCall(receiver.items, name, args);

    if (receiver.t === 'cmpr') {
      switch (name) {
        case 'reversed':
          return { t: 'cmpr', steps: receiver.steps.map((step) => ({ ...step, desc: !step.desc })) };
        case 'thenComparing':
        case 'thenComparingInt':
        case 'thenComparingLong':
        case 'thenComparingDouble': {
          // thenComparing(fn) or thenComparing(anotherComparator)
          const extra = args[0];
          const steps = extra?.t === 'cmpr' ? extra.steps : [{ fn: extra ?? null, desc: false }];
          return { t: 'cmpr', steps: [...receiver.steps, ...steps] };
        }
        case 'compare':
          return INT(this.compareValues(args[0] ?? NULLV, args[1] ?? NULLV, receiver));
      }
      throw new RuntimeError(`Comparator.${name}() is not supported`, line);
    }

    if (receiver.t === 'opt') return this.optCall(receiver, name, args);

    if (receiver.t === 'out') {
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

    if (receiver.t === 'scanner') return this.scannerCall(name);

    if (receiver.t === 'in') throw new RuntimeError('System.in is read through new Scanner(System.in)', line);

    if (receiver.t === 'fn') throw new RuntimeError(`${this.text(receiver)} is not a method — use .apply() or a stream`, line);

    if (receiver.t === 'ns') return this.staticCall(receiver.name, name, args);

    if (receiver.t === 'str') return this.stringCall(receiver.v, name, args);

    if (receiver.t === 'enum') {
      switch (name) {
        case 'name':
        case 'toString':
          return STR(receiver.name);
        case 'ordinal':
          return INT(receiver.ordinal);
        case 'equals':
          return BOOL(this.equals(receiver, args[0] ?? NULLV));
        case 'compareTo': {
          const other = args[0];
          if (!other || other.t !== 'enum') throw new RuntimeError('compareTo needs another constant', line);
          return INT(receiver.ordinal - other.ordinal);
        }
        case 'hashCode':
          return INT(receiver.name.length + receiver.ordinal);
      }
      // an enum can declare its own methods: `Color.GREEN.code()`
      const enumCls = this.classMap.get(receiver.type);
      const declared = enumCls ? this.findMethod(enumCls, name, args.length) : null;
      if (declared) return this.invoke(declared.cls, declared.method, receiver, args);
      throw new RuntimeError(`Enum.${name}() is not supported`, line);
    }

    if (receiver.t === 'exc') {
      switch (name) {
        case 'getMessage':
          return STR(receiver.message);
        case 'toString':
          return STR(receiver.message ? `${receiver.type}: ${receiver.message}` : receiver.type);
        case 'printStackTrace':
          return NULLV;
        case 'getClass':
          return STR(receiver.type);
        case 'getLocalizedMessage':
          return STR(receiver.message);
      }
      throw new RuntimeError(`Exception.${name}() is not supported`, line);
    }

    if (receiver.t === 'null') throw new RuntimeError(`NullPointerException: calling ${name}() on null`, line);

    if (receiver.t === 'ref') {
      const obj = this.heap.get(receiver.id);
      if (!obj) throw new RuntimeError('NullPointerException', line);

      if (obj.kind === 'list') return this.listCall(obj, name, args);

      if (obj.kind === 'map') return this.mapCall(obj, name, args);

      if (obj.kind === 'builder') return this.builderCall(obj, name, args);

      if (obj.kind === 'iterator') {
        switch (name) {
          case 'hasNext':
            return BOOL(obj.at < obj.of.length);
          case 'next': {
            if (obj.at >= obj.of.length) throw new JavaException('NoSuchElementException', 'the iterator is exhausted');
            return obj.of[obj.at++];
          }
          case 'remove':
            return NULLV;
        }
        throw new RuntimeError(`Iterator.${name}() is not supported`, line);
      }

      if (obj.kind === 'object') {
        // a map entry is a plain object with key/value fields
        if (obj.className === 'Map.Entry') {
          const key = obj.fields.find((f) => f.name === 'key')?.value ?? NULLV;
          const value = obj.fields.find((f) => f.name === 'value')?.value ?? NULLV;
          if (name === 'getKey') return key;
          if (name === 'getValue') return value;
          if (name === 'toString') return STR(`${this.str(key)}=${this.str(value)}`);
        }
        const found = this.findMethod(this.classMap.get(obj.className), name, args.length);
        if (!found) {
          if (name === 'toString') return STR(`${obj.className}@${obj.id}`);
          throw new RuntimeError(`${obj.className} has no method ${name}()`, line);
        }
        return this.invoke(found.cls, found.method, receiver, args);
      }

      throw new RuntimeError(`Cannot call ${name}() on an array`, line);
    }

    throw new RuntimeError(`Cannot call ${name}() on ${receiver.t}`, line);
  }

  /** printf / String.format: %d %s %f %x %c %b %n %% with width and precision */
  private printf(fmt: string, args: Val[]): string {
    let i = 0;
    return fmt.replace(/%([-+0 ])?(\d+)?(?:\.(\d+))?([sdfxXbcneE%])/g, (match, flag: string, width: string, prec: string, conv: string) => {
      if (conv === '%') return '%';
      if (conv === 'n') return '\n';
      const arg = args[i++];
      if (!arg) return match;

      let out: string;
      switch (conv) {
        case 'd':
          out = String(this.numeric(arg) | 0);
          break;
        case 'f':
        case 'e':
        case 'E':
          out = Number(this.numeric(arg)).toFixed(prec === undefined ? 6 : Number(prec));
          break;
        case 'x':
          out = (this.numeric(arg) | 0).toString(16);
          break;
        case 'X':
          out = (this.numeric(arg) | 0).toString(16).toUpperCase();
          break;
        case 'c':
          out = arg.t === 'char' ? arg.v : String.fromCharCode(this.numeric(arg));
          break;
        case 'b':
          out = String(arg.t === 'bool' ? arg.v : arg.t !== 'null');
          break;
        default:
          out = this.str(arg);
      }

      const w = width ? Number(width) : 0;
      if (out.length < w) {
        const pad = flag === '0' ? '0' : ' ';
        const fill = pad.repeat(w - out.length);
        out = flag === '-' ? out + fill : fill + out;
      }
      return out;
    });
  }

  private staticCall(className: string, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;

    // enum helpers: values() and valueOf()
    const enumCls = this.classMap.get(className);
    if (enumCls?.kind === 'enum') {
      const names = enumCls.constants ?? [];
      if (name === 'values') {
        return {
          t: 'ref',
          id: this.alloc({
            kind: 'array',
            elemType: className,
            cells: names.map((constant, ordinal) => ({ t: 'enum' as const, type: className, name: constant, ordinal })),
            dims: [names.length],
          }).id,
        };
      }
      if (name === 'valueOf') {
        const wanted = this.str(args[0] ?? NULLV);
        const at = names.indexOf(wanted);
        if (at < 0) throw new JavaException('IllegalArgumentException', `No enum constant ${className}.${wanted}`);
        return { t: 'enum', type: className, name: wanted, ordinal: at };
      }
    }

    switch (`${className}.${name}`) {
      case 'String.format':
        return STR(this.printf(this.str(args[0] ?? NULLV), args.slice(1)));
      case 'Map.entry':
        return { t: 'ref', id: this.alloc({ kind: 'object', className: 'Map.Entry', fields: [{ name: 'key', value: args[0] ?? NULLV }, { name: 'value', value: args[1] ?? NULLV }] }).id };
      case 'Double.parseDouble':
      case 'Float.parseFloat': {
        const text = this.str(args[0] ?? NULLV).trim();
        const value = Number(text);
        if (Number.isNaN(value)) throw new JavaException('NumberFormatException', `For input string: "${text}"`);
        return DBL(value);
      }
      case 'Integer.bitCount':
        return INT((this.num(args[0]) >>> 0).toString(2).replace(/0/g, '').length);
      case 'Integer.toBinaryString':
        return STR((this.num(args[0]) >>> 0).toString(2));
      case 'Integer.toHexString':
        return STR((this.num(args[0]) >>> 0).toString(16));
      case 'Integer.highestOneBit': {
        const value = this.num(args[0]);
        return INT(value > 0 ? 1 << (31 - Math.clz32(value)) : 0);
      }
      case 'Math.log':
        return DBL(Math.log(this.numeric(args[0])));
      case 'Math.log10':
        return DBL(Math.log10(this.numeric(args[0])));
      case 'Math.exp':
        return DBL(Math.exp(this.numeric(args[0])));
      case 'Math.sin':
        return DBL(Math.sin(this.numeric(args[0])));
      case 'Math.cos':
        return DBL(Math.cos(this.numeric(args[0])));
      case 'Math.tan':
        return DBL(Math.tan(this.numeric(args[0])));
      case 'Math.cbrt':
        return DBL(Math.cbrt(this.numeric(args[0])));
      case 'Math.signum':
        return DBL(Math.sign(this.numeric(args[0])));
      case 'Math.hypot':
        return DBL(Math.hypot(this.numeric(args[0]), this.numeric(args[1])));
      case 'Math.asin':
        return DBL(Math.asin(this.numeric(args[0])));
      case 'Math.acos':
        return DBL(Math.acos(this.numeric(args[0])));
      case 'Math.atan':
        return DBL(Math.atan(this.numeric(args[0])));
      case 'Math.atan2':
        return DBL(Math.atan2(this.numeric(args[0]), this.numeric(args[1])));
      case 'Math.toRadians':
        return DBL((this.numeric(args[0]) * Math.PI) / 180);
      case 'Math.toDegrees':
        return DBL((this.numeric(args[0]) * 180) / Math.PI);
      case 'Math.log1p':
        return DBL(Math.log1p(this.numeric(args[0])));
      case 'Math.copySign':
        return DBL(Math.sign(this.numeric(args[1])) * Math.abs(this.numeric(args[0])));
      case 'Math.floorDiv': {
        const divisor = this.numeric(args[1]);
        if (divisor === 0) throw new JavaException('ArithmeticException', '/ by zero');
        return INT(Math.floor(this.numeric(args[0]) / divisor));
      }
      case 'Math.floorMod': {
        const divisor = this.numeric(args[1]);
        if (divisor === 0) throw new JavaException('ArithmeticException', '/ by zero');
        return INT(((this.numeric(args[0]) % divisor) + divisor) % divisor);
      }
      case 'Arrays.binarySearch': {
        const cells = this.arrayOf(args[0]).cells;
        let lo = 0;
        let hi = cells.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const cmp = this.compareValues(cells[mid], args[1], args[2]);
          if (cmp === 0) {
            found = mid;
            break;
          }
          if (cmp < 0) lo = mid + 1;
          else hi = mid - 1;
        }
        return INT(found >= 0 ? found : -(lo + 1));
      }
      case 'Arrays.copyOfRange': {
        const arr = this.arrayOf(args[0]);
        const from = this.num(args[1]);
        const to = Math.min(this.num(args[2]), arr.cells.length);
        const cells = Array.from({ length: Math.max(0, to - from) }, (_, k) => arr.cells[from + k] ?? this.defaultFor({ name: arr.elemType, dims: 0 }));
        return { t: 'ref', id: this.alloc({ kind: 'array', elemType: arr.elemType, cells, dims: [cells.length] }).id };
      }
      case 'Collections.singletonList':
        return this.newList([args[0] ?? NULLV]);
      case 'Collections.singleton':
      case 'Collections.singletonSet':
        return this.newList([args[0] ?? NULLV], 'Set');
      case 'Collections.singletonMap':
        return { t: 'ref', id: this.alloc({ kind: 'map', mapType: 'HashMap', entries: [{ key: args[0] ?? NULLV, value: args[1] ?? NULLV }] }).id };
      case 'Collections.nCopies': {
        const count = Math.max(0, this.num(args[0]));
        return this.newList(Array.from({ length: count }, () => args[1] ?? NULLV));
      }
      case 'Collections.fill': {
        const target = args[0];
        if (target?.t === 'ref') {
          const obj = this.heap.get(target.id);
          if (obj?.kind === 'list') obj.items = obj.items.map(() => args[1] ?? NULLV);
          else if (obj?.kind === 'array') obj.cells = obj.cells.map(() => args[1] ?? NULLV);
        }
        return NULLV;
      }
      case 'Collections.addAll': {
        const list = this.listOf(args[0]);
        const extra = args.slice(1).flatMap((arg) => (arg.t === 'ref' && this.elementsOf(arg).length ? this.elementsOf(arg) : [arg]));
        for (const item of extra) list.items.push(item);
        return BOOL(extra.length > 0);
      }
      case 'System.arraycopy': {
        const source = this.elementsOf(args[0]);
        const sourceAt = this.num(args[1]);
        const count = this.num(args[4]);
        const copied = Array.from({ length: count }, (_, k) => source[sourceAt + k] ?? NULLV);
        const destination = args[2]?.t === 'ref' ? this.heap.get(args[2].id) : undefined;
        const at = this.num(args[3]);
        if (destination?.kind === 'array') copied.forEach((value, k) => (destination.cells[at + k] = value));
        else if (destination?.kind === 'list') copied.forEach((value, k) => (destination.items[at + k] = value));
        return NULLV;
      }
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
      case 'Integer.parseInt': {
        const radix = args[1] ? this.num(args[1]) : 10;
        const text = this.str(args[0] ?? NULLV).trim();
        const value = parseInt(text, radix);
        if (Number.isNaN(value)) throw new JavaException('NumberFormatException', `For input string: "${text}"`);
        return INT(value);
      }
      case 'Integer.toString':
        return STR(String(this.numeric(args[0])));
      case 'String.valueOf': {
        const arg = args[0] ?? NULLV;
        // String.valueOf(char[]) builds text; anything else is toString()
        return STR(this.charArrayText(arg) ?? this.str(arg));
      }
      case 'Optional.of':
        return { t: 'opt', empty: false, value: args[0] ?? NULLV };
      case 'Optional.ofNullable':
        return (args[0] ?? NULLV).t === 'null'
          ? { t: 'opt', empty: true, value: NULLV }
          : { t: 'opt', empty: false, value: args[0] };
      case 'Optional.empty':
        return { t: 'opt', empty: true, value: NULLV };
      case 'Objects.isNull':
        return BOOL((args[0] ?? NULLV).t === 'null');
      case 'Objects.nonNull':
        return BOOL((args[0] ?? NULLV).t !== 'null');
      case 'Objects.toString':
        return STR((args[0] ?? NULLV).t === 'null' ? (args[1] ? this.str(args[1]) : 'null') : this.str(args[0]));
      case 'Objects.hashCode':
        return INT(this.str(args[0] ?? NULLV).length);
      case 'Character.isDigit':
        return BOOL(/^[0-9]$/.test(this.str(args[0])));
      case 'Character.isLetter':
        return BOOL(/^[A-Za-z]$/.test(this.str(args[0])));
      case 'Character.isLetterOrDigit':
        return BOOL(/^[A-Za-z0-9]$/.test(this.str(args[0])));
      case 'Character.isAlphabetic':
        return BOOL(/^[A-Za-z]$/.test(this.str(args[0])));
      case 'Character.isWhitespace':
      case 'Character.isSpaceChar':
        return BOOL(/^\s$/.test(this.str(args[0])));
      case 'Character.isUpperCase':
        return BOOL(/^[A-Z]$/.test(this.str(args[0])));
      case 'Character.isLowerCase':
        return BOOL(/^[a-z]$/.test(this.str(args[0])));
      case 'Character.toUpperCase':
        return CHR(this.str(args[0]).toUpperCase());
      case 'Character.toLowerCase':
        return CHR(this.str(args[0]).toLowerCase());
      case 'Character.getNumericValue':
        return INT(Number.parseInt(this.str(args[0]), 36));
      case 'Character.compare':
        return INT(this.numeric(args[0]) - this.numeric(args[1]));
      case 'Arrays.toString': {
        const arr = this.arrayOf(args[0]);
        return STR(`[${arr.cells.map((c) => this.str(c)).join(', ')}]`);
      }
      case 'Arrays.deepToString':
        return STR(this.deepText(args[0]));
      case 'Arrays.sort': {
        const arr = this.arrayOf(args[0]);
        // Arrays.sort(a, from, to) sorts a range, Arrays.sort(a, cmp) a whole array
        if (args.length >= 3 && (args[1]?.t === 'int' || args[1]?.t === 'long')) {
          const from = Math.max(0, this.num(args[1]));
          const to = Math.min(arr.cells.length, this.num(args[2]));
          const sorted = arr.cells.slice(from, to).sort((x, y) => this.compareValues(x, y));
          arr.cells = [...arr.cells.slice(0, from), ...sorted, ...arr.cells.slice(to)];
          return NULLV;
        }
        const cmp = args[1]?.t === 'cmpr' || args[1]?.t === 'fn' ? args[1] : undefined;
        arr.cells.sort((x, y) => this.compareValues(x, y, cmp));
        return NULLV;
      }
      case 'Collections.reverse': {
        const list = this.listOf(args[0]);
        list.items.reverse();
        return NULLV;
      }
      case 'Collections.sort': {
        const list = this.listOf(args[0]);
        list.items.sort((a, b) => this.compareValues(a, b, args[1]));
        return NULLV;
      }
      case 'Collections.max':
      case 'Collections.min': {
        const items = this.elementsOf(args[0]);
        if (!items.length) throw new RuntimeError('NoSuchElementException: the collection is empty', line);
        let best = items[0];
        for (const item of items.slice(1)) {
          const cmp = this.compareValues(item, best, args[1]);
          if (name === 'max' ? cmp > 0 : cmp < 0) best = item;
        }
        return best;
      }
      case 'Collections.swap': {
        const list = this.listOf(args[0]);
        const i = this.num(args[1]);
        const j = this.num(args[2]);
        const temp = list.items[i];
        list.items[i] = list.items[j];
        list.items[j] = temp;
        return NULLV;
      }
      case 'Collections.frequency':
        return INT(this.elementsOf(args[0]).filter((item) => this.equals(item, args[1])).length);
      case 'Collections.emptyList':
      case 'Collections.emptySet':
        return this.newList([]);
      case 'Collections.unmodifiableList':
        return args[0];
      case 'Arrays.asList':
      case 'Arrays.stream': {
        if (className === 'Arrays' && name === 'stream') {
          return { t: 'stream', items: [...this.arrayOf(args[0]).cells] };
        }
        const list = this.newList([...args]);
        return list;
      }
      case 'List.of':
      case 'Set.of': {
        if (className === 'Set') {
          const unique: Val[] = [];
          for (const item of args) if (!unique.some((v) => this.equals(v, item))) unique.push(item);
          return this.newList(unique, 'Set');
        }
        return this.newList([...args]);
      }
      case 'Map.of': {
        const entries: { key: Val; value: Val }[] = [];
        for (let i = 0; i + 1 < args.length; i += 2) entries.push({ key: args[i], value: args[i + 1] });
        return { t: 'ref', id: this.alloc({ kind: 'map', mapType: 'Map', entries }).id };
      }
      case 'Stream.of':
        return { t: 'stream', items: [...args] };
      case 'IntStream.of':
        return { t: 'stream', items: [...args] };
      case 'IntStream.range':
      case 'IntStream.rangeClosed': {
        const from = this.num(args[0]);
        const to = this.num(args[1]);
        const items: Val[] = [];
        for (let i = from; name === 'range' ? i < to : i <= to; i++) items.push(INT(i));
        return { t: 'stream', items };
      }
      case 'Comparator.comparing':
      case 'Comparator.comparingInt':
      case 'Comparator.comparingLong':
      case 'Comparator.comparingDouble':
        return { t: 'cmpr', steps: [{ fn: args[0], desc: false }] };
      case 'Comparator.reverseOrder':
      case 'Collections.reverseOrder':
        return { t: 'cmpr', steps: [{ fn: null, desc: true }] };
      case 'Comparator.naturalOrder':
        return { t: 'cmpr', steps: [] };
      case 'Map.Entry.comparingByKey':
        return { t: 'cmpr', steps: [{ fn: { t: 'fn', id: this.builtinFn({ kind: 'entry', field: 'key' }) }, desc: false }] };
      case 'Map.Entry.comparingByValue':
        return { t: 'cmpr', steps: [{ fn: { t: 'fn', id: this.builtinFn({ kind: 'entry', field: 'value' }) }, desc: false }] };
      case 'Collectors.toList':
      case 'Collectors.toUnmodifiableList':
        return { t: 'collector', kind: 'list' };
      case 'Collectors.toSet':
      case 'Collectors.toUnmodifiableSet':
        return { t: 'collector', kind: 'set' };
      case 'Collectors.counting':
        return { t: 'collector', kind: 'count' };
      case 'Collectors.joining':
        return {
          t: 'collector',
          kind: 'join',
          sep: args[0] ? this.str(args[0]) : '',
          prefix: args[1] ? this.str(args[1]) : '',
          suffix: args[2] ? this.str(args[2]) : '',
        };
      case 'Collectors.groupingBy':
        return { t: 'collector', kind: 'group', fn: args[0], downstream: args[1] };
      case 'Collectors.toMap':
        return { t: 'collector', kind: 'toMap', fn: args[0], fn2: args[1] };
      case 'Collectors.partitioningBy':
        return { t: 'collector', kind: 'partitionBy', fn: args[0], downstream: args[1] };
      case 'Collectors.summingInt':
      case 'Collectors.summingDouble':
        return { t: 'collector', kind: 'sum', fn: args[0] };
      case 'Collectors.averagingInt':
      case 'Collectors.averagingDouble':
        return { t: 'collector', kind: 'avg', fn: args[0] };
      case 'Collectors.mapping':
        return { t: 'collector', kind: 'mapping', fn: args[0], downstream: args[1] };
      case 'Collectors.toUnmodifiableMap':
        return { t: 'collector', kind: 'toMap', fn: args[0], fn2: args[1] };
      case 'Integer.compare':
      case 'Double.compare':
      case 'Long.compare':
        return INT(this.numeric(args[0]) < this.numeric(args[1]) ? -1 : this.numeric(args[0]) > this.numeric(args[1]) ? 1 : 0);
      case 'Integer.sum':
        return INT(this.num(args[0]) + this.num(args[1]));
      case 'Integer.max':
        return INT(Math.max(this.num(args[0]), this.num(args[1])));
      case 'Integer.min':
        return INT(Math.min(this.num(args[0]), this.num(args[1])));
      case 'Integer.valueOf':
      case 'Long.valueOf':
      case 'Double.valueOf':
      case 'Objects.requireNonNull':
        return args[0] ?? NULLV;
      case 'Objects.equals':
        return BOOL(this.equals(args[0] ?? NULLV, args[1] ?? NULLV));
      case 'Long.parseLong': {
        const text = this.str(args[0] ?? NULLV).trim();
        const value = parseInt(text, 10);
        if (Number.isNaN(value)) throw new JavaException('NumberFormatException', `For input string: "${text}"`);
        return LONG(value);
      }
      case 'String.join': {
        const sep = this.str(args[0]);
        const parts: string[] = [];
        for (const arg of args.slice(1)) {
          if (arg.t === 'ref') parts.push(...this.elementsOf(arg).map((item) => this.str(item)));
          else parts.push(this.str(arg));
        }
        return STR(parts.join(sep));
      }
      case 'Arrays.fill': {
        const arr = this.arrayOf(args[0]);
        // Arrays.fill(a, from, to, value) fills a range only
        if (args.length >= 4) {
          const from = Math.max(0, this.num(args[1]));
          const to = Math.min(arr.cells.length, this.num(args[2]));
          for (let i = from; i < to; i++) arr.cells[i] = args[3] ?? NULLV;
          return NULLV;
        }
        arr.cells = arr.cells.map(() => args[1]);
        return NULLV;
      }
      case 'Arrays.copyOf': {
        const arr = this.arrayOf(args[0]);
        const size = this.num(args[1]);
        const cells = Array.from({ length: size }, (_, i) => arr.cells[i] ?? this.defaultFor({ name: arr.elemType, dims: 0 }));
        return { t: 'ref', id: this.alloc({ kind: 'array', elemType: arr.elemType, cells, dims: [size] }).id };
      }
      case 'Arrays.equals': {
        const a = this.arrayOf(args[0]).cells;
        const b = this.arrayOf(args[1]).cells;
        return BOOL(a.length === b.length && a.every((cell, i) => this.equals(cell, b[i])));
      }
      case 'Arrays.deepEquals':
        return BOOL(this.deepEquals(args[0], args[1]));
    }

    const cls = this.classMap.get(className);
    if (cls) {
      const method = cls.methods.find((m) => m.name === name && !m.isCtor && m.params.length === args.length);
      if (method) return this.invoke(cls, method, method.isStatic ? null : args[0] ?? null, args);

      // `Person::name` in a stream maps an instance to instance.name()
      const receiver = args[0];
      if (receiver?.t === 'ref') {
        const target = this.heap.get(receiver.id);
        if (target?.kind === 'object') {
          const found = this.findMethod(this.classMap.get(target.className), name, args.length - 1);
          if (found) return this.invoke(found.cls, found.method, receiver, args.slice(1));
        }
      }
    }

    // `String::length`, `List::size` — an unbound instance method reference:
    // the first argument is the receiver
    if (args.length > 0) {
      try {
        return this.callOn(args[0], name, args.slice(1));
      } catch {
        // fall through to the error below
      }
    }

    throw new RuntimeError(`Unsupported call ${className}.${name}()`, line);
  }

  /** Java and JavaScript regex syntax agree on everything the tracer needs */
  private regex(pattern: string): RegExp {
    try {
      return new RegExp(pattern, 'g');
    } catch {
      throw new RuntimeError(`bad regular expression ${pattern}`, this.top()?.line ?? 0);
    }
  }

  private replaceWith(text: string, pattern: string, replacement: string, all: boolean): string {
    const single = new RegExp(pattern);
    return all ? text.replace(this.regex(pattern), replacement) : text.replace(single, replacement);
  }

  /** the text of a char[] argument, or null when the value is not a char array */
  private charArrayText(v: Val): string | null {
    if (v.t !== 'ref') return null;
    const obj = this.heap.get(v.id);
    if (obj?.kind !== 'array' || obj.elemType !== 'char') return null;
    return obj.cells.map((cell) => this.str(cell)).join('');
  }

  /** Arrays.deepToString: nested arrays render, everything else uses toString */
  private deepText(v: Val): string {
    if (v.t === 'ref') {
      const obj = this.heap.get(v.id);
      if (obj?.kind === 'array') return `[${obj.cells.map((cell) => this.deepText(cell)).join(', ')}]`;
    }
    if (v.t === 'null') return 'null';
    return this.str(v);
  }

  private deepEquals(a: Val, b: Val): boolean {
    const left = a.t === 'ref' ? this.heap.get(a.id) : undefined;
    const right = b.t === 'ref' ? this.heap.get(b.id) : undefined;
    if (left?.kind === 'array' && right?.kind === 'array') {
      return left.cells.length === right.cells.length && left.cells.every((cell, i) => this.deepEquals(cell, right.cells[i]));
    }
    return this.equals(a, b);
  }

  private stringCall(text: string, name: string, args: Val[]): Val {
    switch (name) {
      case 'length':
        return INT(text.length);
      case 'charAt': {
        const at = this.num(args[0]);
        if (at < 0 || at >= text.length) throw new JavaException('StringIndexOutOfBoundsException', `index ${at}, length ${text.length}`);
        return CHR(text[at]);
      }
      case 'substring': {
        const from = this.num(args[0]);
        const to = args.length > 1 ? this.num(args[1]) : text.length;
        if (from < 0 || to > text.length || from > to) {
          throw new JavaException('StringIndexOutOfBoundsException', `begin ${from}, end ${to}, length ${text.length}`);
        }
        return STR(text.slice(from, to));
      }
      case 'indexOf':
        return INT(text.indexOf(this.str(args[0]), args.length > 1 ? this.num(args[1]) : 0));
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
      case 'split': {
        const limit = args.length > 1 ? this.num(args[1]) : 0;
        // Java's limit stops splitting and leaves the rest in the last part
        const re = this.regex(this.str(args[0]));
        const parts: string[] = [];
        let last = 0;
        for (const match of text.matchAll(re)) {
          if (!match[0] || (limit > 0 && parts.length === limit - 1)) break;
          const at = match.index ?? 0;
          parts.push(text.slice(last, at));
          last = at + match[0].length;
        }
        parts.push(text.slice(last));
        if (limit === 0) while (parts.length && parts[parts.length - 1] === '') parts.pop();
        return { t: 'ref', id: this.alloc({ kind: 'array', elemType: 'String', cells: parts.map((part) => STR(part)), dims: [parts.length] }).id };
      }
      case 'startsWith':
        return BOOL(text.startsWith(this.str(args[0])));
      case 'endsWith':
        return BOOL(text.endsWith(this.str(args[0])));
      case 'replace':
        return STR(text.split(this.str(args[0])).join(this.str(args[1])));
      case 'replaceAll':
        return STR(this.replaceWith(text, this.str(args[0]), this.str(args[1]), true));
      case 'replaceFirst':
        return STR(this.replaceWith(text, this.str(args[0]), this.str(args[1]), false));
      case 'lastIndexOf':
        return INT(args.length > 1 ? text.lastIndexOf(this.str(args[0]), this.num(args[1])) : text.lastIndexOf(this.str(args[0])));
      case 'compareTo': {
        // Java returns the difference of the first differing chars, not just the sign
        const other = this.str(args[0]);
        const shared = Math.min(text.length, other.length);
        for (let i = 0; i < shared; i++) {
          if (text[i] !== other[i]) return INT(text.charCodeAt(i) - other.charCodeAt(i));
        }
        return INT(text.length - other.length);
      }
      case 'strip':
        return STR(text.trim());
      case 'stripLeading':
        return STR(text.replace(/^\s+/, ''));
      case 'stripTrailing':
        return STR(text.replace(/\s+$/, ''));
      case 'chars':
      case 'codePoints':
        return { t: 'stream', items: [...text].map((ch) => INT(ch.codePointAt(0) ?? 0)) };
      case 'codePointAt': {
        const at = this.num(args[0]);
        if (at < 0 || at >= text.length) throw new JavaException('StringIndexOutOfBoundsException', `index ${at}, length ${text.length}`);
        return INT(text.codePointAt(at) ?? 0);
      }
      case 'hashCode': {
        let hash = 0;
        for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
        return INT(hash);
      }
      case 'intern':
        return STR(text);
      case 'concat':
        return STR(text + this.str(args[0]));
      case 'repeat':
        return STR(text.repeat(Math.max(0, this.num(args[0]))));
      case 'isBlank':
        return BOOL(text.trim().length === 0);
      case 'matches': {
        try {
          return BOOL(new RegExp(`^(?:${this.str(args[0])})$`).test(text));
        } catch {
          throw new RuntimeError(`bad regular expression ${this.str(args[0])}`, this.top()?.line ?? 0);
        }
      }
      case 'toCharArray':
        return {
          t: 'ref',
          id: this.alloc({ kind: 'array', elemType: 'char', cells: [...text].map((ch) => CHR(ch)), dims: [text.length] }).id,
        };
      default:
        throw new RuntimeError(`String.${name}() is not supported`, this.top()?.line ?? 0);
    }
  }

  /* ---------- lambdas, method references and streams ---------- */

  /** run a lambda or method reference; params are bound in the caller's frame */
  private builtinFn(spec: FnSpec): number {
    const id = ++this.fnSeq;
    this.fns.set(id, spec);
    return id;
  }

  private apply(fn: Val, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    if (fn.t !== 'fn') throw new RuntimeError(`${this.text(fn)} is not a function`, line);
    const spec = this.fns.get(fn.id);
    if (!spec) throw new RuntimeError('lost a function reference', line);
    if (spec.kind === 'ref') return this.callOn(spec.target, spec.name, args);
    if (spec.kind === 'newArray') {
      const size = Math.max(0, args[0] ? this.num(args[0]) : 0);
      const cells = Array.from({ length: size }, () => this.defaultFor({ name: spec.elemType, dims: 0 }));
      return { t: 'ref', id: this.alloc({ kind: 'array', elemType: spec.elemType, cells, dims: [size] }).id };
    }
    if (spec.kind === 'entry') {
      const target = args[0];
      if (target?.t === 'ref') {
        const obj = this.heap.get(target.id);
        if (obj?.kind === 'object') {
          return obj.fields.find((f) => f.name === spec.field)?.value ?? NULLV;
        }
      }
      return NULLV;
    }

    const frame = this.top()!;
    const saved = new Map<string, VarSlot | undefined>();
    spec.params.forEach((name, i) => {
      saved.set(name, frame.vars.get(name));
      const value = args[i] ?? NULLV;
      frame.vars.set(name, { type: this.inferType(value), value });
    });
    const restoreLine = frame.line;
    frame.line = spec.line;
    try {
      if (spec.block) {
        try {
          this.exec(spec.body as Stmt);
        } catch (e) {
          if (e instanceof ReturnSignal) return e.value;
          throw e;
        }
        return NULLV;
      }
      return this.eval(spec.body as Expr);
    } finally {
      frame.line = restoreLine;
      for (const [name, slot] of saved) {
        if (slot) frame.vars.set(name, slot);
        else frame.vars.delete(name);
      }
    }
  }

  /** a `catch (T e)` handles this throw when T is the thrown type or one of its ancestors */
  private catchesType(thrown: string, caught: string): boolean {
    if (thrown === caught) return true;
    let cls = this.classMap.get(thrown);
    let guard = 0;
    while (cls?.parent && guard++ < 20) {
      if (cls.parent === caught) return true;
      cls = this.classMap.get(cls.parent);
    }
    return false;
  }

  /** true when the class is (or extends) one of the built-in exceptions */
  private extendsException(name: string): boolean {
    let cls = this.classMap.get(name);
    let guard = 0;
    while (cls?.parent && guard++ < 20) {
      if (BUILTIN_EXCEPTIONS.has(cls.parent)) return true;
      cls = this.classMap.get(cls.parent);
    }
    return false;
  }

  /** `throw value` — an instance of a class extending a built-in exception carries its message */
  private asException(value: Val): { t: 'exc'; type: string; message: string } {
    if (value.t === 'ref') {
      const obj = this.heap.get(value.id);
      if (obj?.kind === 'object' && this.extendsException(obj.className)) {
        const message = obj.fields.find((f) => f.name === 'message')?.value;
        return { t: 'exc', type: obj.className, message: message && message.t !== 'null' ? this.str(message) : '' };
      }
    }
    return { t: 'exc', type: 'RuntimeException', message: this.str(value) };
  }

  /** true when a break/continue ends this loop; a labelled jump for an outer loop is rethrown */
  private loopSignal(e: unknown, label?: string): 'break' | 'continue' | null {
    if (e instanceof BreakSignal) {
      if (!e.label || e.label === label) return 'break';
      throw e;
    }
    if (e instanceof ContinueSignal) {
      if (!e.label || e.label === label) return 'continue';
      throw e;
    }
    return null;
  }

  private compareValues(a: Val, b: Val, cmp?: Val): number {
    // `Comparator.naturalOrder()` has no steps, so it falls through to the natural order
    if (cmp?.t === 'cmpr' && cmp.steps.length) {
      for (const step of cmp.steps) {
        const result = step.fn
          ? this.compareValues(this.apply(step.fn, [a]), this.apply(step.fn, [b]))
          : this.compareValues(a, b);
        if (result !== 0) return step.desc ? -result : result;
      }
      return 0;
    }
    if (cmp && cmp.t !== 'cmpr') return this.num(this.apply(cmp, [a, b]));
    if (a.t === 'str' || b.t === 'str') return this.str(a) < this.str(b) ? -1 : this.str(a) > this.str(b) ? 1 : 0;
    return this.numeric(a) - this.numeric(b);
  }

  private listOf(v: Val): Extract<HeapObj, { kind: 'list' }> {
    if (v.t === 'ref') {
      const obj = this.heap.get(v.id);
      if (obj?.kind === 'list') return obj;
    }
    throw new RuntimeError('Expected a list here', this.top()?.line ?? 0);
  }

  /** cells of an array or items of a list, for the stream sources */
  private elementsOf(v: Val): Val[] {
    if (v.t !== 'ref') return [];
    const obj = this.heap.get(v.id);
    if (!obj) return [];
    if (obj.kind === 'array') return obj.cells;
    if (obj.kind === 'list') return obj.items;
    if (obj.kind === 'map') return obj.entries.map((e) => e.key);
    return [];
  }

  private newList(items: Val[], elemType = 'Object'): Val {
    return { t: 'ref', id: this.alloc({ kind: 'list', elemType, items }).id };
  }

  private fromCollector(c: Extract<Val, { t: 'collector' }>, items: Val[]): Val {
    const mapOf = (pairs: { key: Val; value: Val }[]) => ({
      t: 'ref' as const,
      id: this.alloc({ kind: 'map', mapType: 'HashMap', entries: pairs }).id,
    });
    const mapped = (item: Val, fn?: Val) => (fn ? this.apply(fn, [item]) : item);

    switch (c.kind) {
      case 'count':
        return INT(items.length);
      case 'join':
        return STR((c.prefix ?? '') + items.map((v) => this.str(v)).join(c.sep ?? '') + (c.suffix ?? ''));
      case 'mapping': {
        const transformed = items.map((item) => mapped(item, c.fn));
        return c.downstream && c.downstream.t === 'collector' ? this.fromCollector(c.downstream, transformed) : this.newList(transformed);
      }
      case 'sum': {
        let total = 0;
        let fractional = false;
        for (const item of items) {
          const value = mapped(item, c.fn);
          if (value.t === 'double') fractional = true;
          total += this.numeric(value);
        }
        return fractional ? DBL(total) : INT(total);
      }
      case 'avg': {
        if (!items.length) return { t: 'opt', empty: true, value: DBL(0) };
        const total = items.reduce((acc, item) => acc + this.numeric(mapped(item, c.fn)), 0);
        return { t: 'opt', empty: false, value: DBL(total / items.length) };
      }
      case 'group': {
        const groups = new Map<string, { key: Val; items: Val[] }>();
        for (const item of items) {
          const key = mapped(item, c.fn);
          const id = `${key.t}:${this.str(key)}`;
          const slot = groups.get(id) ?? { key, items: [] };
          slot.items.push(item);
          groups.set(id, slot);
        }
        return mapOf(
          [...groups.values()].map((group) => ({
            key: group.key,
            value: c.downstream && c.downstream.t === 'collector' ? this.fromCollector(c.downstream, group.items) : this.newList(group.items),
          }))
        );
      }
      case 'toMap': {
        const entries: { key: Val; value: Val }[] = [];
        for (const item of items) {
          const key = mapped(item, c.fn);
          const value = mapped(item, c.fn2);
          const at = entries.findIndex((entry) => this.equals(entry.key, key));
          if (at >= 0) entries[at].value = value;
          else entries.push({ key, value });
        }
        return mapOf(entries);
      }
      case 'partitionBy': {
        const yes: Val[] = [];
        const no: Val[] = [];
        for (const item of items) (this.truthy(mapped(item, c.fn)) ? yes : no).push(item);
        return mapOf([
          { key: BOOL(true), value: this.newList(yes) },
          { key: BOOL(false), value: this.newList(no) },
        ]);
      }
      case 'set': {
        const unique: Val[] = [];
        for (const item of items) if (!unique.some((v) => this.equals(v, item))) unique.push(item);
        return this.newList(unique, 'Set');
      }
      default:
        return this.newList([...items]);
    }
  }

  /** StringBuilder: mutable text, every chainable method returns the builder */
  private builderCall(obj: Extract<HeapObj, { kind: 'builder' }>, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    const self: Val = { t: 'ref', id: obj.id };
    switch (name) {
      case 'append': {
        const arg = args[0] ?? NULLV;
        obj.text += this.charArrayText(arg) ?? this.str(arg);
        return self;
      }
      case 'insert': {
        const at = Math.max(0, this.num(args[0]));
        obj.text = obj.text.slice(0, at) + this.str(args[1] ?? NULLV) + obj.text.slice(at);
        return self;
      }
      case 'delete': {
        const from = Math.max(0, this.num(args[0]));
        const to = Math.max(from, this.num(args[1]));
        obj.text = obj.text.slice(0, from) + obj.text.slice(to);
        return self;
      }
      case 'deleteCharAt': {
        const at = this.num(args[0]);
        obj.text = obj.text.slice(0, at) + obj.text.slice(at + 1);
        return self;
      }
      case 'replace': {
        const from = Math.max(0, this.num(args[0]));
        const to = Math.max(from, this.num(args[1]));
        obj.text = obj.text.slice(0, from) + this.str(args[2] ?? NULLV) + obj.text.slice(to);
        return self;
      }
      case 'reverse':
        obj.text = [...obj.text].reverse().join('');
        return self;
      case 'setCharAt': {
        const at = this.num(args[0]);
        obj.text = obj.text.slice(0, at) + this.str(args[1] ?? NULLV) + obj.text.slice(at + 1);
        return self;
      }
      case 'setLength':
        obj.text = obj.text.slice(0, Math.max(0, this.num(args[0])));
        return NULLV;
      case 'toString':
        return STR(obj.text);
      case 'length':
        return INT(obj.text.length);
      case 'charAt':
        return CHR(obj.text[this.num(args[0])] ?? '');
      case 'indexOf':
        return INT(obj.text.indexOf(this.str(args[0]), args.length > 1 ? this.num(args[1]) : 0));
      case 'lastIndexOf':
        return INT(args.length > 1 ? obj.text.lastIndexOf(this.str(args[0]), this.num(args[1])) : obj.text.lastIndexOf(this.str(args[0])));
      case 'substring':
        return STR(args.length > 1 ? obj.text.slice(this.num(args[0]), this.num(args[1])) : obj.text.slice(this.num(args[0])));
      case 'subSequence':
        return STR(obj.text.slice(this.num(args[0]), this.num(args[1])));
      case 'isEmpty':
        return BOOL(obj.text.length === 0);
      default:
        throw new RuntimeError(`StringBuilder.${name}() is not supported`, line);
    }
  }

  private streamCall(items: Val[], name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    switch (name) {
      case 'filter': {
        const kept = items.filter((item) => this.truthy(this.apply(args[0], [item])));
        this.snap('stmt', `filter → kept ${kept.length} of ${items.length}`);
        return { t: 'stream', items: kept };
      }
      case 'map':
      case 'mapToInt':
      case 'mapToLong':
      case 'mapToDouble':
      case 'mapToObj': {
        const mapped = items.map((item) => this.apply(args[0], [item]));
        this.snap('stmt', `map → ${mapped.map((v) => this.text(v)).join(', ') || '(empty)'}`);
        return { t: 'stream', items: mapped };
      }
      case 'flatMap': {
        const out: Val[] = [];
        for (const item of items) {
          const mapped = this.apply(args[0], [item]);
          if (mapped.t === 'stream') out.push(...mapped.items);
          else out.push(...this.elementsOf(mapped));
        }
        this.snap('stmt', `flatMap → ${out.length} items`);
        return { t: 'stream', items: out };
      }
      case 'boxed':
      case 'asLongStream':
      case 'asDoubleStream':
      case 'parallel':
      case 'sequential':
      case 'unordered':
        return { t: 'stream', items };
      case 'sorted': {
        const out = [...items].sort((a, b) => this.compareValues(a, b, args[0]));
        this.snap('stmt', `sorted → [${out.map((v) => this.str(v)).join(', ')}]`);
        return { t: 'stream', items: out };
      }
      case 'distinct': {
        const unique: Val[] = [];
        for (const item of items) if (!unique.some((v) => this.equals(v, item))) unique.push(item);
        return { t: 'stream', items: unique };
      }
      case 'limit':
        return { t: 'stream', items: items.slice(0, Math.max(0, this.num(args[0]))) };
      case 'skip':
        return { t: 'stream', items: items.slice(Math.max(0, this.num(args[0]))) };
      case 'peek': {
        for (const item of items) {
          this.apply(args[0], [item]);
          this.snap('stmt', `peek ${this.text(item)}`);
        }
        return { t: 'stream', items };
      }
      case 'count':
        return INT(items.length);
      case 'sum': {
        let total = 0;
        let dbl = false;
        for (const item of items) {
          if (item.t === 'double') dbl = true;
          total += this.numeric(item);
        }
        this.snap('stmt', `sum → ${total}`);
        return dbl ? DBL(total) : INT(total);
      }
      case 'average': {
        if (!items.length) return { t: 'opt', empty: true, value: DBL(0) };
        const total = items.reduce((acc, item) => acc + this.numeric(item), 0);
        return { t: 'opt', empty: false, value: DBL(total / items.length) };
      }
      case 'max':
      case 'min': {
        if (!items.length) return { t: 'opt', empty: true, value: NULLV };
        let best = items[0];
        for (const item of items.slice(1)) {
          const cmp = this.compareValues(item, best, args[0]);
          if (name === 'max' ? cmp > 0 : cmp < 0) best = item;
        }
        return { t: 'opt', empty: false, value: best };
      }
      case 'findFirst':
        return items.length ? { t: 'opt', empty: false, value: items[0] } : { t: 'opt', empty: true, value: NULLV };
      case 'anyMatch':
        return BOOL(items.some((item) => this.truthy(this.apply(args[0], [item]))));
      case 'allMatch':
        return BOOL(items.every((item) => this.truthy(this.apply(args[0], [item]))));
      case 'noneMatch':
        return BOOL(!items.some((item) => this.truthy(this.apply(args[0], [item]))));
      case 'forEach': {
        for (const item of items) {
          this.apply(args[0], [item]);
          this.snap('stmt', `forEach ${this.text(item)}`);
        }
        return NULLV;
      }
      case 'reduce': {
        if (args.length >= 2) {
          let acc = args[0];
          for (const item of items) acc = this.apply(args[1], [acc, item]);
          return acc;
        }
        if (!items.length) return { t: 'opt', empty: true, value: NULLV };
        let acc = items[0];
        for (const item of items.slice(1)) acc = this.apply(args[0], [acc, item]);
        return { t: 'opt', empty: false, value: acc };
      }
      case 'toArray': {
        // toArray(String[]::new) states the element type
        const hint = args[0];
        const spec = hint?.t === 'fn' ? this.fns.get(hint.id) : undefined;
        if (spec?.kind === 'newArray') {
          return { t: 'ref', id: this.alloc({ kind: 'array', elemType: spec.elemType, cells: [...items], dims: [items.length] }).id };
        }
        const first = items[0];
        const elemType = !first ? 'Object' : first.t === 'str' ? 'String' : first.t === 'ref' ? 'Object' : first.t;
        return { t: 'ref', id: this.alloc({ kind: 'array', elemType, cells: [...items], dims: [items.length] }).id };
      }
      case 'toList':
        return this.newList([...items]);
      case 'collect': {
        const collector = args[0];
        if (!collector || collector.t !== 'collector') {
          throw new RuntimeError('collect() needs a Collectors helper, e.g. Collectors.toList()', line);
        }
        return this.fromCollector(collector, items);
      }
      default:
        throw new RuntimeError(`Stream.${name}() is not supported`, line);
    }
  }

  private optCall(opt: Extract<Val, { t: 'opt' }>, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    switch (name) {
      case 'isPresent':
        return BOOL(!opt.empty);
      case 'isEmpty':
        return BOOL(opt.empty);
      case 'get':
      case 'getAsInt':
      case 'getAsDouble':
      case 'getAsLong':
      case 'orElseThrow':
        if (opt.empty) throw new RuntimeError('NoSuchElementException: the Optional is empty', line);
        return opt.value;
      case 'orElse':
        return opt.empty ? (args[0] ?? NULLV) : opt.value;
      case 'orElseGet':
        return opt.empty ? this.apply(args[0], []) : opt.value;
      case 'or':
        return opt.empty ? this.apply(args[0], []) : opt;
      case 'ifPresent':
        if (!opt.empty) this.apply(args[0], [opt.value]);
        return NULLV;
      case 'ifPresentOrElse':
        this.apply(opt.empty ? args[1] : args[0], opt.empty ? [] : [opt.value]);
        return NULLV;
      case 'map':
        return opt.empty ? opt : { t: 'opt', empty: false, value: this.apply(args[0], [opt.value]) };
      case 'flatMap':
        return opt.empty ? opt : this.apply(args[0], [opt.value]);
      case 'filter':
        if (opt.empty) return opt;
        return this.truthy(this.apply(args[0], [opt.value])) ? opt : { t: 'opt', empty: true, value: NULLV };
      default:
        throw new RuntimeError(`Optional.${name}() is not supported`, line);
    }
  }

  private mapCall(obj: Extract<HeapObj, { kind: 'map' }>, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    const keyText = (key: Val) => this.str(key);
    const find = (key: Val) => obj.entries.findIndex((entry) => this.equals(entry.key, key));

    switch (name) {
      case 'put':
      case 'putIfAbsent': {
        const at = find(args[0]);
        if (at >= 0) {
          if (name === 'putIfAbsent') return obj.entries[at].value;
          const prev = obj.entries[at].value;
          obj.entries[at].value = args[1];
          this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(args[1]), prev: this.toTrace(prev) });
          return prev;
        }
        obj.entries.push({ key: args[0], value: args[1] });
        if (obj.mapType === 'TreeMap') obj.entries.sort((a, b) => this.compareValues(a.key, b.key, obj.cmp));
        this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(args[1]) });
        return NULLV;
      }
      case 'get': {
        const at = find(args[0]);
        return at >= 0 ? obj.entries[at].value : NULLV;
      }
      case 'getOrDefault': {
        const at = find(args[0]);
        return at >= 0 ? obj.entries[at].value : (args[1] ?? NULLV);
      }
      case 'containsKey':
        return BOOL(find(args[0]) >= 0);
      case 'containsValue':
        return BOOL(obj.entries.some((entry) => this.equals(entry.value, args[0])));
      case 'size':
        return INT(obj.entries.length);
      case 'isEmpty':
        return BOOL(obj.entries.length === 0);
      case 'remove': {
        const at = find(args[0]);
        if (at < 0) return args.length > 1 ? BOOL(false) : NULLV;
        // remove(key, value) only removes when the value matches
        if (args.length > 1) {
          if (!this.equals(obj.entries[at].value, args[1])) return BOOL(false);
          obj.entries.splice(at, 1);
          return BOOL(true);
        }
        return obj.entries.splice(at, 1)[0].value;
      }
      case 'firstKey':
      case 'lastKey': {
        if (!obj.entries.length) throw new JavaException('NoSuchElementException', 'the map is empty');
        return name === 'firstKey' ? obj.entries[0].key : obj.entries[obj.entries.length - 1].key;
      }
      case 'floorKey':
      case 'ceilingKey':
      case 'lowerKey':
      case 'higherKey': {
        const sorted = [...obj.entries].sort((a, b) => this.compareValues(a.key, b.key, obj.cmp));
        let best: Val | null = null;
        for (const entry of sorted) {
          const cmp = this.compareValues(entry.key, args[0], obj.cmp);
          const fits = name === 'higherKey' ? cmp > 0 : name === 'ceilingKey' ? cmp >= 0 : name === 'lowerKey' ? cmp < 0 : cmp <= 0;
          if (!fits) continue;
          if (!best) best = entry.key;
          else {
            const against = this.compareValues(entry.key, best, obj.cmp);
            if (name === 'lowerKey' || name === 'floorKey' ? against > 0 : against < 0) best = entry.key;
          }
        }
        return best ?? NULLV;
      }
      case 'clear':
        obj.entries.length = 0;
        return NULLV;
      case 'keySet':
        return this.newList(obj.entries.map((entry) => entry.key));
      case 'values':
        return this.newList(obj.entries.map((entry) => entry.value));
      case 'forEach': {
        for (const entry of obj.entries) {
          this.apply(args[0], [entry.key, entry.value]);
          this.snap('stmt', `map.forEach ${keyText(entry.key)} → ${this.text(entry.value)}`);
        }
        return NULLV;
      }
      case 'computeIfAbsent': {
        const at = find(args[0]);
        if (at >= 0) return obj.entries[at].value;
        const created = this.apply(args[1], [args[0]]);
        obj.entries.push({ key: args[0], value: created });
        this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(created) });
        return created;
      }
      case 'merge': {
        const at = find(args[0]);
        if (at < 0) {
          obj.entries.push({ key: args[0], value: args[1] });
          this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(args[1]) });
          return args[1];
        }
        const merged = this.apply(args[2], [obj.entries[at].value, args[1]]);
        obj.entries[at].value = merged;
        this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(merged) });
        return merged;
      }
      case 'compute':
      case 'computeIfPresent': {
        const at = find(args[0]);
        if (at < 0 && name === 'computeIfPresent') return NULLV;
        const prev = at >= 0 ? obj.entries[at].value : NULLV;
        const next = this.apply(args[1], [args[0], prev]);
        if (next.t === 'null') {
          if (at >= 0) obj.entries.splice(at, 1);
          return NULLV;
        }
        if (at >= 0) obj.entries[at].value = next;
        else obj.entries.push({ key: args[0], value: next });
        this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(next), prev: this.toTrace(prev) });
        return next;
      }
      case 'replace': {
        const at = find(args[0]);
        if (at < 0) return args.length > 2 ? BOOL(false) : NULLV;
        if (args.length > 2) {
          if (!this.equals(obj.entries[at].value, args[1])) return BOOL(false);
          obj.entries[at].value = args[2];
          return BOOL(true);
        }
        const previous = obj.entries[at].value;
        obj.entries[at].value = args[1];
        this.effects.push({ to: { obj: obj.id, field: keyText(args[0]) }, value: this.toTrace(args[1]), prev: this.toTrace(previous) });
        return previous;
      }
      case 'putAll': {
        const other = args[0]?.t === 'ref' ? this.heap.get(args[0].id) : undefined;
        if (other?.kind === 'map') {
          for (const entry of other.entries) {
            const at = find(entry.key);
            if (at >= 0) obj.entries[at].value = entry.value;
            else obj.entries.push({ key: entry.key, value: entry.value });
          }
        }
        return NULLV;
      }
      case 'entrySet':
        return this.newList(
          obj.entries.map((entry) => ({
            t: 'ref' as const,
            id: this.alloc({ kind: 'object', className: 'Map.Entry', fields: [{ name: 'key', value: entry.key }, { name: 'value', value: entry.value }] }).id,
          })),
          'Map.Entry'
        );
      case 'toString':
        return STR(`{${obj.entries.map((entry) => `${this.str(entry.key)}=${this.str(entry.value)}`).join(', ')}}`);
      default:
        throw new RuntimeError(`Map.${name}() is not supported`, line);
    }
  }

  private listCall(obj: Extract<HeapObj, { kind: 'list' }>, name: string, args: Val[]): Val {
    const line = this.top()?.line ?? 0;
    switch (name) {
      case 'iterator':
        return { t: 'ref', id: this.alloc({ kind: 'iterator', at: 0, of: [...obj.items] }).id };
      case 'push':
      case 'offer':
      case 'addLast': {
        obj.items.push(args[0] ?? NULLV);
        this.effects.push({ to: { obj: obj.id, index: obj.items.length - 1 }, value: this.toTrace(args[0] ?? NULLV) });
        return name === 'offer' ? BOOL(true) : NULLV;
      }
      case 'pop': {
        if (!obj.items.length) throw new JavaException('NoSuchElementException', 'the collection is empty');
        return obj.items.pop()!;
      }
      case 'poll':
      case 'pollFirst': {
        if (!obj.items.length) return NULLV;
        return obj.items.shift()!;
      }
      case 'pollLast': {
        if (!obj.items.length) return NULLV;
        return obj.items.pop()!;
      }
      case 'peek':
      case 'peekFirst':
      case 'element': {
        if (!obj.items.length) {
          if (name === 'element') throw new JavaException('NoSuchElementException', 'the collection is empty');
          return NULLV;
        }
        return obj.elemType === 'Stack' ? obj.items[obj.items.length - 1] : obj.items[0];
      }
      case 'peekLast':
        return obj.items.length ? obj.items[obj.items.length - 1] : NULLV;
      case 'add':
      case 'addFirst': {
        if (name === 'addFirst') {
          obj.items.unshift(args[0] ?? NULLV);
          return NULLV;
        }
        if (args.length === 2) {
          const index = this.num(args[0]);
          obj.items.splice(index, 0, args[1]);
          this.effects.push({ to: { obj: obj.id, index }, value: this.toTrace(args[1]) });
        } else {
          // a Set keeps one copy of each value
          const uniqueSet = obj.elemType === 'Set' || obj.elemType === 'TreeSet';
          if (uniqueSet && obj.items.some((item) => this.equals(item, args[0]))) return BOOL(false);
          obj.items.push(args[0]);
          if (obj.elemType === 'PriorityQueue' || obj.elemType === 'TreeSet') obj.items.sort((a, b) => this.compareValues(a, b, obj.cmp));
          this.effects.push({ to: { obj: obj.id, index: obj.items.length - 1 }, value: this.toTrace(args[0]) });
          return BOOL(true);
        }
        return NULLV;
      }
      case 'get': {
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new JavaException('IndexOutOfBoundsException', `Index ${index} out of bounds for length ${obj.items.length}`);
        return obj.items[index];
      }
      case 'set': {
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new JavaException('IndexOutOfBoundsException', `Index ${index} out of bounds for length ${obj.items.length}`);
        const prev = obj.items[index];
        obj.items[index] = args[1];
        this.effects.push({ to: { obj: obj.id, index }, value: this.toTrace(args[1]), prev: this.toTrace(prev) });
        return prev;
      }
      case 'size':
        return INT(obj.items.length);
      case 'remove': {
        // remove(int) drops a position, remove(Object) drops a value — but a Set
        // only ever removes the value it is given
        const isSet = obj.elemType === 'Set' || obj.elemType === 'TreeSet';
        if (isSet || (args[0].t !== 'int' && args[0].t !== 'long')) {
          const at = obj.items.findIndex((item) => this.equals(item, args[0]));
          if (at < 0) return BOOL(false);
          obj.items.splice(at, 1);
          return BOOL(true);
        }
        const index = this.num(args[0]);
        if (index < 0 || index >= obj.items.length) throw new JavaException('IndexOutOfBoundsException', `Index ${index} out of bounds for length ${obj.items.length}`);
        const removed = obj.items.splice(index, 1)[0];
        return removed;
      }
      case 'subList': {
        const from = Math.max(0, this.num(args[0]));
        const to = Math.min(obj.items.length, this.num(args[1]));
        return this.newList(obj.items.slice(from, to), obj.elemType);
      }
      case 'toArray': {
        const first = obj.items[0];
        const elemType = first && first.t !== 'ref' ? first.t : 'Object';
        return { t: 'ref', id: this.alloc({ kind: 'array', elemType, cells: [...obj.items], dims: [obj.items.length] }).id };
      }
      case 'lastIndexOf': {
        for (let i = obj.items.length - 1; i >= 0; i--) if (this.equals(obj.items[i], args[0])) return INT(i);
        return INT(-1);
      }
      case 'containsAll':
        return BOOL(this.elementsOf(args[0]).every((wanted) => obj.items.some((item) => this.equals(item, wanted))));
      case 'removeAll': {
        const drop = this.elementsOf(args[0]);
        const before = obj.items.length;
        obj.items = obj.items.filter((item) => !drop.some((wanted) => this.equals(wanted, item)));
        return BOOL(obj.items.length < before);
      }
      case 'retainAll': {
        const keep = this.elementsOf(args[0]);
        const before = obj.items.length;
        obj.items = obj.items.filter((item) => keep.some((wanted) => this.equals(wanted, item)));
        return BOOL(obj.items.length < before);
      }
      case 'first':
      case 'last': {
        if (!obj.items.length) throw new JavaException('NoSuchElementException', 'the collection is empty');
        return name === 'first' ? obj.items[0] : obj.items[obj.items.length - 1];
      }
      case 'higher':
      case 'ceiling':
      case 'lower':
      case 'floor': {
        // SortedSet navigation: the next/previous element relative to a value
        let best: Val | null = null;
        for (const item of obj.items) {
          const cmp = this.compareValues(item, args[0]);
          const fits = name === 'higher' ? cmp > 0 : name === 'ceiling' ? cmp >= 0 : name === 'lower' ? cmp < 0 : cmp <= 0;
          if (!fits) continue;
          if (!best) best = item;
          else {
            const against = this.compareValues(item, best);
            if (name === 'lower' || name === 'floor' ? against > 0 : against < 0) best = item;
          }
        }
        return best ?? NULLV;
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
      case 'stream':
        return { t: 'stream', items: [...obj.items] };
      case 'forEach': {
        for (const item of [...obj.items]) {
          this.apply(args[0], [item]);
          this.snap('stmt', `forEach ${this.text(item)}`);
        }
        return NULLV;
      }
      case 'sort': {
        const before = obj.items.map((i) => this.str(i)).join(', ');
        obj.items.sort((a, b) => this.compareValues(a, b, args[0]));
        this.snap('stmt', `sort [${before}] → [${obj.items.map((i) => this.str(i)).join(', ')}]`);
        return NULLV;
      }
      case 'indexOf': {
        const at = obj.items.findIndex((item) => this.equals(item, args[0]));
        return INT(at);
      }
      case 'addAll': {
        if (args.length === 2) {
          const at = Math.max(0, this.num(args[0]));
          const extra = this.elementsOf(args[1]);
          obj.items.splice(at, 0, ...extra);
          return BOOL(extra.length > 0);
        }
        const extra = this.elementsOf(args[0]);
        for (const item of extra) obj.items.push(item);
        return BOOL(extra.length > 0);
      }
      case 'removeIf': {
        const keep = obj.items.filter((item) => !this.truthy(this.apply(args[0], [item])));
        const removed = obj.items.length - keep.length;
        obj.items.length = 0;
        obj.items.push(...keep);
        return BOOL(removed > 0);
      }
      case 'equals':
        return BOOL(this.str(args[0]) === this.str({ t: 'ref', id: obj.id }));
      default:
        throw new RuntimeError(`ArrayList.${name}() is not supported`, line);
    }
  }
}

export function runJava(source: string, stdin = ''): Trace {
  try {
    const classes = parseJava(source);
    return new Machine(classes, new Stdin(stdin)).run();
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
