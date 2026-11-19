/**
 * Room session: who is in the room, what role they hold, and the shared
 * program. State travels over the same HTTPS API as everything else — the
 * client polls while a room is open, so there is no extra service to run or
 * keep awake. Swapping this layer for a WebSocket provider later only changes
 * this file.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { roomsApi } from './api';
import { can as roleCan } from './roles';
import type { RoomCapability, RoomRole } from './roles';
import type { Room, RoomMember, RoomSnapshot, RoomState, RoomSummary, StatePatch } from './types';

export type ActiveRoom = { room: Room; members: RoomMember[]; state: RoomState | null };

type RoomsValue = {
  rooms: RoomSummary[];
  listLoading: boolean;
  active: ActiveRoom | null;
  activeId: number | null;
  connected: boolean;
  notice: string | null;
  setNotice: (value: string | null) => void;
  role: RoomRole | null;
  can: (cap: RoomCapability) => boolean;
  openRoom: (id: number) => Promise<boolean>;
  closeRoom: () => void;
  refreshList: () => Promise<void>;
  createRoom: (name: string, seed: { language: string; code: string; inputs: string }) => Promise<boolean>;
  joinRoom: (code: string) => Promise<string | null>;
  push: (patch: StatePatch) => void;
  renameRoom: (name: string) => Promise<void>;
  setMemberRole: (userId: number, role: RoomRole) => Promise<void>;
  removeMember: (userId: number) => Promise<void>;
  leaveRoom: () => Promise<void>;
  deleteRoom: () => Promise<void>;
  inviteUrl: (kind: 'viewer' | 'editor') => string;
};

const RoomsContext = createContext<RoomsValue | null>(null);

/** how often the open room is polled, in ms */
const POLL_MS = 1500;
const POLL_HIDDEN_MS = 6000;
/** how many times a conflicting push is re-sent on the newer version */
const MAX_REBASE = 2;

export function RoomsProvider({ children }: { children: ReactNode }) {
  const { user, available } = useAuth();
  const userId = user?.id ?? 0;

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const versionRef = useRef(0);
  const rebaseRef = useRef(0);
  const queueRef = useRef<StatePatch>({});
  const timerRef = useRef<number | undefined>(undefined);
  const flushingRef = useRef(false);

  const applySnapshot = useCallback((snapshot: RoomSnapshot) => {
    setActive((prev) => ({
      room: snapshot.room,
      members: snapshot.members,
      state: snapshot.state ?? prev?.state ?? null,
    }));
    if (snapshot.state) versionRef.current = snapshot.state.version;
  }, []);

  const refreshList = useCallback(async () => {
    if (!userId) {
      setRooms([]);
      return;
    }
    setListLoading(true);
    const result = await roomsApi.list();
    setListLoading(false);
    if (result.ok && result.data) setRooms(result.data.rooms);
  }, [userId]);

  useEffect(() => {
    if (!available || !userId) {
      setRooms([]);
      setActive(null);
      setActiveId(null);
      return;
    }
    void refreshList();
  }, [available, userId, refreshList]);

  // poll the open room; the request doubles as the presence heartbeat
  useEffect(() => {
    if (!activeId || !userId) return;
    let live = true;
    let timer: number | undefined;

    const tick = async () => {
      const result = await roomsApi.get(activeId, versionRef.current || undefined);
      if (!live) return;
      if (result.ok && result.data) {
        setConnected(true);
        applySnapshot(result.data);
      } else if (result.status === 404 || result.status === 403) {
        setActive(null);
        setActiveId(null);
        setNotice('You are no longer in that room.');
        return;
      } else {
        setConnected(false);
      }
      timer = window.setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };

    void tick();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeId, userId, applySnapshot]);

  const flush = useCallback(async () => {
    const roomId = activeId;
    if (!roomId) return;
    const patch = queueRef.current;
    queueRef.current = {};
    if (!Object.keys(patch).length) return;
    // a push that lands while another is in flight is retried on the next tick
    if (flushingRef.current) {
      queueRef.current = { ...patch, ...queueRef.current };
      return;
    }
    flushingRef.current = true;
    const result = await roomsApi.push(roomId, { ...patch, baseVersion: versionRef.current });
    flushingRef.current = false;

    const state = result.data?.state;
    if (result.ok && state) {
      versionRef.current = state.version;
      rebaseRef.current = 0;
      setActive((prev) => (prev ? { ...prev, state } : prev));
      setNotice(null);
    } else if (state) {
      // someone else moved first. Adopt the newer version as the base, but keep
      // the patch: re-sending it is what stops a keystroke burst being dropped.
      // The editor keeps its own buffer until the retry lands, so nothing jumps.
      versionRef.current = state.version;
      if (result.status === 409 && rebaseRef.current < MAX_REBASE) {
        rebaseRef.current += 1;
        queueRef.current = { ...patch, ...queueRef.current };
        setNotice('Another editor was mid-change — sending yours again.');
      } else {
        rebaseRef.current = 0;
        setActive((prev) => (prev ? { ...prev, state } : prev));
        setNotice(
          result.status === 409
            ? 'The room kept moving, so your last change was not saved.'
            : result.data?.error ?? 'Your role cannot make that change.'
        );
      }
    } else if (result.status === 0) {
      // a dropped connection: hold the patch and try again on the next tick
      queueRef.current = { ...patch, ...queueRef.current };
      setNotice('Could not reach the room — retrying.');
    } else {
      setNotice(result.data?.error ?? 'The room did not accept that change.');
    }
    if (Object.keys(queueRef.current).length) {
      timerRef.current = window.setTimeout(() => void flush(), 150);
    }
  }, [activeId]);

  const push = useCallback(
    (patch: StatePatch) => {
      if (!activeId) return;
      queueRef.current = { ...queueRef.current, ...patch };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      // step changes feel laggy if they wait as long as keystrokes
      timerRef.current = window.setTimeout(() => void flush(), patch.index !== undefined ? 140 : 450);
    },
    [activeId, flush]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const openRoom = useCallback(
    async (id: number) => {
      versionRef.current = 0;
      rebaseRef.current = 0;
      queueRef.current = {};
      const result = await roomsApi.get(id);
      if (!result.ok || !result.data) {
        setNotice(result.data === null ? 'Could not open that room.' : 'Could not open that room.');
        return false;
      }
      setActiveId(id);
      applySnapshot(result.data);
      setConnected(true);
      setNotice(null);
      return true;
    },
    [applySnapshot]
  );

  const closeRoom = useCallback(() => {
    setActiveId(null);
    setActive(null);
    versionRef.current = 0;
    rebaseRef.current = 0;
    queueRef.current = {};
    void refreshList();
  }, [refreshList]);

  const createRoom = useCallback(
    async (name: string, seed: { language: string; code: string; inputs: string }) => {
      const result = await roomsApi.create({ name, ...seed });
      if (!result.ok || !result.data) {
        setNotice('Could not create the room.');
        return false;
      }
      versionRef.current = result.data.state?.version ?? 0;
      setActiveId(result.data.room.id);
      applySnapshot(result.data);
      setConnected(true);
      setNotice(null);
      void refreshList();
      return true;
    },
    [applySnapshot, refreshList]
  );

  const joinRoom = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return 'Enter the invite code first.';
      const result = await roomsApi.join(trimmed);
      if (!result.ok || !result.data) {
        return (result.data as unknown as { error?: string } | null)?.error ?? 'No room uses that code.';
      }
      const opened = await openRoom(result.data.roomId);
      if (!opened) return 'Could not open that room.';
      // the code is a write credential: take it out of the address bar once used
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      void refreshList();
      return null;
    },
    [openRoom, refreshList]
  );

  const patchRoom = useCallback(
    async (body: Parameters<typeof roomsApi.patch>[1], success?: string) => {
      if (!activeId) return;
      const result = await roomsApi.patch(activeId, body);
      if (!result.ok || !result.data) {
        setNotice(
          (result.data as unknown as { error?: string } | null)?.error ?? 'Could not update the room.'
        );
        return;
      }
      applySnapshot(result.data);
      if (success) setNotice(success);
      void refreshList();
    },
    [activeId, applySnapshot, refreshList]
  );

  const renameRoom = useCallback((name: string) => patchRoom({ name }), [patchRoom]);
  const setMemberRole = useCallback(
    (target: number, role: RoomRole) => patchRoom({ member: { userId: target, role } }),
    [patchRoom]
  );
  const removeMember = useCallback((target: number) => patchRoom({ removeUserId: target }), [patchRoom]);

  const leaveRoom = useCallback(async () => {
    if (!activeId) return;
    const result = await roomsApi.patch(activeId, { leave: true });
    if (result.ok) {
      setActiveId(null);
      setActive(null);
      versionRef.current = 0;
      setNotice(null);
      void refreshList();
      return;
    }
    setNotice(
      (result.data as unknown as { error?: string } | null)?.error ??
        (result.status === 409 ? 'You own this room — delete it instead of leaving.' : 'Could not leave the room.')
    );
  }, [activeId, refreshList]);

  const deleteRoom = useCallback(async () => {
    if (!activeId) return;
    const result = await roomsApi.remove(activeId);
    if (result.ok) {
      setActiveId(null);
      setActive(null);
      versionRef.current = 0;
      void refreshList();
    } else {
      setNotice('Could not delete the room.');
    }
  }, [activeId, refreshList]);

  const role = active?.room.role ?? null;
  const canCap = useCallback((cap: RoomCapability) => roleCan(role, cap), [role]);

  const inviteUrl = useCallback(
    (kind: 'viewer' | 'editor') => {
      const code = kind === 'editor' ? active?.room.editorCode : active?.room.inviteCode;
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      if (code) url.searchParams.set('room', code);
      return url.toString();
    },
    [active?.room.editorCode, active?.room.inviteCode]
  );

  const value = useMemo<RoomsValue>(
    () => ({
      rooms,
      listLoading,
      active,
      activeId,
      connected,
      notice,
      setNotice,
      role,
      can: canCap,
      openRoom,
      closeRoom,
      refreshList,
      createRoom,
      joinRoom,
      push,
      renameRoom,
      setMemberRole,
      removeMember,
      leaveRoom,
      deleteRoom,
      inviteUrl,
    }),
    [
      rooms,
      listLoading,
      active,
      activeId,
      connected,
      notice,
      role,
      canCap,
      openRoom,
      closeRoom,
      refreshList,
      createRoom,
      joinRoom,
      push,
      renameRoom,
      setMemberRole,
      removeMember,
      leaveRoom,
      deleteRoom,
      inviteUrl,
    ]
  );

  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}

export function useRooms(): RoomsValue {
  const value = useContext(RoomsContext);
  if (!value) throw new Error('useRooms must be used inside RoomsProvider');
  return value;
}
