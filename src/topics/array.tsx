import { Html } from '@react-three/drei';
import type { ControlsProps, Mark, Program, Selected, Step, TopicModule } from './types';
import { fitScale, lineCount, lineOf, parseNums } from './util';
import { Label } from '../three/Label';
import { AnimatedStage, useStableIds, type EdgeSpec, type TileSpec } from '../three/anim';

type Algo = 'bubble' | 'selection' | 'insertion' | 'linear' | 'binary';
type Params = { raw: string; algo: Algo; target: string };
type Pointer = { label: string; index: number };
type ArrState = { values: number[]; marks: Mark[]; pointers: Pointer[] };

const JAVA: Record<Algo, string> = {
  bubble: `void bubbleSort(int[] a) {
    int n = a.length;
    for (int i = 0; i < n - 1; i++) {            // outer
        boolean swapped = false;                // reset
        for (int j = 0; j < n - 1 - i; j++) {   // inner
            if (a[j] > a[j + 1]) {              // compare
                int tmp = a[j];                 // swap
                a[j] = a[j + 1];
                a[j + 1] = tmp;
                swapped = true;
            }
        }
        if (!swapped) break;                    // earlyExit
    }
}`,
  selection: `void selectionSort(int[] a) {
    int n = a.length;
    for (int i = 0; i < n - 1; i++) {           // outer
        int min = i;                            // min
        for (int j = i + 1; j < n; j++) {       // inner
            if (a[j] < a[min]) min = j;         // compare
        }
        int tmp = a[min];                       // swap
        a[min] = a[i];
        a[i] = tmp;
    }
}`,
  insertion: `void insertionSort(int[] a) {
    for (int i = 1; i < a.length; i++) {        // outer
        int key = a[i];                         // key
        int j = i - 1;
        while (j >= 0 && a[j] > key) {          // compare
            a[j + 1] = a[j];                    // shift
            j--;
        }
        a[j + 1] = key;                         // place
    }
}`,
  linear: `int linearSearch(int[] a, int key) {
    for (int i = 0; i < a.length; i++) {        // outer
        if (a[i] == key) return i;              // compare
    }
    return -1;                                  // miss
}`,
  binary:
`int binarySearch(int[] a, int key) {
    int lo = 0, hi = a.length - 1;              // init
    while (lo <= hi) {                          // loop
        int mid = lo + (hi - lo) / 2;           // mid
        if (a[mid] == key) return mid;          // compare
        if (a[mid] < key) lo = mid + 1;         // right
        else hi = mid - 1;                      // left
    }
    return -1;                                  // miss
}`,
};

const ALGOS: { id: Algo; short: string; full: string }[] = [
  { id: 'bubble', short: 'Bubble', full: 'Bubble sort' },
  { id: 'selection', short: 'Select', full: 'Selection sort' },
  { id: 'insertion', short: 'Insert', full: 'Insertion sort' },
  { id: 'linear', short: 'Linear', full: 'Linear search' },
  { id: 'binary', short: 'Binary', full: 'Binary search' },
];

function keyOf(raw: string, fallback: number): number {
  const n = parseNums(raw, 1)[0];
  return Number.isFinite(n) ? n : fallback;
}

function build(p: Params): Program<ArrState> {
  const java = JAVA[p.algo];
  const ln = (needle: string) => lineOf(java, needle);
  const end = lineCount(java);

  const parsed = parseNums(p.raw);
  const values = parsed.length > 0 ? parsed : [5, 2, 9, 1, 7, 3];
  const marks: Mark[] = values.map(() => 'idle');
  const steps: Step<ArrState>[] = [];

  const snap = (note: string, line: number, pointers: Pointer[] = []) =>
    steps.push({ note, line, state: { values: [...values], marks: [...marks], pointers } });

  const reset = () => marks.fill('idle');
  const paintSorted = (upTo: number, from = 0) => {
    for (let k = from; k < upTo; k++) marks[k] = 'sorted';
  };

  if (p.algo === 'bubble') {
    const n = values.length;
    snap('Compare neighbours left to right; swap when the left value is larger.', ln('void bubbleSort'));
    let finished = false;
    for (let i = 0; i < n - 1 && !finished; i++) {
      let swapped = false;
      for (let j = 0; j < n - 1 - i; j++) {
        reset();
        paintSorted(n, n - i);
        marks[j] = 'compare';
        marks[j + 1] = 'compare';
        snap(`Compare a[${j}] = ${values[j]} with a[${j + 1}] = ${values[j + 1]}.`, ln('// compare'), [
          { label: 'j', index: j },
        ]);
        if (values[j] > values[j + 1]) {
          const note = `${values[j]} > ${values[j + 1]} → swap them.`;
          const tmp = values[j];
          values[j] = values[j + 1];
          values[j + 1] = tmp;
          swapped = true;
          reset();
          paintSorted(n, n - i);
          marks[j] = 'swap';
          marks[j + 1] = 'swap';
          snap(note, ln('// swap'), [{ label: 'j', index: j }]);
        } else {
          snap(`${values[j]} ≤ ${values[j + 1]} → already ordered, no swap.`, ln('// inner'), [
            { label: 'j', index: j },
          ]);
        }
      }
      reset();
      paintSorted(n, n - i - 1);
      snap(`Pass ${i + 1} done: a[${n - 1 - i}] = ${values[n - 1 - i]} is locked in place.`, ln('// outer'));
      if (!swapped) {
        snap('Nothing swapped during that pass, so the array must be sorted. Early exit.', ln('// earlyExit'));
        finished = true;
      }
    }
    reset();
    marks.fill('sorted');
    snap(`Sorted ✓  [${values.join(', ')}]  —  O(n²) worst case, O(1) extra space.`, end);
  }

  if (p.algo === 'selection') {
    const n = values.length;
    snap('Repeatedly pick the smallest remaining value and move it to the front.', ln('void selectionSort'));
    for (let i = 0; i < n - 1; i++) {
      let min = i;
      reset();
      paintSorted(i);
      marks[min] = 'compare';
      snap(`Scan from index ${i}: assume a[${i}] = ${values[i]} is the minimum.`, ln('// min'), [
        { label: 'min', index: min },
      ]);
      for (let j = i + 1; j < n; j++) {
        reset();
        paintSorted(i);
        marks[min] = 'compare';
        marks[j] = 'swap';
        snap(`Is a[${j}] = ${values[j]} < a[${min}] = ${values[min]}?`, ln('// compare'), [
          { label: 'j', index: j },
          { label: 'min', index: min },
        ]);
        if (values[j] < values[min]) {
          min = j;
          reset();
          paintSorted(i);
          marks[min] = 'found';
          snap(`Yes → the new minimum is a[${min}] = ${values[min]}.`, ln('// compare'), [
            { label: 'min', index: min },
          ]);
        }
      }
      if (min !== i) {
        const tmp = values[i];
        values[i] = values[min];
        values[min] = tmp;
        reset();
        paintSorted(i);
        marks[i] = 'swap';
        marks[min] = 'swap';
        snap(`Swap a[${i}] with a[${min}]: ${values[min]} ↔ ${values[i]}.`, ln('// swap'), []);
      }
      reset();
      paintSorted(i + 1);
      snap(`a[${i}] = ${values[i]} is final.`, ln('// outer'));
    }
    reset();
    marks.fill('sorted');
    snap(`Sorted ✓  [${values.join(', ')}]  —  O(n²) comparisons, only O(n) swaps.`, end);
  }

  if (p.algo === 'insertion') {
    const n = values.length;
    snap('Grow a sorted prefix: take the next value and shift bigger ones to the right.', ln('void insertionSort'));
    for (let i = 1; i < n; i++) {
      const key = values[i];
      reset();
      for (let k = 0; k < i; k++) marks[k] = 'visited';
      marks[i] = 'compare';
      snap(`key = a[${i}] = ${key}. Find where it belongs in the sorted prefix.`, ln('// key'), [
        { label: 'i', index: i },
      ]);
      let j = i - 1;
      while (j >= 0 && values[j] > key) {
        const moved = values[j];
        values[j + 1] = moved;
        reset();
        for (let k = 0; k <= i; k++) marks[k] = 'visited';
        marks[j + 1] = 'swap';
        snap(`a[${j}] = ${moved} > ${key} → shift it right into slot ${j + 1}.`, ln('// shift'), [
          { label: 'j', index: j },
        ]);
        j--;
      }
      values[j + 1] = key;
      reset();
      for (let k = 0; k <= i; k++) marks[k] = 'visited';
      marks[j + 1] = 'inserted';
      snap(`Write key ${key} into a[${j + 1}].`, ln('// place'), [{ label: 'j+1', index: j + 1 }]);
    }
    reset();
    marks.fill('sorted');
    snap(`Sorted ✓  [${values.join(', ')}]  —  O(n²) worst case, O(n) when almost sorted.`, end);
  }

  if (p.algo === 'linear') {
    const key = keyOf(p.target, values[0]);
    snap(`Linear search for ${key}: check every slot from left to right.`, ln('void linearSearch'));
    let hit = -1;
    for (let i = 0; i < values.length; i++) {
      reset();
      marks[i] = 'compare';
      snap(`a[${i}] = ${values[i]} ${values[i] === key ? '==' : '≠'} ${key}.`, ln('// compare'), [
        { label: 'i', index: i },
      ]);
      if (values[i] === key) {
        hit = i;
        marks[i] = 'found';
        snap(`Found ${key} at index ${i} → return ${i}.`, ln('// compare'), [{ label: 'i', index: i }]);
        break;
      }
    }
    if (hit < 0) {
      reset();
      snap(`${key} is not in the array → return -1.`, ln('// miss'));
    }
  }

  if (p.algo === 'binary') {
    values.sort((a, b) => a - b);
    const key = keyOf(p.target, values[Math.floor(values.length / 2)]);
    snap('Binary search halves the range each step, so the array is sorted first.', ln('void binarySearch'));
    let lo = 0;
    let hi = values.length - 1;
    let hit = -1;
    while (lo <= hi) {
      reset();
      for (let k = lo; k <= hi; k++) marks[k] = 'visited';
      const mid = lo + Math.floor((hi - lo) / 2);
      marks[mid] = 'compare';
      snap(`Range [${lo}..${hi}] → mid = ${mid}, a[mid] = ${values[mid]}.`, ln('// mid'), [
        { label: 'lo', index: lo },
        { label: 'mid', index: mid },
        { label: 'hi', index: hi },
      ]);
      if (values[mid] === key) {
        hit = mid;
        reset();
        marks[mid] = 'found';
        snap(`a[${mid}] == ${key} → return ${mid} after ${Math.ceil(Math.log2(values.length + 1))} checks.`, ln('// compare'), [
          { label: 'mid', index: mid },
        ]);
        break;
      }
      if (values[mid] < key) {
        lo = mid + 1;
        snap(`a[${mid}] = ${values[mid]} < ${key} → throw away the left half.`, ln('// right'), [
          { label: 'lo', index: lo },
          { label: 'hi', index: hi },
        ]);
      } else {
        hi = mid - 1;
        snap(`a[${mid}] = ${values[mid]} > ${key} → throw away the right half.`, ln('// left'), [
          { label: 'lo', index: lo },
          { label: 'hi', index: hi },
        ]);
      }
    }
    if (hit < 0) {
      reset();
      snap(`${key} is not present → the range became empty, return -1.`, ln('// miss'));
    }
  }

  if (steps.length === 0) {
    snap('Nothing to visualize yet.', 1);
  }

  return { java, steps };
}

type ViewProps = { state: ArrState; onInspect: (s: Selected) => void; animMs?: number };

function View({ state, onInspect, animMs }: ViewProps) {
  const n = state.values.length;
  const gap = 1.55;
  const scale = fitScale(Math.max(n, 1) * gap + 1, 3.4);
  const ids = useStableIds(state.values);

  // thin rails between neighbouring slots: the array reads as one sequence
  const rails: EdgeSpec[] = ids.slice(1).map((id, i) => ({
    id: `rail-${i}`,
    a: ids[i],
    b: id,
    soft: true,
    radius: 0.016,
    trimA: 0.57,
    trimB: 0.57,
  }));

  const tiles: TileSpec[] = state.values.map((value, i) => ({
    id: ids[i],
    value,
    mark: state.marks[i] ?? 'idle',
    pos: [(i - (n - 1) / 2) * gap, 0, 0],
    onInspect: () =>
      onInspect({
        title: `a[${i}]`,
        meta: [
          ['value', String(value)],
          ['index', String(i)],
          ['state', state.marks[i] ?? 'idle'],
          ['address', `base + ${i} × 4 bytes`],
        ],
      }),
  }));

  return (
    <group scale={scale}>
      <AnimatedStage tiles={tiles} edges={rails} spawn="above" exit="below" duration={animMs}>
        {state.values.map((_, i) => (
          <Label
            key={`slot-${i}`}
            text={String(i)}
            color="#8b7a5e"
            scale={0.5}
            position={[(i - (n - 1) / 2) * gap, -0.98, 0]}
          />
        ))}
      </AnimatedStage>
      {state.pointers
        .filter((p) => p.index >= 0 && p.index < n)
        .map((p, k) => (
          <Html
            key={`${p.label}-${p.index}`}
            center
            position={[(p.index - (n - 1) / 2) * gap, 1.3 + (k % 3) * 0.36, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="ptr">{p.label}</div>
          </Html>
        ))}
    </group>
  );
}

function Controls({ params, setParams }: ControlsProps) {
  const current = ALGOS.find((a) => a.id === params.algo)?.full ?? '';
  return (
    <div className="ctrl">
      <label className="field">
        <span>Array values</span>
        <input
          className="inp"
          value={params.raw}
          spellCheck={false}
          onChange={(e) => setParams({ ...params, raw: e.target.value })}
          placeholder="5, 3, 8, 1"
        />
      </label>
      <div className="field">
        <span>Algorithm · {current}</span>
        <div className="seg">
          {ALGOS.map((a) => (
            <button
              key={a.id}
              className={`seg-btn ${params.algo === a.id ? 'on' : ''}`}
              onClick={() => setParams({ ...params, algo: a.id })}
            >
              {a.short}
            </button>
          ))}
        </div>
      </div>
      {(params.algo === 'linear' || params.algo === 'binary') && (
        <label className="field">
          <span>Search target</span>
          <input
            className="inp"
            value={params.target}
            onChange={(e) => setParams({ ...params, target: e.target.value })}
            placeholder="7"
          />
        </label>
      )}
    </div>
  );
}

export const arrayTopic: TopicModule = {
  id: 'array',
  label: 'Arrays & Sorting',
  tag: 'O(n²) · O(log n)',
  blurb:
    'Contiguous int[] slots. Watch index pointers move, compare pairs, and swap in place — bubble, selection, insertion, linear and binary search.',
  camera: [0.5, 3.6, 12],
  defaults: { raw: '5, 2, 9, 1, 7, 3, 8, 4', algo: 'bubble', target: '7' } as Params,
  build,
  Controls,
  View,
};
