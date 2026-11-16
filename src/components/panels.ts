import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

/** Ask the 3D canvases to re-measure after the panel grid changes. */
export const syncCanvases = () => {
  setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
};

type ResizeOptions = {
  /** +1 when dragging right should widen the panel, -1 when it should narrow it */
  dir: 1 | -1;
  width: number;
  min: number;
  max: number;
  onWidth: (width: number) => void;
};

/** Drag a panel edge to resize it. */
export function startResize(event: ReactPointerEvent, { dir, width, min, max, onWidth }: ResizeOptions) {
  event.preventDefault();
  const startX = event.clientX;

  const move = (moveEvent: PointerEvent) => {
    const next = Math.round(Math.min(max, Math.max(min, width + dir * (moveEvent.clientX - startX))));
    onWidth(next);
    // the canvas fills the middle column, so its drawing buffer has to follow
    syncCanvases();
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    syncCanvases();
  };

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Inline custom properties consumed by the grid definitions. */
export const panelVars = (vars: Record<string, string>) => vars as CSSProperties;
