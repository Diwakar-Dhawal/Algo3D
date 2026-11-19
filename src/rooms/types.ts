/** Shapes shared by the room API and the room client. */

import type { RoomRole } from './roles';

/** free-form per-room settings, kept server-side for later room options */
export type RoomSettings = Record<string, unknown>;

export type RoomSummary = {
  id: number;
  name: string;
  role: RoomRole;
  ownerId: number;
  ownerName: string | null;
  members: number;
  online: number;
  updatedAt: string;
};

export type RoomMember = {
  userId: number;
  name: string;
  email: string;
  picture: string | null;
  role: RoomRole;
  online: boolean;
  joinedAt: string;
};

export type RoomState = {
  language: string;
  code: string;
  inputs: string;
  index: number;
  version: number;
  /** who currently holds the typing lease, and until when (ms epoch) */
  driver: { userId: number; until: number } | null;
  updatedAt: string;
};

export type Room = {
  id: number;
  name: string;
  ownerId: number;
  inviteCode: string;
  editorCode: string | null;
  settings: RoomSettings;
  role: RoomRole;
  createdAt: string;
  updatedAt: string;
};

export type RoomSnapshot = {
  room: Room;
  members: RoomMember[];
  state: RoomState | null;
  serverTime: number;
};

/** the shared whiteboard: Excalidraw elements plus their save version */
export type RoomBoard = {
  elements: unknown[];
  version: number;
  updatedAt: string;
  /** a poll that was already current: elements are omitted */
  unchanged?: boolean;
};

export type StatePatch = {
  code?: string;
  inputs?: string;
  language?: string;
  index?: number;
  takeover?: boolean;
};
