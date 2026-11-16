import type { Mark } from './types';

/** 1-based line number of the first line containing `needle`, or 0 when absent. */
export function lineOf(java: string, needle: string): number {
  const index = java.split('\n').findIndex((line) => line.includes(needle));
  return index < 0 ? 0 : index + 1;
}

export function lineCount(java: string): number {
  return java.split('\n').length;
}

/** Pull numbers out of free text; handy for "5, 3, 8" style inputs. */
export function parseNums(input: string, max = 14): number[] {
  return input
    .split(/[^0-9.-]+/)
    .map((piece) => Number(piece))
    .filter((n) => Number.isFinite(n))
    .slice(0, max);
}

export function parseGrid(raw: string, maxRows = 6, maxCols = 8): number[][] {
  const rows = raw
    .split('\n')
    .map((line) => parseNums(line, maxCols))
    .filter((row) => row.length > 0)
    .slice(0, maxRows);
  if (rows.length === 0) return [[0]];
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? 0));
}

/** Scale a scene group down so wide/large structures always stay in frame. */
export function fitScale(width: number, height: number, maxW = 13.5, maxH = 7.6): number {
  const s = Math.min(maxW / Math.max(width, 0.001), maxH / Math.max(height, 0.001));
  return Math.min(1.35, Math.max(0.3, s));
}

export function marksFor<T>(items: T[], value: Mark = 'idle'): Mark[] {
  return items.map(() => value);
}
