/**
 * Shared helpers for the room endpoints. Roles come from src/rooms/roles.ts so
 * the server and the browser agree on what each role may do.
 */
import type { IncomingMessage } from 'node:http';
import { randomInt } from 'node:crypto';
import { db } from '../_lib';
import type { RoomRole } from '../../src/rooms/roles';

export const MAX_MEMBERS = 20;
export const MAX_OWNED_ROOMS = 20;
export const MAX_STATE_BYTES = 200_000;
/** a member counts as present for this long after their last poll */
export const ONLINE_MS = 30_000;
/** how long one editor's typing lease lasts without renewing it */
export const DRIVER_LEASE_MS = 45_000;

export const LANGUAGES = new Set(['java', 'python', 'javascript', 'js', 'cpp']);

export type RoomRow = {
  id: string;
  owner_id: string;
  name: string;
  invite_code: string;
  editor_code: string | null;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type StateRow = {
  language: string;
  code: string;
  inputs: string;
  step: number;
  version: string;
  driver_id: string | null;
  driver_until: string | null;
  updated_at: string;
};

export type MemberRow = {
  user_id: string;
  role: RoomRole;
  joined_at: string;
  last_seen_at: string | null;
  name: string | null;
  email: string;
  picture: string | null;
};

const iso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

export function stateShape(row: StateRow | null | undefined) {
  if (!row) return null;
  const until = row.driver_until ? new Date(row.driver_until).getTime() : 0;
  return {
    language: row.language,
    code: row.code,
    inputs: row.inputs,
    index: Number(row.step) || 0,
    version: Number(row.version) || 1,
    driver: row.driver_id && until > Date.now() ? { userId: Number(row.driver_id), until } : null,
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function roomShape(row: RoomRow, role: RoomRole, includeCodes: boolean) {
  return {
    id: Number(row.id),
    name: row.name,
    ownerId: Number(row.owner_id),
    role,
    inviteCode: includeCodes ? row.invite_code : '',
    editorCode: includeCodes ? row.editor_code : null,
    settings: row.settings ?? {},
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function memberShape(row: MemberRow, now = Date.now()) {
  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  return {
    userId: Number(row.user_id),
    name: row.name || row.email,
    email: row.email,
    picture: row.picture,
    role: row.role,
    online: now - seen < ONLINE_MS,
    joinedAt: iso(row.joined_at) ?? new Date().toISOString(),
  };
}

export async function loadMembership(roomId: number, userId: number): Promise<RoomRole | null> {
  const rows = (await db().query('select role from room_members where room_id = $1 and user_id = $2', [
    roomId,
    userId,
  ])) as { role: RoomRole }[];
  return rows[0]?.role ?? null;
}

export async function loadRoomRow(roomId: number): Promise<RoomRow | null> {
  const rows = (await db().query(
    `select id, owner_id, name, invite_code, editor_code, settings, created_at, updated_at
       from rooms where id = $1`,
    [roomId]
  )) as RoomRow[];
  return rows[0] ?? null;
}

export async function loadStateRow(roomId: number): Promise<StateRow | null> {
  const rows = (await db().query(
    `select language, code, inputs, step, version, driver_id, driver_until, updated_at
       from room_state where room_id = $1`,
    [roomId]
  )) as StateRow[];
  return rows[0] ?? null;
}

export async function loadMembers(roomId: number): Promise<MemberRow[]> {
  return (await db().query(
    `select m.user_id, m.role, m.joined_at, m.last_seen_at, u.name, u.email, u.picture
       from room_members m join users u on u.id = m.user_id
      where m.room_id = $1
      order by m.joined_at asc`,
    [roomId]
  )) as MemberRow[];
}

/** heartbeat — writes at most every 8s per member so polling stays cheap */
export async function touchPresence(roomId: number, userId: number): Promise<void> {
  await db().query(
    `update room_members set last_seen_at = now()
      where room_id = $1 and user_id = $2
        and (last_seen_at is null or last_seen_at < now() - interval '8 seconds')`,
    [roomId, userId]
  );
}

export function roomIdFrom(req: IncomingMessage): number {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const index = parts.indexOf('rooms');
  const raw = parts[index + 1] ?? url.searchParams.get('id') ?? '';
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 8 characters, no vowels or look-alike digits, so it can be read aloud */
export function newInviteCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
