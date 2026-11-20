/**
 * The Excalidraw surface. Kept in its own module so Vite can lazy-load the
 * editor (and its stylesheet) only when someone opens a whiteboard.
 *
 * A shared board polls on a fixed cadence. The parent must not hand the surface
 * a fresh array on every poll when nothing changed, and the surface must not
 * re-apply the scene from `remote` on every heartbeat either. This module
 * gates every remote rewrite on a content signature, and it merges the incoming
 * scene into the one on screen instead of replacing it: a poll may add, move or
 * delete shapes, but it can never take away a stroke that has not been saved.
 */
import { useEffect, useRef } from 'react';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useTheme } from '../theme/ThemeContext';
import { boardSignature, mergeElements, type BoardElement } from './elements';

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
  /** identity of the scene this surface is showing; every write updates it */
  const lastRef = useRef(boardSignature(initial));

  // newest-wins per element, applied without touching undo history: our own
  // unsaved strokes are kept, and a deletion still travels because it arrives
  // as the same element with a higher version and `isDeleted` set
  useEffect(() => {
    if (!remote || !remoteVersion) return;
    const api = apiRef.current;
    if (!api) return;
    const onScreen = api.getSceneElementsIncludingDeleted() as unknown as BoardElement[];
    const merged = mergeElements(onScreen, remote);
    const signature = boardSignature(merged);
    if (signature === lastRef.current) return;
    lastRef.current = signature;
    api.updateScene({ elements: merged as never, captureUpdate: CaptureUpdateAction.NEVER });
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
        const signature = boardSignature(next);
        // an echo of what we just applied, or of our own last edit: nothing new
        // to send. A stroke drawn straight after a remote apply still differs,
        // so it is not swallowed the way a timed “ignore” window swallowed it.
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
