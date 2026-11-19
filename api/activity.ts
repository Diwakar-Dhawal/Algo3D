/**
 * POST /api/activity  { kind?: 'run' | 'save' | 'open', language?: string }
 *
 * Records one event for today and returns the refreshed stats. The activity
 * table is also what the streak is read from: any day with a row (a login is
 * written by /api/auth/me) keeps the streak alive, a missed day breaks it.
 */
import { db, json, readBody, requireUser, statsFor } from './_lib.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const KINDS = new Set(['run', 'save', 'open']);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;

  const body = await readBody<{ kind?: unknown }>(req);
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'run';

  await db().query(
    `insert into activity (user_id, day, kind, count) values ($1, current_date, $2, 1)
     on conflict (user_id, day, kind) do update set count = activity.count + 1`,
    [user.id, kind]
  );
  await db().query('update users set last_seen_at = now() where id = $1', [user.id]);

  json(res, 200, { stats: await statsFor(user.id) });
}
