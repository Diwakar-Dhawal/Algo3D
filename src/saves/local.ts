import type { Save } from '../auth/api';

/**
 * Programs a signed-out visitor saves. They live in this browser only, which is
 * why every screen that shows them says so — "saved" must never quietly mean
 * "on this one laptop".
 */
const KEY = 'algo3d:saves.v1';
const LIMIT = 20;

function read(): Save[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // programs saved before tags existed come back with an empty list, not
    // `undefined`, so every screen can read `save.tags` without a guard
    return (parsed as Save[])
      .filter((save) => typeof save?.id === 'number' && typeof save?.code === 'string')
      .map((save) => ({ ...save, tags: Array.isArray(save.tags) ? save.tags : [] }));
  } catch {
    return [];
  }
}

function write(saves: Save[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(saves.slice(0, LIMIT)));
    return true;
  } catch {
    // quota or blocked storage: the caller tells the user it did not stick
    return false;
  }
}

/** server rows have positive ids, so a negative id marks a device-only save */
export function isLocalSave(save: { id: number }): boolean {
  return save.id < 0;
}

export function localSaves(): Save[] {
  return read();
}

export function addLocalSave(entry: {
  title: string;
  description: string;
  language: string;
  code: string;
  inputs: string;
  favorite: boolean;
  tags?: string[];
}): Save | null {
  const now = new Date().toISOString();
  const save: Save = {
    id: -Date.now(),
    title: entry.title,
    description: entry.description,
    language: entry.language,
    code: entry.code,
    inputs: entry.inputs,
    favorite: entry.favorite,
    board: null,
    tags: entry.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return write([save, ...read()]) ? save : null;
}

export function updateLocalSave(
  id: number,
  patch: Partial<Pick<Save, 'title' | 'description' | 'favorite' | 'tags'>>
): Save | null {
  const saves = read();
  const at = saves.findIndex((save) => save.id === id);
  if (at < 0) return null;
  const next: Save = { ...saves[at], ...patch, updatedAt: new Date().toISOString() };
  saves[at] = next;
  return write(saves) ? next : null;
}

export function removeLocalSave(id: number): boolean {
  return write(read().filter((save) => save.id !== id));
}
