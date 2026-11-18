/**
 * Stable block identity. Kept free of react/three so it can be unit tested.
 *
 * A block's id decides whether the stage animates it as the same box (glide,
 * relabel) or as a brand new one (fade in). Ids also key the hand-placed
 * position of every block, so an unstable id would snap a dragged box back to
 * its layout slot.
 */

export type IdEntry = { values: (string | number)[]; ids: string[] };
export type IdStore = { current: Map<string, IdEntry> };

let seq = 0;

/** forget the counter — used by tests that compare ids across cases */
export const resetIdSeq = () => {
  seq = 0;
};

export function stableIds(store: IdStore, group: string, values: (string | number)[]): string[] {
  const prev = store.current.get(group);
  if (!prev) {
    const ids = values.map(() => `t${++seq}`);
    store.current.set(group, { values: [...values], ids });
    return ids;
  }

  const ids: string[] = new Array(values.length).fill('');
  const taken = new Set<number>();
  // nothing was added or removed, so a leftover slot is an in-place edit
  const steadyShape = prev.values.length === values.length;

  // same slot, same value → same block
  values.forEach((value, i) => {
    if (prev.values[i] === value) {
      ids[i] = prev.ids[i];
      taken.add(i);
    }
  });

  // otherwise the nearest previous block holding that value (swaps, shifts)
  values.forEach((value, i) => {
    if (ids[i]) return;
    let best = -1;
    let bestDistance = Infinity;
    prev.values.forEach((oldValue, j) => {
      if (taken.has(j) || oldValue !== value) return;
      const distance = Math.abs(i - j);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    });
    if (best >= 0) {
      ids[i] = prev.ids[best];
      taken.add(best);
    } else if (steadyShape && prev.ids[i] && !taken.has(i)) {
      // the value at this slot was overwritten: keep the block, just relabel it.
      // A new id here would fade the old box out and drop a fresh one in —
      // which reads as a delete + insert for a plain write.
      ids[i] = prev.ids[i];
      taken.add(i);
    } else {
      ids[i] = `t${++seq}`;
    }
  });

  store.current.set(group, { values: [...values], ids: [...ids] });
  return ids;
}
