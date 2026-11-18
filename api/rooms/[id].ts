/**
 * GET    /api/rooms/:id?since=<version>  → room + members + state (state omitted when unchanged)
 * PATCH  /api/rooms/:id                  → rename, default role, promote/demote, remove, leave
 * DELETE /api/rooms/:id                  → owner deletes the room
 *
 * Every check uses the role stored in room_members, never anything the client sends.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, json, readBody, requireUser } from '../_lib';
import { ASSIGNABLE_ROLES, can, isRoomRole } from '../../src/rooms/roles';
import {
  loadMembers,
  loadMembership,
  loadRoomRow,
  loadStateRow,
  memberShape,
  roomIdFrom,
  roomShape,
  stateShape,
  touchPresence,
} from './_util';

async function snapshot(roomId: number, role: Parameters<typeof can>[0]) {
  const row = await loadRoomRow(roomId);
  if (!row) return null;
  const [members, state] = await Promise.all([loadMembers(roomId), loadStateRow(roomId)]);
  return {
    room: roomShape(row, role as never, can(role, 'invite')),
    members: members.map((member) => memberShape(member)),
    state: stateShape(state),
    serverTime: Date.now(),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res);
  if (!user) return;

  const roomId = roomIdFrom(req);
  if (!roomId) {
    json(res, 400, { error: 'invalid room id' });
    return;
  }
  const role = await loadMembership(roomId, user.id);
  if (!role) {
    json(res, 404, { error: 'room not found' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const since = Number(url.searchParams.get('since') ?? '0');

    // the poll doubles as the presence heartbeat
    await touchPresence(roomId, user.id);
    const row = await loadRoomRow(roomId);
    if (!row) {
      json(res, 404, { error: 'room not found' });
      return;
    }
    const [members, state] = await Promise.all([loadMembers(roomId), loadStateRow(roomId)]);
    const unchanged = since > 0 && state && Number(state.version) <= since;

    json(res, 200, {
      room: roomShape(row, role, can(role, 'invite')),
      members: members.map((member) => memberShape(member)),
      state: unchanged ? null : stateShape(state),
      serverTime: Date.now(),
    });
    return;
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const body = await readBody<{
      name?: unknown;
      defaultRole?: unknown;
      member?: { userId?: unknown; role?: unknown };
      removeUserId?: unknown;
      leave?: unknown;
    }>(req);

    const row = await loadRoomRow(roomId);
    if (!row) {
      json(res, 404, { error: 'room not found' });
      return;
    }

    const manageRoom = can(role, 'manageRoom');
    const manageRoles = can(role, 'manageRoles');
    let changed = false;

    let nextName: string | null = null;
    if (body.name !== undefined) {
      if (!manageRoom) {
        json(res, 403, { error: 'only the owner can rename the room' });
        return;
      }
      nextName = (typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '') || 'Untitled room';
      changed = true;
    }

    let nextSettings: Record<string, unknown> | null = null;
    if (body.defaultRole !== undefined) {
      if (!manageRoom) {
        json(res, 403, { error: 'only the owner can change the default role' });
        return;
      }
      if (!isRoomRole(body.defaultRole) || !ASSIGNABLE_ROLES.includes(body.defaultRole)) {
        json(res, 400, { error: 'unknown role' });
        return;
      }
      nextSettings = { ...(row.settings ?? {}), defaultRole: body.defaultRole };
      changed = true;
    }

    if (body.member && typeof body.member === 'object') {
      if (!manageRoles) {
        json(res, 403, { error: 'only the owner can change roles' });
        return;
      }
      const target = Number(body.member.userId);
      const nextRole = body.member.role;
      if (!Number.isInteger(target) || target <= 0 || !isRoomRole(nextRole) || !ASSIGNABLE_ROLES.includes(nextRole)) {
        json(res, 400, { error: 'unknown member or role' });
        return;
      }
      if (target === user.id) {
        json(res, 400, { error: 'you cannot change your own role' });
        return;
      }
      const targetRole = await loadMembership(roomId, target);
      if (!targetRole) {
        json(res, 404, { error: 'that person is not in this room' });
        return;
      }
      if (targetRole === 'owner') {
        json(res, 409, { error: 'the owner’s role cannot be changed' });
        return;
      }
      await db().query('update room_members set role = $1 where room_id = $2 and user_id = $3', [
        nextRole,
        roomId,
        target,
      ]);
      changed = true;
    }

    const removeTarget =
      body.leave === true ? user.id : body.removeUserId !== undefined ? Number(body.removeUserId) : null;
    if (removeTarget !== null) {
      const self = removeTarget === user.id;
      if (self) {
        if (role === 'owner') {
          json(res, 409, { error: 'you own this room — delete it instead of leaving' });
          return;
        }
      } else if (!manageRoles) {
        json(res, 403, { error: 'only the owner can remove members' });
        return;
      }
      const targetRole = await loadMembership(roomId, removeTarget);
      if (targetRole === 'owner') {
        json(res, 409, { error: 'the owner cannot be removed' });
        return;
      }
      if (targetRole) {
        await db().query('delete from room_members where room_id = $1 and user_id = $2', [roomId, removeTarget]);
        await db().query(
          'update room_state set driver_id = null, driver_until = null where room_id = $1 and driver_id = $2',
          [roomId, removeTarget]
        );
        changed = true;
      }
    }

    if (nextName !== null || nextSettings !== null) {
      await db().query(
        `update rooms
            set name = coalesce($1, name),
                settings = coalesce($2::jsonb, settings),
                updated_at = now()
          where id = $3`,
        [nextName, nextSettings ? JSON.stringify(nextSettings) : null, roomId]
      );
    }

    if (!changed) {
      json(res, 400, { error: 'nothing to update' });
      return;
    }

    const nextRole = removeTarget === user.id ? null : role;
    const fresh = await snapshot(roomId, nextRole as never);
    json(res, 200, fresh ? { ...fresh, left: removeTarget === user.id } : { left: removeTarget === user.id });
    return;
  }

  if (req.method === 'DELETE') {
    if (!can(role, 'manageRoom')) {
      json(res, 403, { error: 'only the owner can delete the room' });
      return;
    }
    await db().query('delete from rooms where id = $1', [roomId]);
    json(res, 200, { ok: true });
    return;
  }

  json(res, 405, { error: 'method not allowed' });
}
