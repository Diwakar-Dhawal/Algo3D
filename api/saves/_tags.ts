/**
 * Tags on saved programs are free-form, so they are normalised on the way in:
 * lowercase, no punctuation, one tag per concept, at most eight. The same rules
 * run in the browser (`src/saves/tags.ts`) so what you type is what you get.
 */
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

export function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .slice(0, MAX_TAG_LEN);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
