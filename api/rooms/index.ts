/**
 * GET  /api/rooms  → the rooms you belong to
 * POST /api/rooms  → create a room from the program in the editor
 *
 * The creator becomes the owner and can hand out two links: one that joins as
 * an editor and one that joins as a viewer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, json, readBody, requireUser } from '../_lib.js';
import { LANGUAGES, MAX_OWNED_ROOMS, memberShape, newInviteCode, roomShape, stateShape } from './_util.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET' || req.method === 'HEAD') {
    const rows = (await db().query(
      `select r.id, r.name, r.owner_id, r.updated_at, m.role,
              coalesce(u.name, u.email) as owner_name,
              (select count(*)::int from room_members mm where mm.room_id = r.id) as members,
              (select count(*)::int from room_members mm
                where mm.room_id = r.id and mm.last_seen_at > now() - interval '30 seconds') as online
         from rooms r
         join room_members m on m.room_id = r.id and m.user_id = $1
         join users u on u.id = r.owner_id
        order by r.updated_at desc
        limit 50`,
      [user.id]
    )) as {
      id: string;
      name: string;
      owner_id: string;
      updated_at: string;
      role: string;
      owner_name: string | null;
      members: number;
      online: number;
    }[];

    json(res, 200, {
      rooms: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        role: row.role,
        ownerId: Number(row.owner_id),
        ownerName: row.owner_name,
        members: Number(row.members) || 0,
        online: Number(row.online) || 0,
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    });
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody<{ name?: unknown; language?: unknown; code?: unknown; inputs?: unknown }>(req);
    const name = String(body.name ?? '').trim().slice(0, 80) || 'Untitled room';
    const language = LANGUAGES.has(String(body.language)) ? String(body.language) : 'java';
    const code = String(body.code ?? '').slice(0, 200_000);
    const inputs = String(body.inputs ?? '').slice(0, 20_000);

    const owned = (await db().query('select count(*)::int as n from rooms where owner_id = $1', [user.id])) as {
      n: number;
    }[];
    if ((owned[0]?.n ?? 0) >= MAX_OWNED_ROOMS) {
      json(res, 409, { error: `you already own ${MAX_OWNED_ROOMS} rooms — delete one first` });
      return;
    }

    const rows = (await db().query(
      `insert into rooms (owner_id, name, invite_code, editor_code)
            values ($1, $2, $3, $4)
         returning id, owner_id, name, invite_code, editor_code, settings, created_at, updated_at`,
      [user.id, name, newInviteCode(), newInviteCode()]
    )) as Parameters<typeof roomShape>[0][];
    const room = rows[0];

    await db().query(`insert into room_members (room_id, user_id, role, last_seen_at) values ($1, $2, 'owner', now())`, [
      room.id,
      user.id,
    ]);
    const state = (await db().query(
      `insert into room_state (room_id, language, code, inputs, updated_by)
            values ($1, $2, $3, $4, $5)
         returning language, code, inputs, step, version, driver_id, driver_until, updated_at`,
      [room.id, language, code, inputs, user.id]
    )) as Parameters<typeof stateShape>[0][];

    json(res, 201, {
      room: roomShape(room as never, 'owner', true),
      members: [
        memberShape({
          user_id: String(user.id),
          role: 'owner',
          joined_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          name: user.name,
          email: user.email,
          picture: user.picture,
        }),
      ],
      state: stateShape(state[0]),
      serverTime: Date.now(),
    });
    return;
  }

  json(res, 405, { error: 'method not allowed' });
}
