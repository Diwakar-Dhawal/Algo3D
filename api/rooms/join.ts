/**
 * POST /api/rooms/join  { code }
 *
 * One room has two codes: the plain invite code joins as a viewer, the editor
 * code joins as an editor. Codes are matched case-insensitively on the server
 * and the role is decided here, never by the browser.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, json, readBody, requireUser } from '../_lib.js';
import { MAX_MEMBERS } from './_util.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readBody<{ code?: unknown }>(req);
  const code = String(body.code ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (code.length < 4 || code.length > 24) {
    json(res, 400, { error: 'that does not look like an invite code' });
    return;
  }

  const rows = (await db().query(
    `select id, case when upper(editor_code) = $1 then 'editor' else 'viewer' end as role
       from rooms where upper(invite_code) = $1 or upper(editor_code) = $1`,
    [code]
  )) as { id: string; role: 'editor' | 'viewer' }[];

  if (!rows.length) {
    json(res, 404, { error: 'no room uses that code' });
    return;
  }
  const roomId = Number(rows[0].id);
  const joinRole = rows[0].role;

  const existing = (await db().query('select role from room_members where room_id = $1 and user_id = $2', [
    roomId,
    user.id,
  ])) as { role: string }[];

  if (!existing.length) {
    const count = (await db().query('select count(*)::int as n from room_members where room_id = $1', [roomId])) as {
      n: number;
    }[];
    if ((count[0]?.n ?? 0) >= MAX_MEMBERS) {
      json(res, 409, { error: `this room is full (${MAX_MEMBERS} people)` });
      return;
    }
    await db().query('insert into room_members (room_id, user_id, role, last_seen_at) values ($1, $2, $3, now())', [
      roomId,
      user.id,
      joinRole,
    ]);
  } else {
    // already a member: keep the role they have, just mark them present
    await db().query('update room_members set last_seen_at = now() where room_id = $1 and user_id = $2', [
      roomId,
      user.id,
    ]);
  }

  json(res, 200, { roomId, role: existing[0]?.role ?? joinRole });
}
