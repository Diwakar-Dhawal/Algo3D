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

export type Save = {
  id: number;
  title: string;
  language: string;
  code: string;
  inputs: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

type Init = { method?: string; body?: unknown };

/** set by the Clerk bridge; every call carries the current session token */
let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: (() => Promise<string | null>) | null): void {
  tokenGetter = fn;
}

async function call<T>(path: string, init: Init = {}): Promise<T | null> {
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
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const authApi = {
  me: () => call<{ user: ApiUser | null; stats: ApiStats | null }>('/api/auth/me'),
  list: () => call<{ saves: Save[] }>('/api/saves'),
  create: (body: { title: string; language: string; code: string; inputs: string }) =>
    call<{ save: Save }>('/api/saves', { method: 'POST', body }),
  update: (id: number, patch: { title?: string; code?: string; inputs?: string; favorite?: boolean }) =>
    call<{ save: Save }>(`/api/saves/${id}`, { method: 'PATCH', body: patch }),
  remove: (id: number) => call<{ ok: boolean }>(`/api/saves/${id}`, { method: 'DELETE' }),
  record: (kind: 'run' | 'save' = 'run') => call<{ stats: ApiStats }>('/api/activity', { method: 'POST', body: { kind } }),
};

