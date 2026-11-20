/**
 * Whiteboard mode.
 *
 * Alone it is a private sketchpad kept in this browser. Inside a room the same
 * canvas becomes the room's shared board: editors and the owner draw, viewers
 * watch in Excalidraw's read-only view. Everything is server-enforced through
 * the `editBoard` capability, so a viewer cannot draw even with a crafted API
 * request.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useRooms } from '../rooms/RoomContext';
import { can, roleLabel } from '../rooms/roles';
import { mergeElements, type BoardElement } from './elements';
import { personalBoardKey, readPersonalBoard, writePersonalBoard } from './storage';
import { useRoomBoard } from './useRoomBoard';

const BoardSurface = lazy(() => import('./BoardSurface'));

export function Whiteboard() {
  const { user } = useAuth();
  const { active } = useRooms();

  const roomId = active?.room.id ?? null;
  const role = active?.room.role ?? null;
  const canDraw = roomId ? can(role, 'editBoard') : true;
  const board = useRoomBoard(roomId, canDraw);

  const userId = user?.id ?? null;
  const storageKey = personalBoardKey(userId);
  const [personal, setPersonal] = useState<BoardElement[]>(() => readPersonalBoard(userId));
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const personalRef = useRef<BoardElement[]>(personal);
  personalRef.current = personal;
  const userRef = useRef<number | null>(userId);
  userRef.current = userId;

  // signing in or out swaps the private board; the room board is unaffected
  useEffect(() => {
    if (!roomId) setPersonal(readPersonalBoard(userId));
  }, [roomId, userId]);

  // a sketch started before signing in should not vanish when the account board
  // (which is still empty) takes over
  useEffect(() => {
    if (!userId || readPersonalBoard(userId).length) return;
    const guest = readPersonalBoard(null);
    if (!guest.length) return;
    writePersonalBoard(userId, guest);
    try {
      localStorage.removeItem(personalBoardKey(null));
    } catch {
      /* blocked storage: the copy above is what matters */
    }
    if (!roomId) setPersonal(guest);
  }, [userId, roomId]);

  // a pending debounce is flushed on the way out, so saving right after a
  // stroke (or switching tabs) still captures the drawing
  useEffect(
    () => () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        writePersonalBoard(userRef.current, personalRef.current);
      }
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    []
  );


  const change = useCallback(
    (elements: BoardElement[]) => {
      if (roomId) {
        board.push(elements);
        return;
      }
      setPersonal(elements);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => writePersonalBoard(userId, elements), 400);
    },
    [roomId, board, userId]
  );

  const waiting = roomId !== null && !board.ready;
  const status: string = roomId ? (canDraw ? board.status : 'view only') : 'saved in this browser';

  // For a shared board, `initial` is the scene at mount and `remote` only ever
  // carries a genuinely newer drawing. The mount scene is seeded once: swapping
  // it later re-renders the surface without changing what it shows.
  const [roomInitial, setRoomInitial] = useState<BoardElement[]>([]);
  useEffect(() => {
    if (!roomId) {
      setRoomInitial([]);
      return;
    }
    if (!board.ready || roomInitial.length) return;
    if (board.elements.length) setRoomInitial(board.elements);
  }, [roomId, board.ready, board.elements, roomInitial.length]);

  const sharedInitial = roomId ? roomInitial : personal;
  const sharedRemote = roomId && board.ready ? board.elements : undefined;
  const sharedRemoteVersion = roomId ? board.version : undefined;

  /** take the room's drawing home, without losing what is already on your board */
  const keepCopy = useCallback(() => {
    const room = board.elements.length ? board.elements : sharedInitial;
    if (!room.length) return;
    const merged = mergeElements(personalRef.current, room);
    writePersonalBoard(userId, merged);
    setPersonal(merged);
    setCopyNote(`saved to your board · ${merged.length} shapes`);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyNote(null), 3500);
  }, [board.elements, sharedInitial, userId]);

  return (
    <section className="board" data-tour="board">
      <div className="board-bar">
        <span className="eyebrow">Whiteboard</span>
        <span className="board-scope">
          {roomId ? (
            <>
              Shared with <b>{active?.room.name}</b> · {role ? roleLabel(role) : 'member'}
            </>
          ) : (
            'Yours alone — sketch an algorithm or a design'
          )}
        </span>
        {copyNote ? <span className="board-copied">{copyNote}</span> : null}
        {roomId && board.elements.length > 0 ? (
          <button className="board-copy" onClick={keepCopy} title="Copy this room board to your private whiteboard">
            Keep a copy
          </button>
        ) : null}
        <span className={`board-status ${roomId ? (canDraw ? board.status : 'view') : 'live'}`}>{status}</span>
      </div>

      {roomId && !canDraw ? (
        <p className="board-note">View only — an editor in this room draws and you follow along.</p>
      ) : null}

      <div className="board-canvas">
        {waiting ? (
          <div className="board-loading">
            <span className="spinner" aria-hidden="true" />
            Loading the shared board…
          </div>
        ) : (
          <Suspense fallback={<div className="board-loading"><span className="spinner" aria-hidden="true" />Preparing the canvas…</div>}>

            <BoardSurface
              key={roomId ? `room-${roomId}` : `own-${storageKey}`}
              initial={sharedInitial}
              remote={sharedRemote}
              remoteVersion={sharedRemoteVersion}
              readOnly={!canDraw}
              onChange={change}
            />
          </Suspense>
        )}
      </div>

      <p className="board-foot">
        {roomId
          ? canDraw
            ? 'Everyone in the room sees this board. Only elements are saved — images are not.'
            : 'Waiting for an editor to draw.'
          : 'Kept in this browser only — open a room to share a board with others.'}
      </p>
    </section>
  );
}
