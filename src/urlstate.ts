/**
 * The address bar is the share surface: `?mode=code&lang=java&sample=bubble&step=12`.
 * Everything here is additive — a param we do not own (a room invite's `?room=`)
 * is preserved untouched, and writes never push a history entry, so Back still
 * means "leave the page" rather than "undo a step".
 */

export type UrlState = {
  mode?: string;
  lang?: string;
  sample?: string;
  topic?: string;
  step?: string;
};

const OWNED = ['mode', 'lang', 'sample', 'topic', 'step'] as const;

export function readUrl(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const state: UrlState = {};
  for (const key of OWNED) {
    const value = params.get(key);
    if (value !== null && value !== '') state[key] = value;
  }
  return state;
}

/** the href for this page with `patch` merged in, for sharing or copying */
export function hrefFor(patch: UrlState): string {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (!(OWNED as readonly string[]).includes(key)) continue;
    if (value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

/**
 * Keep the address bar current. In-page state (language, sample, step) replaces
 * the entry; a move between sections pushes one, so Back walks the sections you
 * visited instead of leaving the site.
 */
export function writeUrl(patch: UrlState, options: { push?: boolean } = {}): void {
  try {
    const next = hrefFor(patch);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    if (options.push) window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
  } catch {
    // history blocked in a sandboxed frame: links still work, they just do not update
  }
}

/** Back/Forward inside the app: the caller decides what a state change means */
export function onUrlChange(handler: (state: UrlState) => void): () => void {
  const listener = () => handler(readUrl());
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}
