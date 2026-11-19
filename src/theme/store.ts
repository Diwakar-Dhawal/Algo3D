import { useSyncExternalStore } from 'react';

/**
 * The canvas has its own renderer root, so React context does not reach the
 * sprites and materials inside it. This little store is plain JS, which lets
 * both the DOM tree and the 3D scene follow the same light/dark choice.
 */
export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();
let current: Theme = 'light';

export function getTheme(): Theme {
  return current;
}

export function setGlobalTheme(next: Theme) {
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useStageTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme);
}
