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
import { useRoomBoard } from './useRoomBoard';

const BoardSurface = lazy(() => import('./BoardSurface'));

function readLocal(key: string): BoardElement[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BoardElement[]) : [];
  } catch {
    return [];
  }
}

export function Whiteboard() {
  const { user } = useAuth();
  const { active } = useRooms();

  const roomId = active?.room.id ?? null;
  const role = active?.room.role ?? null;
  const canDraw = roomId ? can(role, 'editBoard') : true;
  const board = useRoomBoard(roomId, canDraw);

  const storageKey = `algo3d:board:v1:${user?.id ?? 'guest'}`;
  const [personal, setPersonal] = useState<BoardElement[]>(() => readLocal(storageKey));
  const saveTimer = useRef<number | undefined>(undefined);

  // signing in or out swaps the private board; the room board is unaffected
  useEffect(() => {
    if (!roomId) setPersonal(readLocal(storageKey));
  }, [roomId, storageKey]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
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
      saveTimer.current = window.setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(elements));
        } catch {
          /* quota exceeded or storage blocked: the board still works this session */
        }
      }, 400);
    },
    [roomId, board, storageKey]
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
