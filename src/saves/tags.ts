/**
 * Tags on saved programs. The rules match `api/saves/_tags.ts` so a tag typed
 * here is stored exactly as shown, and the presets are the topics and shapes
 * people actually study.
 */
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

/** the common ones, one click away; anything else can be typed */
export const PRESET_TAGS = [
  'arrays',
  'sorting',
  'matrix',
  'stack',
  'queue',
  'linked-list',
  'tree',
  'graph',
  'recursion',
  'search',
  'dynamic-programming',
  'strings',
];

/** normalises one tag, or returns '' when nothing usable is left */
export function normaliseTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, MAX_TAG_LEN);
}

/** adds one tag to a list, ignoring blanks, duplicates and overflow */
export function addTag(list: readonly string[], raw: string): string[] {
  const tag = normaliseTag(raw);
  if (!tag || list.includes(tag) || list.length >= MAX_TAGS) return [...list];
  return [...list, tag];
}

export function toggleTag(list: readonly string[], tag: string): string[] {
  if (list.includes(tag)) return list.filter((item) => item !== tag);
  return list.length >= MAX_TAGS ? [...list] : [...list, tag];
}

/** every tag in use, with how many programs carry it, busiest first */
export function tagCounts(saves: readonly { tags?: string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const save of saves) {
    for (const tag of save.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
