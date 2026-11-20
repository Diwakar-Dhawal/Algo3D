/** Typed client for the /api endpoints. Every call fails soft: a null result means
 *  "not available right now", so the UI can stay anonymous instead of crashing. */

export type ApiUser = {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: string;
};

export type ApiStats = {
  saves: number;
  favorites: number;
  streak: number;
  runsToday: number;
  lastRunDay: string | null;
};

import type { BoardElement } from '../board/elements';

export type Save = {
  id: number;
  title: string;
  language: string;
  code: string;
  inputs: string;
  description: string;
  favorite: boolean;
  /** the whiteboard saved with this program, or null for code only */
  board: BoardElement[] | null;
  /** free-form tags for filtering ("arrays", "my-revision") */
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type Init = { method?: string; body?: unknown };

/** set by the Clerk bridge; every call carries the current session token */
let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: (() => Promise<string | null>) | null): void {
  tokenGetter = fn;
}

/** the current session token, for callers that cannot use apiRequest (the room socket) */
export async function sessionToken(): Promise<string | null> {
  return tokenGetter ? tokenGetter() : null;
}

export type ApiResult<T> = { status: number; ok: boolean; data: T | null };

/** like call(), but keeps the status and error body so callers can react to a 409 */
export async function apiRequest<T>(path: string, init: Init = {}): Promise<ApiResult<T>> {
  try {
    const token = tokenGetter ? await tokenGetter() : null;
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }
    return { status: response.status, ok: response.ok, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}

async function call<T>(path: string, init: Init = {}): Promise<T | null> {
  const result = await apiRequest<T>(path, init);
  return result.ok ? result.data : null;
}

/** today in this browser's timezone, so a streak follows the user's calendar */
const localDay = (): string => new Date().toLocaleDateString('en-CA');

export const authApi = {
  me: () => call<{ user: ApiUser | null; stats: ApiStats | null }>(`/api/auth/me?day=${localDay()}`),
  list: () => call<{ saves: Save[] }>('/api/saves'),
  create: (body: {
    title: string;
    language: string;
    code: string;
    inputs: string;
    description?: string;
    favorite?: boolean;
    board?: BoardElement[];
    tags?: string[];
  }) => call<{ save: Save }>('/api/saves', { method: 'POST', body }),
  update: (
    id: number,
    patch: {
      title?: string;
      description?: string;
      code?: string;
      inputs?: string;
      favorite?: boolean;
      tags?: string[];
    }
  ) =>
    call<{ save: Save }>(`/api/saves/${id}`, { method: 'PATCH', body: patch }),
  remove: (id: number) => call<{ ok: boolean }>(`/api/saves/${id}`, { method: 'DELETE' }),
  record: (kind: 'run' | 'save' = 'run') =>
    call<{ stats: ApiStats }>('/api/activity', { method: 'POST', body: { kind, day: localDay() } }),
};

