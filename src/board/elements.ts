/**
 * Whiteboard element helpers.
 *
 * The board itself is drawn by Excalidraw (lazy-loaded in `BoardSurface`), and
 * only its elements are stored — personal boards in localStorage, room boards
 * in Postgres. Deleted elements stay in the list with `isDeleted: true`, so a
 * merge can remove things as well as add them.
 */
export type BoardElement = {
  id?: string;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  [key: string]: unknown;
};

/**
 * Newest wins per element: Excalidraw bumps `version` on every edit, so a merge
 * keeps the most recent copy of each shape and still carries deletions across.
 */
export function mergeElements(
  local: readonly BoardElement[],
  remote: readonly BoardElement[]
): BoardElement[] {
  const byId = new Map<string, BoardElement>();
  for (const element of remote) {
    if (element.id) byId.set(element.id, element);
  }
  for (const element of local) {
    if (!element.id) continue;
    const other = byId.get(element.id);
    if (!other) {
      byId.set(element.id, element);
      continue;
    }
    const mine = Number(element.version) || 0;
    const theirs = Number(other.version) || 0;
    const keepLocal =
      mine !== theirs ? mine > theirs : (Number(element.versionNonce) || 0) >= (Number(other.versionNonce) || 0);
    byId.set(element.id, keepLocal ? element : other);
  }
  return Array.from(byId.values());
}

/** cheap identity of a scene, used to ignore echoes of our own updates */
export function boardSignature(elements: readonly BoardElement[]): string {
  let out = '';
  for (const element of elements) {
    out += `${element.id ?? '?'}:${Number(element.version) || 0}:${element.isDeleted ? 1 : 0}|`;
  }
  return out;
}
