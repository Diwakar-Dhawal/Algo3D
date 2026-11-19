/**
 * GET /api/rooms/:id/board  → the shared whiteboard (any member may look)
 * PUT /api/rooms/:id/board  → replace it (needs the `editBoard` capability)
 *
 * One row per room, compare-and-set on `version`. The browser merges its copy
 * with the newest server copy before pushing, so two people drawing at once
 * rarely lose strokes; the server still decides who may write at all. Viewers
 * get 403 here even if they craft the request by hand.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, json, readBody, requireUser } from '../../_lib.js';
import { can } from '../_roles.js';
import { loadMembership, roomIdFrom, touchPresence } from '../_util.js';

/** enough for a dense algorithm sketch, far short of a memory problem */
const MAX_ELEMENTS = 1500;
const MAX_BOARD_CHARS = 900_000;

type BoardRow = { elements: unknown; version: string; updated_at: string };

function boardShape(row: BoardRow | null) {
  if (!row) return { elements: [] as unknown[], version: 0, updatedAt: new Date().toISOString() };
  return {
    elements: Array.isArray(row.elements) ? row.elements : [],
    version: Number(row.version) || 0,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function loadBoard(roomId: number): Promise<BoardRow | null> {
  const rows = (await db().query(
    'select elements, version, updated_at from room_board where room_id = $1',
    [roomId]
  )) as BoardRow[];
  return rows[0] ?? null;
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
    const since = Math.max(0, Math.floor(Number(url.searchParams.get('since')) || 0));
    const board = boardShape(await loadBoard(roomId));
    await touchPresence(roomId, user.id);
    // a poll that is already up to date gets the version only, not the drawing
    if (since > 0 && board.version <= since) {
      json(res, 200, { board: { ...board, elements: [], unchanged: true } });
      return;
    }
    json(res, 200, { board });
    return;
  }

  if (req.method !== 'PUT' && req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  if (!can(role, 'editBoard')) {
    json(res, 403, { error: 'your role cannot draw on this board' });
    return;
  }

  const body = await readBody<{ baseVersion?: unknown; elements?: unknown }>(req);
  if (!Array.isArray(body.elements)) {
    json(res, 400, { error: 'elements must be an array' });
    return;
  }
  if (body.elements.length > MAX_ELEMENTS) {
    json(res, 413, { error: 'the board is too full — erase a few things first' });
    return;
  }
  const encoded = JSON.stringify(body.elements);
  if (encoded.length > MAX_BOARD_CHARS) {
    json(res, 413, { error: 'the board is too large to save' });
    return;
  }

  const baseVersion = Number(body.baseVersion);
  const compare = Number.isInteger(baseVersion) && baseVersion >= 0 ? baseVersion : null;

  const rows = (await db().query(
    `insert into room_board (room_id, elements, version, updated_by)
          values ($1, $2::jsonb, 1, $3)
     on conflict (room_id) do update
             set elements   = excluded.elements,
                 version    = room_board.version + 1,
                 updated_by = excluded.updated_by,
                 updated_at = now()
           where $4::bigint is null or room_board.version = $4::bigint
      returning elements, version, updated_at`,
    [roomId, encoded, user.id, compare]
  )) as BoardRow[];

  if (!rows.length) {
    json(res, 409, { error: 'the board moved on — try again', board: boardShape(await loadBoard(roomId)) });
    return;
  }

  await touchPresence(roomId, user.id);
  json(res, 200, { board: boardShape(rows[0]) });
}
