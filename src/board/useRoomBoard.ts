/**
 * Room whiteboard sync.
 *
 * Same transport as the rest of a room — plain HTTPS polling — so there is no
 * extra service to run. Each push merges with the newest server copy first and
 * retries on a version clash, which is what keeps two people drawing at the
 * same time from wiping each other's strokes.
 *
 * The scene and its version travel as one value. Handing the surface a newer
 * version next to an older element list is what made an owner's strokes vanish
 * a moment after they paused: the save response bumped the version, the shared
 * board re-rendered, and the surface re-applied the scene from the previous
 * poll. Nothing here exposes a version that was not read with its own elements,
 * and identical content keeps the array the surface is already looking at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { roomsApi } from '../rooms/api';
import { mergeElements, boardSignature, type BoardElement } from './elements';

export type BoardStatus = 'loading' | 'live' | 'saving' | 'offline';

/** how long a joiner waits before seeing a stroke the editor just paused on */
const POLL_MS = 1000;
const POLL_HIDDEN_MS = 6000;
/** a paused stroke is saved after this, so a short breath is enough to sync */
const PUSH_MS = 300;

type Scene = { elements: BoardElement[]; version: number };

const EMPTY: Scene = { elements: [], version: 0 };

export function useRoomBoard(roomId: number | null, canDraw: boolean) {
  const [scene, setScene] = useState<Scene>(EMPTY);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BoardStatus>('loading');

  /** the newest board the server told us about, used as the push base */
  const versionRef = useRef(0);
  /** the scene we last published, so identical polls keep their reference */
  const sceneRef = useRef<Scene>(EMPTY);
  const localRef = useRef<BoardElement[]>([]);
  const readyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const againRef = useRef(false);

  /**
   * Publish a scene and the version it was read at, together. Identical content
   * is dropped: a poll that changed nothing must not recreate the elements array
   * the Excalidraw surface holds.
   */
  const publish = useCallback((elements: BoardElement[], version: number) => {
    if (boardSignature(elements) === boardSignature(sceneRef.current.elements)) return;
    sceneRef.current = { elements, version };
    setScene(sceneRef.current);
  }, []);

  useEffect(() => {
    versionRef.current = 0;
    sceneRef.current = EMPTY;
    readyRef.current = false;
    localRef.current = [];
    setScene(EMPTY);
    setReady(false);
    setStatus('loading');
    if (!roomId) return;

    let live = true;
    let timer: number | undefined;

    const tick = async () => {
      const result = await roomsApi.board(roomId, versionRef.current || undefined);
      if (!live) return;
      const board = result.data?.board;
      if (result.ok && board) {
        // a current poll answers `unchanged: true` with no elements at all; a
        // newer board carries the whole drawing, and only then does the version
        // and the scene move forward together
        if (!board.unchanged && board.version > versionRef.current) {
          versionRef.current = board.version;
          publish(board.elements as BoardElement[], board.version);
        }
        if (!readyRef.current) {
          readyRef.current = true;
          setReady(true);
        }
        setStatus(savingRef.current ? 'saving' : 'live');
      } else {
        setStatus('offline');
      }
      timer = window.setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };

    void tick();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [roomId, publish]);

  const flush = useCallback(async () => {
    if (!roomId || !canDraw) return;
    if (savingRef.current) {
      againRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus('saving');

    const local = localRef.current;
    let base = versionRef.current;
    let savedOk = false;

    for (let attempt = 0; attempt < 3 && !savedOk; attempt++) {
      let merged = local;
      // take whatever landed while we were drawing, then save the union
      const latest = await roomsApi.board(roomId, base || undefined);
      if (latest.ok && latest.data?.board && !latest.data.board.unchanged) {
        merged = mergeElements(local, latest.data.board.elements as BoardElement[]);
        base = latest.data.board.version;
      }

      const result = await roomsApi.pushBoard(roomId, { elements: merged, baseVersion: base });
      const saved = result.data?.board;
      if (result.ok && saved) {
        versionRef.current = saved.version;
        // the surface already shows this; publishing keeps the shared reference
        // in step so the next poll cannot hand back the drawing it replaced
        publish(merged, saved.version);
        setStatus('live');
        savedOk = true;
      } else if (result.status === 409 && saved) {
        // someone else saved first: adopt their version and try the merge again
        base = saved.version;
        versionRef.current = saved.version;
      } else {
        setStatus('offline');
        break;
      }
    }

    savingRef.current = false;
    if (againRef.current) {
      againRef.current = false;
      void flush();
    }
  }, [roomId, canDraw, publish]);

  const push = useCallback(
    (next: readonly BoardElement[]) => {
      localRef.current = next as BoardElement[];
      if (!canDraw) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), PUSH_MS);
    },
    [canDraw, flush]
  );

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return { elements: scene.elements, version: scene.version, ready, status, push };
}
