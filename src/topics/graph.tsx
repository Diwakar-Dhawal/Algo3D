import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { lineOf } from './util';
import { BoxValue } from '../three/BoxValue';
import { Label } from '../three/Label';
import { Link } from '../three/Link';

type Algo = 'bfs' | 'dfs';
type Params = { start: string; algo: Algo };
type GraphState = {
  visited: string[];
  frontier: string[];
  active: string | null;
  traversed: [string, string][];
};

export const NODES: { id: string; pos: [number, number, number] }[] = [
  { id: 'A', pos: [-3.6, 1.1, 0.3] },
  { id: 'B', pos: [-1.4, 2.3, -0.7] },
  { id: 'C', pos: [1.2, 2.2, 0.7] },
  { id: 'D', pos: [3.5, 1.0, -0.3] },
  { id: 'E', pos: [-1.7, -1.3, 0.9] },
  { id: 'F', pos: [1.3, -1.4, -0.9] },
  { id: 'G', pos: [3.3, -1.5, 0.7] },
];

export const EDGES: [string, string][] = [
  ['A', 'B'],
  ['A', 'E'],
  ['B', 'C'],
  ['B', 'F'],
  ['C', 'D'],
  ['C', 'F'],
  ['E', 'F'],
  ['F', 'G'],
  ['D', 'G'],
];

const posOf = (id: string) => NODES.find((n) => n.id === id)?.pos ?? ([0, 0, 0] as [number, number, number]);

const ADJ: Record<string, string[]> = Object.fromEntries(NODES.map((n) => [n.id, [] as string[]]));
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

const JAVA: Record<Algo, string> = {
  bfs: `void bfs(Map<String, List<String>> g, String start) {
    Set<String> seen = new HashSet<>();
    Queue<String> q = new ArrayDeque<>();
    q.add(start);
    seen.add(start);                            // enqueue
    while (!q.isEmpty()) {                      // loop
        String u = q.poll();                    // poll
        visit(u);
        for (String v : g.get(u)) {             // neighbours
            if (seen.add(v)) q.add(v);          // discover
        }
    }
}`,
  dfs: `void dfs(Map<String, List<String>> g, String start) {
    Set<String> seen = new HashSet<>();
    Deque<String> stack = new ArrayDeque<>();
    stack.push(start);
    while (!stack.isEmpty()) {                  // loop
        String u = stack.pop();                 // pop
        if (seen.contains(u)) continue;
        seen.add(u);                            // mark
        visit(u);
        for (String v : g.get(u))
            if (!seen.contains(v)) stack.push(v);// push
    }
}`,
};

function build(p: Params): Program<GraphState> {
  const algo: Algo = p.algo ?? 'bfs';
  const start = NODES.some((n) => n.id === p.start) ? p.start : 'A';
  const java = JAVA[algo];
  const ln = (needle: string) => lineOf(java, needle);
  const steps: Step<GraphState>[] = [];
  const snap = (note: string, line: number, state: GraphState) => steps.push({ note, line, state });

  const visited: string[] = [];
  const traversed: [string, string][] = [];
  const seen = new Set<string>();

  if (algo === 'bfs') {
    const queue: string[] = [start];
    seen.add(start);
    snap(`BFS from ${start}: a queue explores level by level (shortest hop count first).`, ln('// enqueue'), {
      visited: [],
      frontier: [...queue],
      active: start,
      traversed: [],
    });

    while (queue.length) {
      const u = queue.shift()!;
      visited.push(u);
      snap(`Poll ${u} → visit it. Queue holds [${queue.join(', ') || 'nothing'}].`, ln('// poll'), {
        visited: [...visited],
        frontier: [...queue],
        active: u,
        traversed: [...traversed],
      });

      for (const v of ADJ[u]) {
        if (seen.has(v)) {
          snap(`${v} is already seen → skip, otherwise we would loop forever.`, ln('// neighbours'), {
            visited: [...visited],
            frontier: [...queue],
            active: u,
            traversed: [...traversed],
          });
          continue;
        }
        seen.add(v);
        queue.push(v);
        traversed.push([u, v]);
        snap(`Discover ${v} from ${u} → mark seen, enqueue. Queue: [${queue.join(', ')}].`, ln('// discover'), {
          visited: [...visited],
          frontier: [...queue],
          active: u,
          traversed: [...traversed],
        });
      }
    }

    snap(`BFS order: ${visited.join(' → ')} · O(V + E) time with an adjacency list.`, ln('// loop'), {
      visited: [...visited],
      frontier: [],
      active: null,
      traversed: [...traversed],
    });
  } else {
    const stack: string[] = [start];
    snap(`DFS from ${start}: a stack drives depth-first exploration — dive as deep as possible.`, ln('void dfs'), {
      visited: [],
      frontier: [...stack],
      active: start,
      traversed: [],
    });

    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) {
        snap(`${u} is already seen → continue.`, ln('// pop'), {
          visited: [...visited],
          frontier: [...stack],
          active: u,
          traversed: [...traversed],
        });
        continue;
      }
      seen.add(u);
      visited.push(u);
      snap(`Pop ${u} → mark seen and visit. Stack: [${stack.join(', ') || 'empty'}].`, ln('// mark'), {
        visited: [...visited],
        frontier: [...stack],
        active: u,
        traversed: [...traversed],
      });

      for (const v of ADJ[u]) {
        if (seen.has(v)) continue;
        stack.push(v);
        if (!traversed.some(([x, y]) => (x === u && y === v) || (x === v && y === u))) traversed.push([u, v]);
        snap(`Push ${v} → stack: [${stack.join(', ')}]. The last pushed is explored next.`, ln('// push'), {
          visited: [...visited],
          frontier: [...stack],
          active: u,
          traversed: [...traversed],
        });
      }
    }

    snap(`DFS order: ${visited.join(' → ')} · O(V + E). Recursion would give the same order.`, ln('// loop'), {
      visited: [...visited],
      frontier: [],
      active: null,
      traversed: [...traversed],
    });
  }

  return { java, steps };
}

function View({ state, onInspect }: { state: GraphState; onInspect: (s: Selected) => void }) {
  const markFor = (id: string): Mark => {
    if (state.active === id) return 'active';
    if (state.visited.includes(id)) return 'visited';
    if (state.frontier.includes(id)) return 'frontier';
    return 'idle';
  };

  const linkColor = (a: string, b: string) =>
    state.traversed.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? '#38e1ff' : '#22415e';

  return (
    <group>
      {EDGES.map(([a, b]) => (
        <Link key={`${a}-${b}`} from={posOf(a)} to={posOf(b)} radius={0.026} color={linkColor(a, b)} />
      ))}

      {NODES.map((node) => (
        <group key={node.id} position={node.pos}>
          <BoxValue
            value={node.id}
            mark={markFor(node.id)}
            size={[0.98, 0.98, 0.98]}
            labelScale={0.7}
            onInspect={() =>
              onInspect({
                title: `Vertex ${node.id}`,
                meta: [
                  ['neighbours', ADJ[node.id].join(', ')],
                  ['degree', String(ADJ[node.id].length)],
                  ['visited?', state.visited.includes(node.id) ? 'yes' : 'no'],
                  ['in frontier?', state.frontier.includes(node.id) ? 'yes' : 'no'],
                ],
              })
            }
          />
          <Label text={`deg ${ADJ[node.id].length}`} color="#33506b" scale={0.42} position={[0, -0.82, 0]} />
        </group>
      ))}

      <Html center position={[posOf(state.active ?? 'A')[0], posOf(state.active ?? 'A')[1] + 0.95, 0]} style={{ pointerEvents: 'none' }}>
        <div className="ptr ptr-warm">{state.active ? `u = ${state.active}` : 'done'}</div>
      </Html>
      <Label text="frontier" color="#ff9f43" scale={0.55} position={[-4.6, -2.6, 0]} />
      <Label text="visited" color="#38e1ff" scale={0.55} position={[-3.2, -2.6, 0]} />
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  return (
    <div className="ctrl">
      <div className="field">
        <span>Traversal</span>
        <div className="seg">
          <button className={`seg-btn ${params.algo === 'bfs' ? 'on' : ''}`} onClick={() => setParams({ ...params, algo: 'bfs' })}>
            BFS · queue
          </button>
          <button className={`seg-btn ${params.algo === 'dfs' ? 'on' : ''}`} onClick={() => setParams({ ...params, algo: 'dfs' })}>
            DFS · stack
          </button>
        </div>
      </div>
      <div className="field">
        <span>Start vertex</span>
        <div className="seg">
          {NODES.map((n) => (
            <button
              key={n.id}
              className={`seg-btn ${params.start === n.id ? 'on' : ''}`}
              onClick={() => setParams({ ...params, start: n.id })}
            >
              {n.id}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        BFS uses a queue and finds shortest paths in unweighted graphs; DFS uses a stack and dives deep before
        backtracking. Swap the start vertex to compare orders.
      </p>
    </div>
  );
}

export const graphTopic: TopicModule = {
  id: 'graph',
  label: 'Graphs',
  tag: 'BFS / DFS · O(V + E)',
  blurb:
    'An undirected adjacency-list graph floating in 3D. Watch the frontier grow, edges light up as they are traversed, and compare BFS with DFS.',
  camera: [0, 1.4, 13],
  defaults: { start: 'A', algo: 'bfs' } as Params,
  build,
  Controls,
  View,
};
