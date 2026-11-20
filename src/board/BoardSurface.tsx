/**
 * The Excalidraw surface. Kept in its own module so Vite can lazy-load the
 * editor (and its stylesheet) only when someone opens a whiteboard.
 *
 * A shared board polls on a fixed cadence. The parent must not hand the surface
 * a fresh array on every poll when nothing changed, and the surface must not
 * re-apply the scene from `remote` on every heartbeat either. This module
 * gates every remote rewrite on a content signature, and it tracks the last
 * applied scene so unchanged polls cannot nudge it through a new-array reference.
 */
import { useEffect, useRef } from 'react';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useTheme } from '../theme/ThemeContext';
import { boardSignature, type BoardElement } from './elements';

type Props = {
  /** scene present at mount; later remote changes arrive through `remote` */
  initial: BoardElement[];
  remote?: BoardElement[];
  /** bumps whenever the server has newer content */
  remoteVersion?: number;
  readOnly: boolean;
  onChange: (elements: BoardElement[]) => void;
};

export default function BoardSurface({ initial, remote, remoteVersion, readOnly, onChange }: Props) {
  const { theme } = useTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastRef = useRef(boardSignature(initial));
  const applyingRef = useRef(false);

  // a remote scene replaces the local one without touching undo history,
  // but only when the remote content actually differs from what we last applied
  useEffect(() => {
    if (!remote || !remoteVersion) return;
    const api = apiRef.current;
    if (!api) return;
    const signature = boardSignature(remote);
    if (signature === lastRef.current) return;
    lastRef.current = signature;
    applyingRef.current = true;
    api.updateScene({ elements: remote as never, captureUpdate: CaptureUpdateAction.NEVER });
    const timer = window.setTimeout(() => {
      applyingRef.current = false;
    }, 350);
    return () => window.clearTimeout(timer);
  }, [remote, remoteVersion]);

  return (
    <Excalidraw
      theme={theme}
      viewModeEnabled={readOnly}
      initialData={{ elements: initial as never, scrollToContent: true }}
      excalidrawAPI={(api) => {
        apiRef.current = api;
      }}
      onChange={(elements) => {
        const next = elements as unknown as BoardElement[];
        if (applyingRef.current) {
          lastRef.current = boardSignature(next);
          return;
        }
        const signature = boardSignature(next);
        if (signature === lastRef.current) return;
        lastRef.current = signature;
        onChange(next);
      }}
      UIOptions={{
        // images are files, and only elements travel to the server
        tools: { image: false },
        canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
      }}
    />
  );
}
