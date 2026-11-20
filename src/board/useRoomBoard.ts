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
import { onRoomEvent } from '../rooms/socket';
import { mergeElements, boardSignature, type BoardElement } from './elements';

export type BoardStatus = 'loading' | 'live' | 'saving' | 'offline';

/** how long a joiner waits before seeing a stroke the editor just paused on */
const POLL_MS = 1000;
const POLL_HIDDEN_MS = 6000;
/** a paused stroke is saved after this, so a short breath is enough to sync */
const PUSH_MS = 300;
/** a save that never reached the server is tried again this soon */
const RETRY_MS = 2500;
/** give up after this many unattended retries; the next stroke tries again */
const MAX_RETRIES = 4;

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
  const retryRef = useRef<number | undefined>(undefined);
  const retriesRef = useRef(0);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  /** reads the board right away when the socket says it changed */
  const nudgeRef = useRef<() => void>(() => {});

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
    retriesRef.current = 0;
    if (retryRef.current) window.clearTimeout(retryRef.current);
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

    // the socket says when a stroke landed; reading now rather than on the next
    // poll is what makes the other tab's drawing appear as it happens
    nudgeRef.current = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(tick, 30);
    };

    void tick();
    return () => {
      live = false;
      nudgeRef.current = () => {};
      if (timer) window.clearTimeout(timer);
    };
  }, [roomId, publish]);

  useEffect(() => {
    if (!roomId) return;
    return onRoomEvent((event) => {
      if (event.type === 'board') nudgeRef.current();
    });
  }, [roomId]);

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
    /** the server refused the drawing itself (too big, wrong role): retrying will not help */
    let rejected = false;
    /** a refusal carries the board that beat us, so the retry sends its union */
    let carry: BoardElement[] | null = null;

    for (let attempt = 0; attempt < 3 && !savedOk; attempt++) {
      let merged = carry ?? local;
      // catch up on whatever landed since our version before saving on top of
      // it. A clash (`unchanged` with no elements) means the server already has
      // what we read, so the local scene is the whole picture again.
      const latest = await roomsApi.board(roomId, base || undefined);
      if (latest.ok && latest.data?.board) {
        if (!latest.data.board.unchanged) {
          merged = mergeElements(merged, latest.data.board.elements as BoardElement[]);
          base = latest.data.board.version;
        }
      } else if (latest.status !== 0 && latest.status < 500) {
        rejected = true;
        break;
      }

      const result = await roomsApi.pushBoard(roomId, { elements: merged, baseVersion: base });
      const saved = result.data?.board;
      if (result.ok && saved) {
        versionRef.current = saved.version;
        // the server merged our strokes with whatever landed since the read, so
        // its copy is the union — publishing it also picks up an element that
        // arrived during the push
        publish(saved.elements as BoardElement[], saved.version);
        setStatus('live');
        savedOk = true;
      } else if (result.status === 409 && saved) {
        // someone else saved first: adopt their version and their board, then
        // send the union. Keeping only the version and letting the next read
        // answer `unchanged` is what used to save our stale drawing over theirs.
        base = saved.version;
        versionRef.current = saved.version;
        carry = mergeElements(merged, saved.elements as BoardElement[]);
      } else {
        rejected = result.status >= 400 && result.status < 500 && result.status !== 409;
        setStatus(result.status === 0 || result.status >= 500 ? 'offline' : 'live');
        break;
      }
    }

    savingRef.current = false;
    if (savedOk) {
      retriesRef.current = 0;
    } else if (!rejected && !againRef.current && retriesRef.current < MAX_RETRIES) {
      // a dropped connection must not cost the drawing: the same buffer is
      // tried again shortly, because no newer stroke will trigger a push
      retriesRef.current += 1;
      retryRef.current = window.setTimeout(() => void flush(), RETRY_MS);
    }
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
      if (retryRef.current) window.clearTimeout(retryRef.current);
    },
    []
  );

  return { elements: scene.elements, version: scene.version, ready, status, push };
}
