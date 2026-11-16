/**
 * Pure motion planning for the stage: decides, for every block, where it comes
 * from, whether it arcs past a neighbour, and which blocks just left.
 * Kept free of three/react so it can be tested directly.
 */

export type Pos = [number, number, number];
export type Entry = { id: string; pos: Pos };

export type MotionPlan = {
  from: Pos;
  /** true when this block trades places with a neighbour → draw an arc */
  arc: boolean;
  entering: boolean;
};

export type Planned = {
  motions: Map<string, MotionPlan>;
  removed: Entry[];
};

const EPS = 0.0001;

export const samePos = (a: Pos, b: Pos) =>
  Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;

export function planMotions(prev: Entry[], next: Entry[], spawn: Pos): Planned {
  const prevById = new Map(prev.map((entry) => [entry.id, entry.pos]));
  const nextById = new Map(next.map((entry) => [entry.id, entry.pos]));
  const occupant = (pos: Pos, skip: string) =>
    prev.find((entry) => entry.id !== skip && samePos(entry.pos, pos))?.id ?? null;

  const motions = new Map<string, MotionPlan>();

  for (const tile of next) {
    const before = prevById.get(tile.id);

    if (!before) {
      motions.set(tile.id, {
        from: [tile.pos[0] + spawn[0], tile.pos[1] + spawn[1], tile.pos[2] + spawn[2]],
        arc: false,
        entering: true,
      });
      continue;
    }

    let arc = false;
    if (!samePos(before, tile.pos)) {
      // a partner is a block that used to stand where this one is going and is
      // now going where this one stood → the two cross, so they arc past
      const partner = occupant(tile.pos, tile.id);
      const partnerNow = partner ? nextById.get(partner) : undefined;
      arc = !!partner && !!partnerNow && samePos(partnerNow, before);
    }

    motions.set(tile.id, { from: before, arc, entering: false });
  }

  return { motions, removed: prev.filter((entry) => !nextById.has(entry.id)) };
}
