import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { fitScale, lineOf, parseNums } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, type EdgeSpec, type TileSpec } from '../three/anim';

type TNode = { v: number; l: TNode | null; r: TNode | null };
type Action = { kind: 'insert'; v: number } | { kind: 'inorder' } | { kind: 'search'; v: number };
type Params = { values: number[]; action: Action };
type Placed = { id: number; v: number; x: number; y: number; l: number | null; r: number | null; mark: Mark };
type TreeState = { nodes: Placed[]; depth: number };

const MAX_NODES = 15;

const JAVA = `class Node {
    int value;
    Node left, right;
}                                                  // node

Node insert(Node node, int value) {
    if (node == null) return new Node(value);      // base
    if (value < node.value)
        node.left = insert(node.left, value);      // left
    else if (value > node.value)
        node.right = insert(node.right, value);    // right
    return node;                                   // duplicate
}

void inorder(Node node, List<Integer> out) {
    if (node == null) return;                      // inorderBase
    inorder(node.left, out);                       // inorderLeft
    out.add(node.value);                           // visit
    inorder(node.right, out);                      // inorderRight
}

boolean contains(Node node, int value) {
    if (node == null) return false;                // searchBase
    if (node.value == value) return true;          // searchHit
    return value < node.value
        ? contains(node.left, value)               // searchLeft
        : contains(node.right, value);             // searchRight
}`;

function insertNode(root: TNode | null, v: number): TNode {
  if (!root) return { v, l: null, r: null };
  if (v < root.v) root.l = insertNode(root.l, v);
  else if (v > root.v) root.r = insertNode(root.r, v);
  return root;
}

function fromValues(values: number[]): TNode | null {
  let root: TNode | null = null;
  for (const v of values) root = insertNode(root, v);
  return root;
}

function layoutOf(root: TNode | null, markFor: (v: number) => Mark): TreeState {
  const flat: { node: TNode; depth: number; col: number }[] = [];
  const index = new Map<TNode, number>();
  let col = 0;

  const walk = (n: TNode | null, depth: number) => {
    if (!n) return;
    walk(n.l, depth + 1);
    index.set(n, flat.length);
    flat.push({ node: n, depth, col: col++ });
    walk(n.r, depth + 1);
  };
  walk(root, 0);

  const total = flat.length;
  const maxDepth = flat.reduce((m, f) => Math.max(m, f.depth), 0);
  const nodes: Placed[] = flat.map((f, i) => ({
    id: i,
    v: f.node.v,
    x: (f.col - (total - 1) / 2) * 1.34,
    y: -f.depth * 1.52,
    l: f.node.l ? index.get(f.node.l) ?? null : null,
    r: f.node.r ? index.get(f.node.r) ?? null : null,
    mark: markFor(f.node.v),
  }));

  return { nodes, depth: maxDepth };
}

function build(p: Params): Program<TreeState> {
  const java = JAVA;
  const ln = (needle: string) => lineOf(java, needle);
  const values = (p.values ?? []).slice(0, MAX_NODES);
  const action: Action = p.action ?? { kind: 'inorder' };
  const steps: Step<TreeState>[] = [];
  const snap = (note: string, line: number, state: TreeState) => steps.push({ note, line, state });

  const isInsert = action.kind === 'insert';
  const baseValues = isInsert ? values.slice(0, -1) : values;
  let root = fromValues(baseValues);
  const path: number[] = [];

  if (baseValues.length === 0 && !isInsert) {
    snap('Empty tree. Insert values to grow a binary search tree.', ln('class Node'), layoutOf(null, () => 'idle'));
    return { java, steps };
  }

  if (action.kind === 'insert') {
    const v = action.v;
    if (baseValues.length >= MAX_NODES) {
      snap(`Demo holds ${MAX_NODES} nodes — reset to keep inserting.`, ln('Node insert'), layoutOf(root, () => 'idle'));
      return { java, steps };
    }
    snap(`insert(${v}): start at the root and follow the BST rule left < node < right.`, ln('Node insert'), layoutOf(root, () => 'idle'));

    let cur: TNode | null = root;
    let guard = 0;
    while (cur && guard++ < 24) {
      const here: TNode = cur;
      const goLeft = v < here.v;
      const dup = v === here.v;
      const marks = (val: number): Mark =>
        val === here.v ? 'active' : path.includes(val) ? 'path' : 'idle';
      snap(
        dup
          ? `${v} == ${here.v} → duplicates are ignored in this BST.`
          : `${v} ${goLeft ? '<' : '>'} ${here.v} → go ${goLeft ? 'left' : 'right'}.`,
        ln(dup ? '// duplicate' : goLeft ? '// left' : '// right'),
        layoutOf(root, marks)
      );
      if (dup) return { java, steps };
      path.push(here.v);
      cur = goLeft ? here.l : here.r;
    }

    root = insertNode(root, v);
    snap(
      `node == null → allocate new Node(${v}) and attach it as a leaf.`,
      ln('// base'),
      layoutOf(root, (val) => (val === v ? 'inserted' : path.includes(val) ? 'path' : 'idle'))
    );
    snap(
      `Height is now ${layoutOf(root, () => 'idle').depth + 1} · average insert costs O(log n) when balanced.`,
      ln('Node insert'),
      layoutOf(root, (val) => (val === v ? 'inserted' : 'idle'))
    );
  }

  if (action.kind === 'inorder') {
    const out: number[] = [];
    snap('In-order traversal visits left subtree → node → right subtree, which yields sorted output.', ln('void inorder'), layoutOf(root, () => 'idle'));
    const walkNode = (n: TNode | null) => {
      if (!n) return;
      walkNode(n.l);
      out.push(n.v);
      snap(
        `Visit ${n.v} → output so far [${out.join(', ')}]`,
        ln('// visit'),
        layoutOf(root, (val) => (out.includes(val) ? 'visited' : 'idle'))
      );
      walkNode(n.r);
    };
    walkNode(root);
    snap(`Sorted output: [${out.join(', ')}] · every node visited once → O(n).`, ln('// inorderRight'), layoutOf(root, () => 'sorted'));
  }

  if (action.kind === 'search') {
    const v = action.v;
    snap(`contains(${v}): compare at each node and discard half the tree.`, ln('boolean contains'), layoutOf(root, () => 'idle'));
    let cur: TNode | null = root;
    let found = false;
    let guard = 0;
    while (cur && guard++ < 24) {
      const here: TNode = cur;
      const marks = (val: number): Mark => (val === here.v ? 'active' : path.includes(val) ? 'path' : 'idle');
      if (here.v === v) {
        found = true;
        snap(`${here.v} == ${v} → return true, found it in ${path.length + 1} comparison(s).`, ln('// searchHit'), layoutOf(root, (val) => (val === v ? 'found' : path.includes(val) ? 'path' : 'idle')));
        break;
      }
      const goLeft = v < here.v;
      snap(`${v} ${goLeft ? '<' : '>'} ${here.v} → recurse ${goLeft ? 'left' : 'right'}.`, ln(goLeft ? '// searchLeft' : '// searchRight'), layoutOf(root, marks));
      path.push(here.v);
      cur = goLeft ? here.l : here.r;
    }
    if (!found) {
      snap(`Reached null → ${v} is not in the tree, return false. O(log n) for a balanced tree.`, ln('// searchBase'), layoutOf(root, (val) => (path.includes(val) ? 'path' : 'idle')));
    }
  }

  return { java, steps };
}

type ViewProps = { state: TreeState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const nodes = state.nodes;
  const xs = nodes.map((n) => n.x);
  const width = nodes.length ? Math.max(...xs) - Math.min(...xs) + 2.2 : 2;
  const height = (state.depth + 1) * 1.52 + 1;
  const scale = fitScale(width, height);
  const shift = (state.depth * 1.52) / 2;

  const tiles: TileSpec[] = nodes.map((node) => ({
    id: `n${node.v}`,
    value: node.v,
    mark: node.mark,
    pos: [node.x, node.y, 0],
    size: [0.98, 0.98, 0.98],
    labelScale: 0.72,
    onInspect: () =>
      onInspect({
        title: `Node ${node.v}`,
        meta: [
          ['value', String(node.v)],
          ['left child', node.l !== null ? String(nodes[node.l].v) : 'null'],
          ['right child', node.r !== null ? String(nodes[node.r].v) : 'null'],
          ['state', node.mark],
        ],
      }),
  }));

  const edges: EdgeSpec[] = [];
  for (const node of nodes) {
    for (const child of [node.l, node.r]) {
      if (child === null) continue;
      const walked = node.mark === 'path' || node.mark === 'active';
      edges.push({
        id: `edge-${node.v}-${nodes[child].v}`,
        a: `n${node.v}`,
        b: `n${nodes[child].v}`,
        soft: !walked,
        trimA: 0.52,
        trimB: 0.52,
        radius: 0.022,
        color: walked ? '#c9a227' : '#c3b49a',
      });
    }
  }

  return (
    <group scale={scale} position={[0, shift, 0]}>
      <AnimatedStage tiles={tiles} edges={edges} spawn="above" exit="above" duration={animMs} />

      {nodes.length === 0 && <Label text="null" color="#33506b" scale={0.7} />}
      {nodes.length > 0 && (
        <Html center position={[nodes[0].x, nodes[0].y + 1.02, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ptr ptr-accent">root</div>
        </Html>
      )}
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  const values: number[] = params.values ?? [];
  const value = parseNums(params.input ?? '', 1)[0];
  const ready = Number.isFinite(value);

  const act = (action: Action, nextValues = values) => setParams({ values: nextValues, input: params.input, action });

  return (
    <div className="ctrl">
      <label className="field">
        <span>Value · {values.length}/{MAX_NODES} nodes</span>
        <input
          className="inp"
          value={params.input ?? ''}
          spellCheck={false}
          placeholder="45"
          onChange={(e) => setParams({ ...params, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && values.length < MAX_NODES) {
              act({ kind: 'insert', v: value }, [...values, value]);
            }
          }}
        />
      </label>
      <div className="row">
        <button
          className="btn primary"
          disabled={!ready || values.length >= MAX_NODES}
          onClick={() => act({ kind: 'insert', v: value }, [...values, value])}
        >
          Insert
        </button>
        <button className="btn" onClick={() => act({ kind: 'inorder' })}>
          In-order
        </button>
        <button className="btn" disabled={!ready} onClick={() => act({ kind: 'search', v: value })}>
          Search
        </button>
        <button className="btn ghost" onClick={() => setParams({ values: [], input: '', action: { kind: 'inorder' } })}>
          Reset
        </button>
      </div>
      <p className="hint">
        Insert builds the tree live; in-order traversal always prints the values in ascending order — click nodes to
        inspect their children.
      </p>
    </div>
  );
}

export const treeTopic: TopicModule = {
  id: 'tree',
  label: 'Binary Search Tree',
  tag: 'O(log n) balanced',
  blurb:
    'Recursive structure in 3D: each node owns a left and right subtree. Insert walks the comparison path, in-order visits everything in sorted order.',
  camera: [0, 1.6, 13],
  defaults: {
    values: [50, 30, 70, 20, 40, 60, 80],
    input: '45',
    action: { kind: 'inorder' },
  } as Params,
  build,
  Controls,
  View,
};
