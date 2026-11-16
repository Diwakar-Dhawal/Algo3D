import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { lineOf, parseNums } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, useStableIds, type TileSpec } from '../three/anim';

const CAP = 8;

type Op = { k: 'enqueue' | 'dequeue' | 'front'; v?: number };
type Params = { ops: Op[]; input: string };
type QueueState = { items: number[]; marks: Mark[]; capacity: number };

const JAVA = `class IntQueue {
    private int[] data = new int[8];               // capacity
    private int head = 0, tail = 0;                // pointers

    void enqueue(int v) {
        if (tail == data.length)
            throw new IllegalStateException();     // full
        data[tail++] = v;                          // enqueue
    }

    int dequeue() {
        if (head == tail)
            throw new NoSuchElementException();    // empty
        int v = data[head];                        // dequeue
        for (int i = 1; i < tail; i++)
            data[i - 1] = data[i];                 // shift
        tail--;
        return v;
    }

    int front() {
        return data[head];                         // front
    }
}`;

function replayQueue(ops: Op[]): number[] {
  const items: number[] = [];
  for (const op of ops) {
    if (op.k === 'enqueue' && items.length < CAP) items.push(op.v ?? 0);
    else if (op.k === 'dequeue') items.shift();
  }
  return items;
}

const idle = (n: number): Mark[] => Array.from({ length: n }, () => 'idle' as Mark);

function build(p: Params): Program<QueueState> {
  const java = JAVA;
  const ln = (needle: string) => lineOf(java, needle);
  const steps: Step<QueueState>[] = [];
  const snap = (note: string, line: number, items: number[], marks: Mark[]) =>
    steps.push({ note, line, state: { items: [...items], marks: [...marks], capacity: CAP } });

  const ops = Array.isArray(p.ops) ? p.ops : [];
  const base = replayQueue(ops.slice(0, -1));
  const last = ops[ops.length - 1];

  if (!last) {
    snap('Empty queue. Enqueue at the rear, dequeue from the front — first in, first out.', ln('class IntQueue'), base, idle(base.length));
    return { java, steps };
  }

  if (last.k === 'enqueue') {
    if (base.length >= CAP) {
      snap(`Queue is full (capacity ${CAP}) → this enqueue would throw.`, ln('// full'), base, idle(base.length));
      return { java, steps };
    }
    const items = [...base, last.v ?? 0];
    snap(
      `enqueue(${last.v}): data[tail++] = ${last.v} → joins at the rear (index ${items.length - 1}).`,
      ln('// enqueue'),
      items,
      items.map((_, i) => (i === items.length - 1 ? ('inserted' as Mark) : 'idle'))
    );
    snap(`size = ${items.length} · front is ${items[0]} · enqueue is O(1).`, ln('// pointers'), items, idle(items.length));
  }

  if (last.k === 'dequeue') {
    if (base.length === 0) {
      snap('dequeue() on an empty queue (head == tail) → throws NoSuchElementException.', ln('// empty'), base, idle(base.length));
      return { java, steps };
    }
    const first = base[0];
    snap(
      `dequeue(): read data[head] = ${first}, then shift every remaining element one slot left.`,
      ln('// shift'),
      base,
      base.map((_, i) => (i === 0 ? ('removed' as Mark) : ('swap' as Mark)))
    );
    const items = base.slice(1);
    snap(
      items.length
        ? `${first} removed. New front is ${items[0]} · tail-- → size = ${items.length}.`
        : `${first} removed — the queue is empty again.`,
      ln('// dequeue'),
      items,
      idle(items.length)
    );
  }

  if (last.k === 'front') {
    if (base.length === 0) {
      snap('front() on an empty queue → nothing to read.', ln('// front'), base, idle(base.length));
      return { java, steps };
    }
    snap(
      `front() returns data[head] = ${base[0]} without removing it.`,
      ln('// front'),
      base,
      base.map((_, i) => (i === 0 ? ('active' as Mark) : 'idle'))
    );
  }

  return { java, steps };
}

type ViewProps = { state: QueueState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const gap = 1.5;
  const n = state.items.length;
  const width = Math.max(state.capacity, 1) * gap;
  const ids = useStableIds(state.items);

  const tiles: TileSpec[] = state.items.map((value, i) => ({
    id: ids[i],
    value,
    mark: state.marks[i] ?? 'idle',
    pos: [(i - (state.capacity - 1) / 2) * gap, 0, 0],
    size: [1.28, 1.28, 1.28],
    labelScale: 0.8,
    onInspect: () =>
      onInspect({
        title: `data[${i}]`,
        meta: [
          ['value', String(value)],
          ['position', i === 0 ? 'front' : i === n - 1 ? 'rear' : 'middle'],
          ['head offset', String(i)],
          ['state', state.marks[i] ?? 'idle'],
        ],
      }),
  }));

  return (
    <group>
      {Array.from({ length: state.capacity }).map((_, i) => (
        <mesh key={`slot-${i}`} position={[(i - (state.capacity - 1) / 2) * gap, 0, 0]}>
          <boxGeometry args={[1.32, 1.32, 1.32]} />
          <meshStandardMaterial color="#0d1a2b" transparent opacity={0.22} roughness={0.9} />
        </mesh>
      ))}

      <AnimatedStage tiles={tiles} spawn="right" exit="left" duration={animMs} />

      <Label text={`${width.toFixed(0)}-slot int[]`} color="#3d6284" scale={0.6} position={[0, -1.55, 0]} />
      {n > 0 && (
        <>
          <Html center position={[(0 - (state.capacity - 1) / 2) * gap, 1.15, 0]} style={{ pointerEvents: 'none' }}>
            <div className="ptr ptr-accent">front</div>
          </Html>
          <Html center position={[(n - 1 - (state.capacity - 1) / 2) * gap, 1.15, 0]} style={{ pointerEvents: 'none' }}>
            <div className="ptr">rear</div>
          </Html>
        </>
      )}
      <Label text="dequeue ←" color="#3d6284" scale={0.55} position={[-(width / 2) - 1.15, 0, 0]} />
      <Label text="← enqueue" color="#3d6284" scale={0.55} position={[width / 2 + 1.3, 0, 0]} />
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  const ops: Op[] = params.ops ?? [];
  const items = replayQueue(ops);
  const value = parseNums(params.input, 1)[0];
  const ready = Number.isFinite(value);

  const enqueue = () => {
    if (!ready || items.length >= CAP) return;
    setParams({ ops: [...ops, { k: 'enqueue', v: value }], input: '' });
  };

  return (
    <div className="ctrl">
      <label className="field">
        <span>Value · {items.length}/{CAP} queued</span>
        <input
          className="inp"
          value={params.input}
          spellCheck={false}
          placeholder="7"
          onChange={(e) => setParams({ ...params, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enqueue();
          }}
        />
      </label>
      <div className="row">
        <button className="btn primary" onClick={enqueue} disabled={!ready || items.length >= CAP}>
          Enqueue
        </button>
        <button className="btn" onClick={() => setParams({ ...params, ops: [...ops, { k: 'dequeue' }] })}>
          Dequeue
        </button>
        <button className="btn" onClick={() => setParams({ ...params, ops: [...ops, { k: 'front' }] })}>
          Front
        </button>
        <button className="btn ghost" onClick={() => setParams({ ops: [], input: '' })}>
          Reset
        </button>
      </div>
      <p className="hint">
        Enter adds at the rear, Dequeue removes from the front and shifts everything left — the O(n) cost you can
        literally watch.
      </p>
    </div>
  );
}

export const queueTopic: TopicModule = {
  id: 'queue',
  label: 'Queue (FIFO)',
  tag: 'O(1) enqueue · O(n) dequeue',
  blurb:
    'A row of slots with head and tail pointers. Enqueue at the rear, dequeue at the front, and see the shifting cost of an array-backed queue.',
  camera: [1.5, 3.4, 12],
  defaults: { ops: [], input: '7' } as Params,
  build,
  Controls,
  View,
};
