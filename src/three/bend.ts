/**
 * Geometry for the link that carries a wrapped row of cells onto the next one.
 * Kept free of three/react so it can be tested without a WebGL context: the
 * component turns these legs into cylinders.
 *
 * World y points down, so a cell's bottom edge is its centre minus half a box.
 */

export type Point = [number, number, number];
export type Leg = { from: Point; to: Point };

/**
 * Three legs — down out of `a`, across the gap, down into `b` — starting on the
 * bottom edge of `a` and ending on the top edge of `b`.
 */
export function bendLegs(a: Point, b: Point, dropA: number, dropB: number): [Leg, Leg, Leg] {
  const start: Point = [a[0], a[1] - dropA, a[2]];
  const end: Point = [b[0], b[1] + dropB, b[2]];
  const midY = (start[1] + end[1]) / 2;
  const cornerA: Point = [start[0], midY, start[2]];
  const cornerB: Point = [end[0], midY, end[2]];
  return [
    { from: start, to: cornerA },
    { from: cornerA, to: cornerB },
    { from: cornerB, to: end },
  ];
}
