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
import type { BoardElement } from './elements';
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
  const saveTimer = useRef<number | undefined>(undefined);
  const personalRef = useRef<BoardElement[]>(personal);
  personalRef.current = personal;
  const userRef = useRef<number | null>(userId);
  userRef.current = userId;

  // signing in or out swaps the private board; the room board is unaffected
  useEffect(() => {
    if (!roomId) setPersonal(readPersonalBoard(userId));
  }, [roomId, userId]);

  // a pending debounce is flushed on the way out, so saving right after a
  // stroke (or switching tabs) still captures the drawing
  useEffect(
    () => () => {
      if (!saveTimer.current) return;
      window.clearTimeout(saveTimer.current);
      writePersonalBoard(userRef.current, personalRef.current);
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

  return (
    <section className="board">
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
        <span className={`board-status ${roomId ? (canDraw ? board.status : 'view') : 'live'}`}>{status}</span>
      </div>

      {roomId && !canDraw ? (
        <p className="board-note">View only — an editor in this room draws and you follow along.</p>
      ) : null}

      <div className="board-canvas">
        {waiting ? (
          <div className="board-loading">Loading the shared board…</div>
        ) : (
          <Suspense fallback={<div className="board-loading">Preparing the canvas…</div>}>
            <BoardSurface
              key={roomId ? `room-${roomId}` : `own-${storageKey}`}
              initial={roomId ? board.elements : personal}
              remote={roomId ? board.elements : undefined}
              remoteVersion={roomId ? board.version : undefined}
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
