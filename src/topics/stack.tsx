import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { lineOf, parseNums } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, useStableIds, type TileSpec } from '../three/anim';

const CAP = 8;

type Op = { k: 'push' | 'pop' | 'peek'; v?: number };
type Params = { ops: Op[]; input: string };
type StackState = { items: number[]; marks: Mark[]; capacity: number };

const JAVA = `class IntStack {
    private int[] data = new int[8];               // capacity
    private int size = 0;                          // size

    void push(int v) {
        if (size == data.length)
            throw new IllegalStateException();     // full
        data[size++] = v;                          // push
    }

    int pop() {
        if (size == 0)
            throw new EmptyStackException();       // empty
        return data[--size];                       // pop
    }

    int peek() {
        if (size == 0)
            throw new EmptyStackException();
        return data[size - 1];                     // peek
    }
}`;

export function replayStack(ops: Op[]): number[] {
  const items: number[] = [];
  for (const op of ops) {
    if (op.k === 'push' && items.length < CAP) items.push(op.v ?? 0);
    else if (op.k === 'pop') items.pop();
  }
  return items;
}

const idle = (n: number): Mark[] => Array.from({ length: n }, () => 'idle' as Mark);

function build(p: Params): Program<StackState> {
  const java = JAVA;
  const ln = (needle: string) => lineOf(java, needle);
  const steps: Step<StackState>[] = [];
  const snap = (note: string, line: number, items: number[], marks: Mark[]) =>
    steps.push({ note, line, state: { items: [...items], marks: [...marks], capacity: CAP } });

  const ops = Array.isArray(p.ops) ? p.ops : [];
  const base = replayStack(ops.slice(0, -1));
  const last = ops[ops.length - 1];

  if (!last) {
    snap('Empty stack. Push a value to drop the first plate on the top of the stack.', ln('class IntStack'), base, idle(base.length));
    return { java, steps };
  }

  if (last.k === 'push') {
    if (base.length >= CAP) {
      snap(`Stack is full (capacity ${CAP}) → this array-backed push would throw.`, ln('// full'), base, idle(base.length));
      return { java, steps };
    }
    const items = [...base, last.v ?? 0];
    const glowing = items.map((_, i) => (i === items.length - 1 ? ('inserted' as Mark) : 'idle'));
    snap(`push(${last.v}): data[size++] = ${last.v} → it lands on top.`, ln('// push'), items, glowing);
    snap(`size = ${items.length} · peek() = ${items[items.length - 1]} · push is O(1).`, ln('// size'), items, items.map((_, i) => (i === items.length - 1 ? ('active' as Mark) : 'idle')));
  }

  if (last.k === 'pop') {
    if (base.length === 0) {
      snap('pop() on an empty stack → EmptyStackException. Guard with size == 0.', ln('// empty'), base, idle(base.length));
      return { java, steps };
    }
    const top = base[base.length - 1];
    const leaving = base.map((_, i) => (i === base.length - 1 ? ('removed' as Mark) : 'idle'));
    snap(`pop(): read data[size - 1] = ${top}, then decrement size.`, ln('// pop'), base, leaving);
    const items = base.slice(0, -1);
    snap(
      items.length
        ? `${top} returned. New top is ${items[items.length - 1]} · size = ${items.length}.`
        : `${top} returned. The stack is empty again.`,
      ln('// pop'),
      items,
      items.map((_, i) => (i === items.length - 1 ? ('active' as Mark) : 'idle'))
    );
  }

  if (last.k === 'peek') {
    if (base.length === 0) {
      snap('peek() on an empty stack → EmptyStackException.', ln('// peek'), base, idle(base.length));
      return { java, steps };
    }
    snap(
      `peek() returns ${base[base.length - 1]} without removing anything.`,
      ln('// peek'),
      base,
      base.map((_, i) => (i === base.length - 1 ? ('active' as Mark) : 'idle'))
    );
  }

  return { java, steps };
}

type ViewProps = { state: StackState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const baseY = -3.1;
  const gap = 0.74;
  const n = state.items.length;
  const ids = useStableIds(state.items);

  const tiles: TileSpec[] = state.items.map((value, i) => ({
    id: ids[i],
    value,
    mark: state.marks[i] ?? 'idle',
    pos: [0, baseY + i * gap, 0],
    size: [1.9, 0.62, 1.9],
    labelScale: 0.55,
    onInspect: () =>
      onInspect({
        title: `data[${i}]`,
        meta: [
          ['value', String(value)],
          ['index', String(i)],
          ['top?', i === n - 1 ? 'yes' : 'no'],
          ['state', state.marks[i] ?? 'idle'],
        ],
      }),
  }));

  return (
    <group position={[0, 0.4, 0]}>
      {Array.from({ length: state.capacity }).map((_, i) => (
        <mesh key={`slot-${i}`} position={[0, baseY + i * gap, 0]}>
          <boxGeometry args={[1.95, 0.62, 1.95]} />
          <meshStandardMaterial color="#0d1a2b" transparent opacity={0.22} metalness={0.1} roughness={0.9} />
        </mesh>
      ))}

      {/* rail */}
      <mesh position={[-1.42, baseY + (state.capacity * gap) / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.018, state.capacity * gap, 8]} />
        <meshStandardMaterial color="#1d3c56" emissive="#1d3c56" emissiveIntensity={0.5} />
      </mesh>

      <AnimatedStage tiles={tiles} spawn="above" exit="above" duration={animMs} />

      <Label text="push ⇣" color="#3d6284" scale={0.62} position={[0, baseY + state.capacity * gap + 0.55, 0]} />
      {n > 0 ? (
        <Html center position={[1.55, baseY + (n - 1) * gap, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ptr ptr-accent">top</div>
        </Html>
      ) : (
        <Label text="empty" color="#2f4a62" scale={0.6} position={[1.55, baseY, 0]} />
      )}
      <Label text={`size = ${n}`} color="#5f86a8" scale={0.55} position={[-1.5, baseY + n * gap + 0.15, 0]} />
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  const ops: Op[] = params.ops ?? [];
  const items = replayStack(ops);
  const value = parseNums(params.input, 1)[0];
  const ready = Number.isFinite(value);

  const push = () => {
    if (!ready || items.length >= CAP) return;
    setParams({ ops: [...ops, { k: 'push', v: value }], input: '' });
  };

  return (
    <div className="ctrl">
      <label className="field">
        <span>Value · {items.length}/{CAP} on stack</span>
        <input
          className="inp"
          value={params.input}
          spellCheck={false}
          placeholder="42"
          onChange={(e) => setParams({ ...params, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') push();
          }}
        />
      </label>
      <div className="row">
        <button className="btn primary" onClick={push} disabled={!ready || items.length >= CAP}>
          Push
        </button>
        <button className="btn" onClick={() => setParams({ ...params, ops: [...ops, { k: 'pop' }] })}>
          Pop
        </button>
        <button className="btn" onClick={() => setParams({ ...params, ops: [...ops, { k: 'peek' }] })}>
          Peek
        </button>
        <button className="btn ghost" onClick={() => setParams({ ops: [], input: '' })}>
          Reset
        </button>
      </div>
      <p className="hint">
        Last in, first out. Each action animates from the current stack, so you can keep pushing and popping to build
        intuition.
      </p>
    </div>
  );
}

export const stackTopic: TopicModule = {
  id: 'stack',
  label: 'Stack (LIFO)',
  tag: 'O(1) push / pop',
  blurb:
    'An array-backed stack as a tower of plates. Push and pop only ever touch the top — the last value in is the first value out.',
  camera: [3.2, 2.4, 11],
  defaults: { ops: [], input: '42' } as Params,
  build,
  Controls,
  View,
};
