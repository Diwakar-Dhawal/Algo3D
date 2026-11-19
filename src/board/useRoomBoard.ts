/**
 * Room whiteboard sync.
 *
 * Same transport as the rest of a room — plain HTTPS polling — so there is no
 * extra service to run. Each push merges with the newest server copy first and
 * retries on a version clash, which is what keeps two people drawing at the
 * same time from wiping each other's strokes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { roomsApi } from '../rooms/api';
import { mergeElements, type BoardElement } from './elements';

export type BoardStatus = 'loading' | 'live' | 'saving' | 'offline';

const POLL_MS = 2200;
const POLL_HIDDEN_MS = 6000;
const PUSH_MS = 650;

export function useRoomBoard(roomId: number | null, canDraw: boolean) {
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BoardStatus>('loading');

  const versionRef = useRef(0);
  const localRef = useRef<BoardElement[]>([]);
  const readyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const againRef = useRef(false);

  useEffect(() => {
    versionRef.current = 0;
    readyRef.current = false;
    localRef.current = [];
    setElements([]);
    setVersion(0);
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
        // `unchanged` polls carry the version but not the drawing
        if (!board.unchanged && board.version > versionRef.current) {
          versionRef.current = board.version;
          setVersion(board.version);
          setElements(board.elements as BoardElement[]);
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
        setVersion(saved.version);
        if (merged.length !== local.length) setElements(merged);
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
  }, [roomId, canDraw]);

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

  return { elements, version, ready, status, push };
}
