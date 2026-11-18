import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { fitScale, lineOf, parseGrid } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, useStableIds, type EdgeSpec, type TileSpec } from '../three/anim';

type Mode = 'spiral' | 'transpose';
type Params = { raw: string; mode: Mode };
type GridState = { grid: number[][]; marks: Mark[][]; order: number | null };

const SPIRAL = `List<Integer> spiral(int[][] m) {
    List<Integer> out = new ArrayList<>();
    int top = 0, bottom = m.length - 1;              // bounds
    int left = 0, right = m[0].length - 1;
    while (top <= bottom && left <= right) {         // loop
        for (int c = left; c <= right; c++)
            out.add(m[top][c]);                      // right
        top++;                                       // shrinkTop
        for (int r = top; r <= bottom; r++)
            out.add(m[r][right]);                    // down
        right--;                                     // shrinkRight
        for (int c = right; c >= left && top <= bottom; c--)
            out.add(m[bottom][c]);                   // leftward
        bottom--;                                    // shrinkBottom
        for (int r = bottom; r >= top && left <= right; r--)
            out.add(m[r][left]);                     // up
        left++;                                      // shrinkLeft
    }
    return out;
}`;

const TRANSPOSE = `int[][] transpose(int[][] m) {
    int rows = m.length, cols = m[0].length;
    int[][] t = new int[cols][rows];                 // alloc
    for (int r = 0; r < rows; r++) {                 // outer
        for (int c = 0; c < cols; c++) {             // inner
            t[c][r] = m[r][c];                       // copy
        }
    }
    return t;
}`;

function build(p: Params): Program<GridState> {
  const raw = parseGrid(p.raw);
  const steps: Step<GridState>[] = [];

  if (p.mode === 'spiral') {
    const java = SPIRAL;
    const ln = (n: string) => lineOf(java, n);
    const grid = raw.map((row) => [...row]);
    const marks: Mark[][] = grid.map((row) => row.map(() => 'idle' as Mark));
    const collected: number[] = [];
    let count = 0;

    const snap = (note: string, line: number) =>
      steps.push({
        note,
        line,
        state: { grid: grid.map((r) => [...r]), marks: marks.map((r) => [...r]), order: count },
      });

    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        snap(`Scan the matrix clockwise, peeling one ring at a time. ${grid.length}×${grid[0].length}.`, ln('// bounds'));
        break;
      }
      break;
    }

    const visit = (r: number, c: number, line: number, dir: string) => {
      for (const row of marks) for (let i = 0; i < row.length; i++) row[i] = row[i] === 'active' ? 'visited' : row[i];
      marks[r][c] = 'active';
      collected.push(grid[r][c]);
      count++;
      snap(`${dir} → read m[${r}][${c}] = ${grid[r][c]}  ·  output so far: [${collected.join(', ')}]`, line);
    };

    let top = 0;
    let bottom = grid.length - 1;
    let left = 0;
    let right = grid[0].length - 1;

    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) visit(top, c, ln('// right'), 'Move right');
      top++;
      for (let r = top; r <= bottom; r++) visit(r, right, ln('// down'), 'Move down');
      right--;
      for (let c = right; c >= left && top <= bottom; c--) visit(bottom, c, ln('// leftward'), 'Move left');
      bottom--;
      for (let r = bottom; r >= top && left <= right; r--) visit(r, left, ln('// up'), 'Move up');
      left++;
    }

    marks.forEach((row) => row.fill('found'));
    snap(`Spiral order complete: [${collected.join(', ')}]  —  O(rows × cols) time.`, ln('// loop'));
    return { java, steps };
  }

  const java = TRANSPOSE;
  const ln = (n: string) => lineOf(java, n);
  const grid = raw.map((row) => [...row]);
  const marks: Mark[][] = grid.map((row) => row.map(() => 'idle' as Mark));
  const R = grid.length;
  const C = grid[0].length;

  const snap = (note: string, line: number, next?: number[][]) =>
    steps.push({
      note,
      line,
      state: {
        grid: (next ?? grid).map((r) => [...r]),
        marks: marks.map((r) => [...r]),
        order: null,
      },
    });

  snap(`Transpose swaps rows and columns: ${R}×${C} becomes ${C}×${R}.`, ln('int[][] transpose'));

  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      marks.forEach((row) => row.fill('idle'));
      marks[r][c] = 'active';
      snap(`t[${c}][${r}] = m[${r}][${c}] = ${grid[r][c]}.`, ln('// copy'));
    }
  }

  const flipped = Array.from({ length: C }, (_, c) => Array.from({ length: R }, (_, r) => grid[r][c]));
  const flippedMarks: Mark[][] = flipped.map((row) => row.map(() => 'found' as Mark));
  steps.push({
    note: `Done — every element moved to its mirrored cell. ${C}×${R} result.`,
    line: ln('return t'),
    state: { grid: flipped, marks: flippedMarks, order: null },
  });

  return { java, steps };
}

type ViewProps = { state: GridState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const rows = state.grid.length;
  const cols = state.grid[0]?.length ?? 1;
  const gap = 1.45;
  const scale = fitScale(cols * gap + 1, rows * gap + 1);
  const ids = useStableIds(state.grid.flat());

  // rails between row neighbours and column neighbours: the grid's real
  // adjacency is visible, so no index counting is needed
  const rails: EdgeSpec[] = [];
  state.grid.forEach((row, r) =>
    row.forEach((_, c) => {
      if (c > 0) {
        rails.push({ id: `h-${r}-${c}`, a: ids[r * cols + c - 1], b: ids[r * cols + c], soft: true, radius: 0.014, trimA: 0.57, trimB: 0.57 });
      }
      if (r > 0) {
        rails.push({ id: `v-${r}-${c}`, a: ids[(r - 1) * cols + c], b: ids[r * cols + c], soft: true, radius: 0.014, trimA: 0.57, trimB: 0.57 });
      }
    })
  );

  const tiles: TileSpec[] = [];
  state.grid.forEach((row, r) =>
    row.forEach((value, c) => {
      tiles.push({
        id: ids[r * cols + c],
        value,
        mark: state.marks[r]?.[c] ?? 'idle',
        pos: [(c - (cols - 1) / 2) * gap, -(r - (rows - 1) / 2) * gap, 0],
        size: [1.12, 1.12, 0.42],
        labelScale: 0.8,
        onInspect: () =>
          onInspect({
            title: `m[${r}][${c}]`,
            meta: [
              ['value', String(value)],
              ['row', String(r)],
              ['col', String(c)],
              ['offset', `${r} × ${cols} + ${c} = ${r * cols + c}`],
            ],
          }),
      });
    })
  );

  return (
    <group scale={scale}>
      <AnimatedStage tiles={tiles} edges={rails} spawn="below" exit="below" duration={animMs} />
      <Label text={`${rows} × ${cols}`} color="#4e6d8a" scale={0.75} position={[0, -(rows * gap) / 2 - 0.75, 0]} />
      <group position={[0, 0, -0.3]}>
        <mesh>
          <planeGeometry args={[(cols + 1) * gap, (rows + 1) * gap]} />
          <meshBasicMaterial color="#0b1524" transparent opacity={0.55} />
        </mesh>
      </group>
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  return (
    <div className="ctrl">
      <label className="field">
        <span>Matrix — one row per line</span>
        <textarea
          className="inp area"
          rows={4}
          spellCheck={false}
          value={params.raw}
          onChange={(e) => setParams({ ...params, raw: e.target.value })}
        />
      </label>
      <div className="field">
        <span>Traversal</span>
        <div className="seg">
          <button
            className={`seg-btn ${params.mode === 'spiral' ? 'on' : ''}`}
            onClick={() => setParams({ ...params, mode: 'spiral' })}
          >
            Spiral
          </button>
          <button
            className={`seg-btn ${params.mode === 'transpose' ? 'on' : ''}`}
            onClick={() => setParams({ ...params, mode: 'transpose' })}
          >
            Transpose
          </button>
        </div>
      </div>
      <button
        className="btn"
        onClick={() =>
          setParams({
            ...params,
            raw: Array.from({ length: 4 }, () =>
              Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 90)).join(' ')
            ).join('\n'),
          })
        }
      >
        Randomize 4 × 5
      </button>
    </div>
  );
}

export const matrixTopic: TopicModule = {
  id: 'matrix',
  label: 'Matrices',
  tag: 'O(rows × cols)',
  blurb:
    'A 2D int[][] grid in 3D. Follow the ring-by-ring spiral read, or watch in-place row/column mirroring during a transpose.',
  camera: [0, 1.2, 11],
  defaults: {
    raw: '1  2  3  4  5\n6  7  8  9 10\n11 12 13 14 15\n16 17 18 19 20',
    mode: 'spiral',
  } as Params,
  build,
  Controls,
  View,
};
