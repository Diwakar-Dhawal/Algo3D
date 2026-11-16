import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { lineOf, parseNums } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, useStableIds, type EdgeSpec, type TileSpec } from '../three/anim';

const CAP = 7;

type Op = { k: 'insertHead' | 'insertTail' | 'delete' | 'traverse'; v?: number };
type Params = { ops: Op[]; input: string };
type ListState = { values: number[]; marks: Mark[]; cursor: number | null };

const JAVA = `class Node {
    int value;
    Node next;
    Node(int value) { this.value = value; }
}                                                  // node

Node insertHead(Node head, int v) {
    Node n = new Node(v);
    n.next = head;                                 // link
    return n;
}

Node insertTail(Node head, int v) {
    Node n = new Node(v);
    if (head == null) return n;                    // empty
    Node cur = head;
    while (cur.next != null) cur = cur.next;       // walk
    cur.next = n;
    return head;
}

Node delete(Node head, int v) {
    if (head == null) return null;
    if (head.value == v) return head.next;         // headCase
    Node cur = head;
    while (cur.next != null && cur.next.value != v)
        cur = cur.next;                            // find
    if (cur.next != null)
        cur.next = cur.next.next;                  // unlink
    return head;
}`;

function replayList(ops: Op[]): number[] {
  const values: number[] = [];
  for (const op of ops) {
    if (op.k === 'insertHead' && values.length < CAP) values.unshift(op.v ?? 0);
    else if (op.k === 'insertTail' && values.length < CAP) values.push(op.v ?? 0);
    else if (op.k === 'delete') {
      const at = values.indexOf(op.v ?? 0);
      if (at >= 0) values.splice(at, 1);
    }
  }
  return values;
}

const idle = (n: number): Mark[] => Array.from({ length: n }, () => 'idle' as Mark);

function build(p: Params): Program<ListState> {
  const java = JAVA;
  const ln = (needle: string) => lineOf(java, needle);
  const steps: Step<ListState>[] = [];
  const snap = (note: string, line: number, values: number[], marks: Mark[], cursor: number | null = null) =>
    steps.push({ note, line, state: { values: [...values], marks: [...marks], cursor } });

  const ops = Array.isArray(p.ops) ? p.ops : [];
  const base = replayList(ops.slice(0, -1));
  const last = ops[ops.length - 1];

  if (!last) {
    snap('Empty list: head == null. Every operation has to respect that case first.', ln('class Node'), base, idle(base.length));
    return { java, steps };
  }

  if (last.k === 'insertHead') {
    if (base.length >= CAP) {
      snap('Demo cap reached — reset the list to keep adding nodes.', ln('// link'), base, idle(base.length));
      return { java, steps };
    }
    const values = [last.v ?? 0, ...base];
    snap(
      `new Node(${last.v}); n.next = head; head = n → O(1) insert at the front.`,
      ln('// link'),
      values,
      values.map((_, i) => (i === 0 ? ('inserted' as Mark) : 'idle'))
    );
    snap(`head now points at ${last.v}; the old head is one hop further along.`, ln('Node insertHead'), values, values.map((_, i) => (i === 0 ? ('active' as Mark) : 'idle')));
  }

  if (last.k === 'insertTail') {
    if (base.length >= CAP) {
      snap('Demo cap reached — reset the list to keep adding nodes.', ln('// walk'), base, idle(base.length));
      return { java, steps };
    }
    const v = last.v ?? 0;
    if (base.length === 0) {
      snap(`head == null → the new node becomes the head.`, ln('// empty'), [v], ['inserted']);
      return { java, steps };
    }
    for (let i = 0; i < base.length; i++) {
      const marks: Mark[] = base.map((_, k) => (k < i ? 'visited' : k === i ? 'path' : 'idle'));
      snap(
        i === base.length - 1
          ? `cur = node ${i} (${base[i]}); cur.next == null → this is the tail.`
          : `cur = node ${i} (${base[i]}); cur.next != null → keep walking.`,
        ln('// walk'),
        base,
        marks,
        i
      );
    }
    const values = [...base, v];
    snap(
      `cur.next = new Node(${v}) → attach the new tail. Walking cost O(n).`,
      ln('Node insertTail'),
      values,
      values.map((_, i) => (i === values.length - 1 ? ('inserted' as Mark) : 'idle'))
    );
  }

  if (last.k === 'delete') {
    const v = last.v ?? 0;
    const at = base.indexOf(v);
    if (base.length === 0) {
      snap('Empty list → return null, nothing to unlink.', ln('Node delete'), base, idle(base.length));
      return { java, steps };
    }
    if (at === 0) {
      const values = base.slice(1);
      snap(`head.value == ${v} → return head.next, the head is removed.`, ln('// headCase'), values, idle(values.length));
      return { java, steps };
    }
    for (let i = 0; i < base.length; i++) {
      const marks: Mark[] = base.map((_, k) => (k < i ? 'visited' : k === i ? 'path' : 'idle'));
      snap(`Check cur.next: ${i + 1 < base.length ? `is ${base[i + 1]} == ${v}?` : 'null → value not present.'}`, ln('// find'), base, marks, i);
      if (i + 1 < base.length && base[i + 1] === v) break;
    }
    if (at < 0) {
      snap(`${v} is not in the list → nothing changes.`, ln('// find'), base, idle(base.length));
      return { java, steps };
    }
    snap(
      `Found ${v} at index ${at}. cur.next = cur.next.next → the node is unlinked and garbage collected.`,
      ln('// unlink'),
      base,
      base.map((_, k) => (k === at ? 'removed' : 'idle'))
    );
    const values = base.filter((_, k) => k !== at);
    snap(`List is now [${values.join(' → ') || 'empty'}] · size ${values.length}.`, ln('Node delete'), values, idle(values.length));
  }

  if (last.k === 'traverse') {
    if (base.length === 0) {
      snap('Nothing to traverse: head == null.', ln('// walk'), base, idle(base.length));
      return { java, steps };
    }
    for (let i = 0; i < base.length; i++) {
      const marks: Mark[] = base.map((_, k) => (k < i ? 'visited' : k === i ? 'path' : 'idle'));
      snap(`Visit node ${i}: value ${base[i]}, then cur = cur.next.`, ln('// walk'), base, marks, i);
    }
    snap(`Reached null — printed [${base.join(', ')}]. Traversal is O(n).`, ln('Node delete'), base, base.map(() => 'visited'));
  }

  return { java, steps };
}

type ViewProps = { state: ListState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const gap = 1.95;
  const n = state.values.length;
  const ids = useStableIds(state.values);

  const tiles: TileSpec[] = state.values.map((value, i) => ({
    id: ids[i],
    value,
    mark: state.marks[i] ?? 'idle',
    pos: [(i - (n - 1) / 2) * gap, 0, 0],
    size: [1.15, 1.15, 1.15],
    labelScale: 0.85,
    onInspect: () =>
      onInspect({
        title: `Node ${i}`,
        meta: [
          ['value', String(value)],
          ['next', i + 1 < n ? `Node ${i + 1} (${state.values[i + 1]})` : 'null'],
          ['state', state.marks[i] ?? 'idle'],
          ['hops from head', String(i)],
        ],
      }),
  }));

  const edges: EdgeSpec[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const walked = state.marks[i] === 'path' || state.marks[i] === 'visited';
    edges.push({
      id: `link-${ids[i]}-${ids[i + 1]}`,
      a: ids[i],
      b: ids[i + 1],
      arrow: true,
      radius: 0.026,
      trimA: 0.64,
      trimB: 0.64,
      color: walked ? '#c9a227' : '#b08d57',
    });
  }

  return (
    <group>
      <AnimatedStage tiles={tiles} edges={edges} spawn="above" exit="above" duration={animMs}>
        {state.values.map((_, i) => (
          <Label
            key={`slot-${i}`}
            text="value"
            color="#a2937c"
            scale={0.4}
            position={[(i - (n - 1) / 2) * gap, -0.86, 0]}
          />
        ))}
        {n > 0 && (
          <Label
            text="null"
            color="#a2937c"
            scale={0.55}
            position={[(n - 1) / 2 * gap + 1.05, 0, 0]}
          />
        )}
      </AnimatedStage>

      {n > 0 && (
        <Html center position={[(0 - (n - 1) / 2) * gap, 1.05, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ptr ptr-accent">head</div>
        </Html>
      )}
      {state.cursor !== null && state.cursor >= 0 && state.cursor < n && (
        <Html center position={[(state.cursor - (n - 1) / 2) * gap, -1.35, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ptr ptr-warm">cur</div>
        </Html>
      )}
      <Label text="Singly linked: each node stores the address of the next" color="#33506b" scale={0.5} position={[0, -2.35, 0]} />
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  const ops: Op[] = params.ops ?? [];
  const values = replayList(ops);
  const value = parseNums(params.input, 1)[0];
  const ready = Number.isFinite(value);

  return (
    <div className="ctrl">
      <label className="field">
        <span>Value · {values.length}/{CAP} nodes</span>
        <input
          className="inp"
          value={params.input}
          spellCheck={false}
          placeholder="10"
          onChange={(e) => setParams({ ...params, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) setParams({ ops: [...ops, { k: 'insertTail', v: value }], input: '' });
          }}
        />
      </label>
      <div className="row">
        <button
          className="btn primary"
          disabled={!ready || values.length >= CAP}
          onClick={() => setParams({ ops: [...ops, { k: 'insertHead', v: value }], input: '' })}
        >
          Insert head
        </button>
        <button
          className="btn primary"
          disabled={!ready || values.length >= CAP}
          onClick={() => setParams({ ops: [...ops, { k: 'insertTail', v: value }], input: '' })}
        >
          Insert tail
        </button>
      </div>
      <div className="row">
        <button
          className="btn"
          disabled={!ready}
          onClick={() => setParams({ ops: [...ops, { k: 'delete', v: value }], input: '' })}
        >
          Delete
        </button>
        <button className="btn" onClick={() => setParams({ ...params, ops: [...ops, { k: 'traverse' }] })}>
          Traverse
        </button>
        <button className="btn ghost" onClick={() => setParams({ ops: [], input: '' })}>
          Reset
        </button>
      </div>
      <p className="hint">
        Insert at head is O(1); insert at tail has to walk every node — watch <code>cur</code> crawl down the chain.
      </p>
    </div>
  );
}

export const listTopic: TopicModule = {
  id: 'list',
  label: 'Linked List',
  tag: 'O(1) head · O(n) tail',
  blurb:
    'Nodes scattered in memory, chained by next pointers. Insert, delete and traverse while cur hops from node to node.',
  camera: [0, 2.6, 12],
  defaults: { ops: [], input: '10' } as Params,
  build,
  Controls,
  View,
};
