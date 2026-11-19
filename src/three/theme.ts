import type { Theme } from '../theme/store';

/** Stage furniture (backdrop, grid, lights, shadow) per theme. Blocks keep
 *  their paper fills in both modes so the values on them stay readable. */
export const STAGE = {
  light: {
    paper: '#f7f3ea',
    grid: '#eae1cd',
    gridSection: '#ddd0b6',
    sky: '#ffffff',
    ground: '#e6dcc8',
    shadow: '#8a7a5c',
    shadowOpacity: 0.22,
    ambient: 0.95,
    hemi: 0.7,
    key: 1.35,
  },
  dark: {
    paper: '#15120e',
    grid: '#2c261e',
    gridSection: '#3b3327',
    sky: '#fff6e6',
    ground: '#3a3025',
    shadow: '#000000',
    shadowOpacity: 0.36,
    ambient: 0.72,
    hemi: 0.5,
    key: 1.15,
  },
} as const;

export function stageColors(theme: Theme) {
  return STAGE[theme];
}

function hexToHsl(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let raw = match[1];
  if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, Math.min(1, s), l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Captions and pointers are authored as ink on warm paper. At night the dark
 * ones (navy, olive, brown) would disappear, so lift their lightness while
 * keeping enough hue to tell e.g. the orange frontier from the cyan visited.
 */
export function readable(hex: string, theme: Theme): string {
  if (theme === 'light') return hex;
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const [h, s, l] = hsl;
  if (l >= 0.58) return hex;
  return hslToHex(h, Math.min(s, 0.45), 0.74);
}
