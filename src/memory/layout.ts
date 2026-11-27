import type { TraceObj, TraceStep, TraceVal } from '../jvm/types';
import type { Mark } from '../topics/types';

export const STACK_W = 214;
export const NODE = 64;
export const CELL = 36;

export function valText(v: TraceVal): string {
  if (v.kind === 'ref') return `@${v.id}`;
  if (v.kind === 'null') return 'null';
  return v.text;
}

export type MemNode = {
  key: string;
  x: number;
  y: number;
  size: number;
  label: string;
  sub?: string;
  mark: Mark;
  objId: number;
  index?: number;
  prev?: string;
  title: string;
};

export type MemEdge = {
  key: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrow?: boolean;
  soft?: boolean;
  /** gap in px kept free at each end (cells are smaller than list nodes) */
  trimA?: number;
  trimB?: number;
};

export type MemVar = { name: string; value: string; prev?: string; changed: boolean; ref?: number };
export type MemFrame = { id: number; method: string; owner: string; line: number; vars: MemVar[]; active: boolean };

export type MemCard = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  rows: { label: string; value: string; changed: boolean }[];
};

export type MemLabel = { key: string; x: number; y: number; text: string; align: 'left' | 'right'; kind: 'group' | 'null' | 'more' };
export type MemToken = { key: string; x1: number; y1: number; x2: number; y2: number; label: string };

export type MemLayout = {
  nodes: MemNode[];
  edges: MemEdge[];
  frames: MemFrame[];
  cards: MemCard[];
  labels: MemLabel[];
  tokens: MemToken[];
};

const VALUE_FIELDS = ['value', 'val', 'data', 'key', 'item', 'element', 'info'];
const NEXT_FIELDS = ['next', 'link', 'nextNode', 'succ'];

const isRef = (v: TraceVal | undefined): v is Extract<TraceVal, { kind: 'ref' }> => !!v && v.kind === 'ref';

function fieldOf(obj: TraceObj, names: string[]) {
  if (obj.kind !== 'object') return undefined;
  return (obj.fields ?? []).find((f) => names.includes(f.name));
}

function nodeLabel(obj: TraceObj): string {
  const preferred = fieldOf(obj, VALUE_FIELDS);
  if (preferred && preferred.value.kind === 'prim') return preferred.value.text;
  return `@${obj.id}`;
}

/** Builds frames (with every local) plus heap structures in pixel coordinates. */
export function buildLayout(step: TraceStep, width: number, height: number, stackW = STACK_W): MemLayout {
  const frames: MemFrame[] = step.stack
    .map((frame, index) => ({
      id: frame.id,
      method: frame.method,
      owner: frame.owner,
      line: frame.line,
      active: index === step.stack.length - 1,
      vars: [
        ...(frame.thisRef && isRef(frame.thisRef)
          ? [{ name: 'this', value: `@${frame.thisRef.id}`, changed: false, ref: frame.thisRef.id }]
          : []),
        ...frame.vars.map((variable) => ({
          name: variable.name,
          value: valText(variable.value),
          prev: variable.prev ? valText(variable.prev) : undefined,
          changed: !!variable.prev && valText(variable.prev) !== valText(variable.value),
          ref: variable.value.kind === 'ref' ? variable.value.id : undefined,
        })),
      ],
    }))
    .reverse();

  const nodes: MemNode[] = [];
  const edges: MemEdge[] = [];
  const cards: MemCard[] = [];
  const labels: MemLabel[] = [];
  const tokens: MemToken[] = [];

  const heap = step.heap;
  const byId = new Map(heap.map((o) => [o.id, o]));
  const left = stackW + 24;
  const right = Math.max(left + 120, width - 18);
  const areaW = right - left;
  // narrower cells on phones keep more of a short array on screen
  const cellSize = width < 560 ? 30 : CELL;
  // a visible gap between cells is what makes the connecting rail readable
  const cellGap = width < 560 ? 9 : 12;

  /* ---------- classify ---------- */

  const nextTarget = (obj: TraceObj): number | null => {
    const field = fieldOf(obj, NEXT_FIELDS);
    if (!field) return null;
    return isRef(field.value) ? field.value.id : null;
  };
  const isChainNode = (obj: TraceObj) => obj.kind === 'object' && !!fieldOf(obj, NEXT_FIELDS);
  const kidsOf = (obj: TraceObj): { l: number | null; r: number | null } => {
    const l = fieldOf(obj, ['left']);
    const r = fieldOf(obj, ['right']);
    return {
      l: l && isRef(l.value) ? l.value.id : null,
      r: r && isRef(r.value) ? r.value.id : null,
    };
  };
  const isTreeNode = (obj: TraceObj) =>
    obj.kind === 'object' && (!!fieldOf(obj, ['left']) || !!fieldOf(obj, ['right']));

  const localRefs: number[] = [];
  for (const frame of step.stack) {
    if (frame.thisRef && isRef(frame.thisRef)) localRefs.push(frame.thisRef.id);
    for (const variable of frame.vars) {
      if (variable.value.kind === 'ref') localRefs.push(variable.value.id);
    }
  }

  const pointed = new Set<number>();
  for (const obj of heap) {
    if (isChainNode(obj)) {
      const t = nextTarget(obj);
      if (t !== null) pointed.add(t);
    }
    if (isTreeNode(obj)) {
      const { l, r } = kidsOf(obj);
      if (l !== null) pointed.add(l);
      if (r !== null) pointed.add(r);
    }
  }

  /* ---------- vertical bands ---------- */

  const top = 104;
  const bottom = height - 34;
  let cursor = top;

  const nextBand = (h: number) => {
    const y = cursor;
    cursor += h;
    return y;
  };

  const chainHeads = heap
    .filter((o) => isChainNode(o) && (!pointed.has(o.id) || localRefs.includes(o.id)))
    .sort((a, b) => {
      const la = localRefs.includes(a.id) ? 0 : 1;
      const lb = localRefs.includes(b.id) ? 0 : 1;
      return la - lb || a.id - b.id;
    });

  const treeRoots = heap
    .filter((o) => isTreeNode(o) && (!pointed.has(o.id) || localRefs.includes(o.id)))
    .sort((a, b) => {
      const la = localRefs.includes(a.id) ? 0 : 1;
      const lb = localRefs.includes(b.id) ? 0 : 1;
      return la - lb || a.id - b.id;
    });

  const used = new Set<number>();
  const effectFor = (objId: number, index?: number) =>
    step.effects.find((e) => e.to.obj === objId && e.to.index === index);

  /* ---------- linked chains ---------- */

  for (const head of chainHeads) {
    if (used.has(head.id) || cursor + NODE + 46 > bottom) continue;

    const chain: number[] = [];
    let current: number | null = head.id;
    while (current !== null && byId.has(current) && !used.has(current) && chain.length < 6) {
      chain.push(current);
      used.add(current);
      const obj: TraceObj = byId.get(current)!;
      current = nextTarget(obj);
    }

    // keep room on the right for the trailing `null` tag
    const spacing = Math.min(NODE + 26, Math.max(NODE + 14, (areaW - 96) / Math.max(1, chain.length)));
    const bandY = nextBand(NODE + 44);
    const startX = left + NODE / 2 + 6;
    const cellY = bandY + 26 + NODE / 2;

    labels.push({ key: `g-${head.id}`, x: left, y: bandY + 6, text: `linked chain · head ${nodeLabel(head)}`, align: 'left', kind: 'group' });

    chain.forEach((id, i) => {
      const obj = byId.get(id)!;
      const x = startX + i * spacing;
      const prevX = i > 0 ? startX + (i - 1) * spacing : null;
      nodes.push({
        key: `n-${id}`,
        x,
        y: cellY,
        size: NODE,
        label: nodeLabel(obj),
        mark: effectFor(id) ? 'active' : 'idle',
        objId: id,
        title: `${obj.label} @${id}`,
      });
      if (prevX !== null) {
        edges.push({
          key: `e-${chain[i - 1]}-${id}`,
          from: `n-${chain[i - 1]}`,
          to: `n-${id}`,
          x1: prevX + NODE / 2,
          y1: cellY,
          x2: x - NODE / 2,
          y2: cellY,
          arrow: true,
        });
      }
    });

    const lastId = chain[chain.length - 1];
    const lastObj = byId.get(lastId)!;
    const lastX = startX + (chain.length - 1) * spacing;
    if (nextTarget(lastObj) === null) {
      labels.push({ key: `null-${lastId}`, x: lastX + NODE / 2 + 8, y: cellY, text: 'null', align: 'left', kind: 'null' });
    }
    const tail = nextTarget(lastObj);
    if (tail !== null && !chain.includes(tail)) {
      labels.push({ key: `more-${lastId}`, x: lastX + NODE / 2 + 8, y: cellY, text: `@${tail}`, align: 'left', kind: 'null' });
    }
  }

  /* ---------- binary trees ---------- */

  for (const root of treeRoots) {
    if (used.has(root.id) || cursor + NODE + 60 > bottom) continue;

    const placed: { id: number; depth: number; col: number }[] = [];
    let col = 0;
    const walk = (id: number | null, depth: number) => {
      if (id === null || !byId.has(id) || used.has(id) || placed.length > 12) return;
      used.add(id);
      const obj = byId.get(id)!;
      const { l, r } = kidsOf(obj);
      walk(l, depth + 1);
      placed.push({ id, depth, col: col++ });
      walk(r, depth + 1);
    };
    walk(root.id, 0);

    if (placed.length === 0) continue;

    const maxDepth = placed.reduce((m, p) => Math.max(m, p.depth), 0);
    const gapX = Math.min(NODE + 18, Math.max(NODE + 4, (areaW - 40) / Math.max(1, placed.length - 1)));
    const gapY = Math.min(84, Math.max(66, (bottom - cursor - 60) / Math.max(1, maxDepth + 1)));
    const bandY = nextBand(26 + (maxDepth + 1) * gapY + 20);
    const centerX = left + areaW / 2;

    labels.push({ key: `g-${root.id}`, x: left, y: bandY + 6, text: `tree · root ${nodeLabel(root)}`, align: 'left', kind: 'group' });

    const posOf = new Map<number, { x: number; y: number }>();
    placed.forEach((entry) => {
      const x = centerX + (entry.col - (placed.length - 1) / 2) * gapX;
      const y = bandY + 34 + entry.depth * gapY;
      posOf.set(entry.id, { x, y });
      const obj = byId.get(entry.id)!;
      nodes.push({
        key: `n-${entry.id}`,
        x,
        y,
        size: NODE,
        label: nodeLabel(obj),
        mark: effectFor(entry.id) ? 'active' : 'idle',
        objId: entry.id,
        title: `${obj.label} @${entry.id}`,
      });
    });

    placed.forEach((entry) => {
      const from = posOf.get(entry.id)!;
      const obj = byId.get(entry.id)!;
      const { l, r } = kidsOf(obj);
      for (const childId of [l, r]) {
        if (childId === null || !posOf.has(childId)) continue;
        const to = posOf.get(childId)!;
        edges.push({
          key: `e-${entry.id}-${childId}`,
          from: `n-${entry.id}`,
          to: `n-${childId}`,
          x1: from.x,
          y1: from.y + NODE / 2,
          x2: to.x,
          y2: to.y - NODE / 2,
          soft: true,
        });
      }
    });
  }

  /* ---------- arrays, arraylists, plain objects ---------- */

  for (const obj of heap) {
    if (used.has(obj.id) || cursor > bottom - 40) continue;
    if (isChainNode(obj) || isTreeNode(obj)) continue;

    if (obj.kind === 'array' || obj.kind === 'list') {
      // empty structures are noise (e.g. the empty String[] args)
      if (obj.cells.length === 0) {
        used.add(obj.id);
        continue;
      }
      // every cell gets its own tile: a long array wraps onto extra rows and
      // shrinks a little when the rows do not fit, instead of ending in a "+2"
      // that left the rest of the list unreadable
      const availW = Math.max(60, areaW - 12);
      const availH = Math.max(cellSize + cellGap, bottom - cursor - 40);
      let box = cellSize;
      let gapPx = cellGap;
      let perRow = 1;
      let rows = obj.cells.length;
      for (let candidate = cellSize; candidate >= 16; candidate -= 2) {
        const gap = candidate >= 28 ? cellGap : 7;
        const fits = Math.max(1, Math.floor((availW + gap) / (candidate + gap)));
        const needed = Math.ceil(obj.cells.length / fits);
        box = candidate;
        gapPx = gap;
        perRow = fits;
        rows = needed;
        if (needed * (candidate + gap) <= availH) break;
      }
      const rowH = box + gapPx;
      const showRefs = obj.cells.some((c) => c.kind === 'ref');
      const bandY = nextBand(24 + (rows - 1) * rowH + box + (showRefs ? 30 : 16));

      labels.push({
        key: `g-${obj.id}`,
        x: left,
        y: bandY + 6,
        text: `${obj.label} @${obj.id}${rows > 1 ? ` · ${obj.cells.length} items` : ''}`,
        align: 'left',
        kind: 'group',
      });

      obj.cells.forEach((cell, index) => {
        const row = Math.floor(index / perRow);
        const col = index % perRow;
        const x = left + box / 2 + col * rowH;
        const y = bandY + 24 + row * rowH + box / 2;
        const effect = effectFor(obj.id, index);
        nodes.push({
          key: `c-${obj.id}-${index}`,
          x,
          y,
          size: box,
          label: valText(cell),
          mark: effect ? 'active' : cell.kind === 'ref' ? 'path' : 'idle',
          objId: obj.id,
          index,
          prev: effect?.prev ? valText(effect.prev) : undefined,
          title: `${obj.label}[${index}]`,
        });
        // one straight rail per neighbouring pair: the sequence reads as a
        // single list without having to decode index numbers. A row break is
        // already a visible wrap, so it gets no rail across the gap
        if (col > 0) {
          edges.push({
            key: `rail-${obj.id}-${index}`,
            from: `c-${obj.id}-${index - 1}`,
            to: `c-${obj.id}-${index}`,
            x1: x - box / 2 - gapPx,
            y1: y,
            x2: x - box / 2,
            y2: y,
            soft: true,
            trimA: box / 2,
            trimB: box / 2,
          });
        }
      });

      if (showRefs) {
        labels.push({
          key: `refs-${obj.id}`,
          x: left,
          y: bandY + 24 + (rows - 1) * rowH + box + 8,
          text: 'holds references',
          align: 'left',
          kind: 'null',
        });
      }
      used.add(obj.id);
      continue;
    }

    // plain object card
    const fields = (obj.fields ?? []).slice(0, 6);
    const cardH = 34 + fields.length * 18 + 8;
    const bandY = nextBand(cardH + 14);
    const cardW = Math.min(232, areaW);
    cards.push({
      key: `card-${obj.id}`,
      x: left + cardW / 2,
      y: bandY + cardH / 2,
      w: cardW,
      h: cardH,
      title: obj.label,
      sub: `@${obj.id}`,
      rows: fields.map((field) => ({
        label: field.name,
        value: field.value.kind === 'ref' ? `@${field.value.id}` : valText(field.value),
        changed: !!effectFor(obj.id) && effectFor(obj.id)!.to.field === field.name,
      })),
    });
    used.add(obj.id);
  }

  /* ---------- a 2D grid: tie each row array to the slot that holds it ---------- */

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  for (const obj of heap) {
    if (obj.kind !== 'array' && obj.kind !== 'list') continue;
    if (obj.cells.length > 8) continue;
    obj.cells.forEach((cell, index) => {
      if (cell.kind !== 'ref') return;
      const child = byId.get(cell.id);
      if (!child || (child.kind !== 'array' && child.kind !== 'list') || child.cells.length === 0) return;
      const from = nodeByKey.get(`c-${obj.id}-${index}`);
      const to = nodeByKey.get(`c-${child.id}-0`);
      if (!from || !to) return;
      edges.push({
        key: `row-${obj.id}-${index}`,
        from: from.key,
        to: to.key,
        x1: from.x,
        y1: from.y + from.size / 2,
        x2: to.x,
        y2: to.y - to.size / 2,
        soft: true,
        trimA: from.size / 2,
        trimB: to.size / 2,
      });
    });
  }

  /* ---------- centre the whole drawing vertically ---------- */

  const usedHeight = cursor - top;
  const shift = Math.max(0, (bottom - top - usedHeight) / 2);
  if (shift > 2) {
    for (const node of nodes) node.y += shift;
    for (const edge of edges) {
      edge.y1 += shift;
      edge.y2 += shift;
    }
    for (const label of labels) label.y += shift;
    for (const card of cards) card.y += shift;
  }

  /* ---------- animated writes ---------- */

  step.effects.forEach((effect, index) => {
    const target = nodes.find((n) => n.objId === effect.to.obj && (effect.to.index === undefined || n.index === effect.to.index));
    if (!target) return;
    tokens.push({
      key: `token-${index}`,
      x1: stackW + 6,
      y1: 132,
      x2: target.x,
      y2: target.y,
      label: valText(effect.value),
    });
  });

  return { nodes, edges, frames, cards, labels, tokens };
}
