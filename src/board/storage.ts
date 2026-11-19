/**
 * The private whiteboard lives in this browser, one entry per account. The save
 * dialogs read the same entry so a drawing can travel with a saved program.
 */
import type { BoardElement } from './elements';

export function personalBoardKey(userId: number | null): string {
  return `algo3d:board:v1:${userId ? userId : 'guest'}`;
}

export function readPersonalBoard(userId: number | null): BoardElement[] {
  try {
    const raw = localStorage.getItem(personalBoardKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BoardElement[]) : [];
  } catch {
    return [];
  }
}

export function writePersonalBoard(userId: number | null, elements: readonly BoardElement[]): void {
  try {
    localStorage.setItem(personalBoardKey(userId), JSON.stringify(elements));
  } catch {
    /* quota exceeded or storage blocked: the board still works this session */
  }
}
