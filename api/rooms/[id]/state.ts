/**
 * GET /api/rooms/:id/state  → the current shared program
 * PUT /api/rooms/:id/state  → push a change
 *
 * Capabilities decide what may change: source edits need `editCode`, step moves
 * need `driveTrace`, so a viewer's write is refused here even if they craft the
 * request by hand. Writes are compare-and-set on `version`, and only one editor
 * holds the typing lease at a time, so two people never overwrite each other's
 * keystrokes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db, json, readBody, requireUser } from '../../_lib';
import { can } from '../../../src/rooms/roles';
import {
  DRIVER_LEASE_MS,
  LANGUAGES,
  MAX_STATE_BYTES,
  loadMembership,
  loadStateRow,
  roomIdFrom,
  stateShape,
  touchPresence,
} from '../_util';

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
    await touchPresence(roomId, user.id);
    json(res, 200, { state: stateShape(await loadStateRow(roomId)) });
    return;
  }

  if (req.method !== 'PUT' && req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  const body = await readBody<{
    baseVersion?: unknown;
    code?: unknown;
    inputs?: unknown;
    language?: unknown;
    index?: unknown;
    step?: unknown;
    takeover?: unknown;
  }>(req);

  const hasSource = body.code !== undefined || body.inputs !== undefined || body.language !== undefined;
  const hasStep = body.index !== undefined || body.step !== undefined;
  if (!hasSource && !hasStep) {
    json(res, 400, { error: 'nothing to update' });
    return;
  }
  if (hasSource && !can(role, 'editCode')) {
    json(res, 403, { error: 'your role cannot change the code' });
    return;
  }
  if (hasStep && !can(role, 'driveTrace')) {
    json(res, 403, { error: 'your role cannot move the trace' });
    return;
  }

  const code = typeof body.code === 'string' ? body.code.slice(0, MAX_STATE_BYTES) : null;
  const inputs = typeof body.inputs === 'string' ? body.inputs.slice(0, 20_000) : null;
  const language = typeof body.language === 'string' && LANGUAGES.has(body.language) ? body.language : null;
  if (body.language !== undefined && language === null) {
    json(res, 400, { error: 'unknown language' });
    return;
  }

  const rawStep = body.index !== undefined ? body.index : body.step;
  const step =
    rawStep === undefined ? null : Math.max(0, Math.min(1_000_000, Math.floor(Number(rawStep)) || 0));

  const current = await loadStateRow(roomId);
  if (!current) {
    json(res, 404, { error: 'room state not found' });
    return;
  }

  const leaseUntil = current.driver_until ? new Date(current.driver_until).getTime() : 0;
  const lockedByOther =
    hasSource && current.driver_id && Number(current.driver_id) !== user.id && leaseUntil > Date.now();
  if (lockedByOther && body.takeover !== true) {
    json(res, 409, { error: 'another editor is typing', state: stateShape(current) });
    return;
  }

  const baseVersion = Number(body.baseVersion);
  const compareVersion = Number.isInteger(baseVersion) && baseVersion > 0;
  const lease = hasSource ? new Date(Date.now() + DRIVER_LEASE_MS).toISOString() : null;

  const rows = (await db().query(
    `update room_state
        set code          = coalesce($1, code),
            inputs        = coalesce($2, inputs),
            language      = coalesce($3, language),
            step          = coalesce($4, step),
            version       = version + 1,
            driver_id     = case when $5::bigint is null then driver_id else $5 end,
            driver_until  = case when $6::timestamptz is null then driver_until else $6 end,
            updated_by    = $7,
            updated_at    = now()
      where room_id = $8 ${compareVersion ? 'and version = $9' : ''}
  returning language, code, inputs, step, version, driver_id, driver_until, updated_at`,
    compareVersion
      ? [code, inputs, language, step, hasSource ? user.id : null, lease, user.id, roomId, baseVersion]
      : [code, inputs, language, step, hasSource ? user.id : null, lease, user.id, roomId]
  )) as Parameters<typeof stateShape>[0][];

  if (!rows.length) {
    const latest = await loadStateRow(roomId);
    json(res, 409, { error: 'the room moved on — try again', state: stateShape(latest) });
    return;
  }

  if (hasSource) {
    await db().query('update rooms set updated_at = now() where id = $1', [roomId]);
  }
  await touchPresence(roomId, user.id);

  json(res, 200, { state: stateShape(rows[0]) });
}
