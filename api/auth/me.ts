/**
 * Who am I? Returns the signed-in user plus their save/favourite/streak counts,
 * or { user: null } for guests. The client uses this to decide what to show.
 *
 * Every successful call is also today's login: one `login` row per day feeds the
 * streak, so a missed day breaks it and the next visit starts again at 1.
 */
import { currentUser, db, json, statsFor } from '../_lib.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  const user = await currentUser(req);
  if (!user) {
    json(res, 200, { user: null, stats: null });
    return;
  }

  // reloading the app repeatedly must not inflate anything: one row per day
  await db().query(
    `insert into activity (user_id, day, kind, count) values ($1, current_date, 'login', 1)
     on conflict (user_id, day, kind) do nothing`,
    [user.id]
  );
  await db().query('update users set last_seen_at = now() where id = $1', [user.id]);

  json(res, 200, { user, stats: await statsFor(user.id) });
}
