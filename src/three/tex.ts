import * as THREE from 'three';

/**
 * Renders text into a canvas texture so numbers can live directly on 3D blocks
 * (no web-font loading, always crisp, cached per string).
 */
const cache = new Map<string, THREE.CanvasTexture>();

export function textTexture(text: string, color = '#eaf6ff'): THREE.CanvasTexture {
  const key = `${text}|${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  let font = size * 0.62;
  ctx.font = `700 ${font}px ui-monospace, "SF Mono", Menlo, monospace`;
  const width = ctx.measureText(text).width;
  const max = size * 0.84;
  if (width > max) font *= max / width;

  ctx.clearRect(0, 0, size, size);
  ctx.font = `700 ${font}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2 + font * 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}
