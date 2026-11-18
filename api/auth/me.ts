/**
 * Who am I? Returns the signed-in user plus their save/favourite/streak counts,
 * or { user: null } for guests. The client uses this to decide what to show.
 */
import { currentUser, json, statsFor } from '../_lib';
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
  json(res, 200, { user, stats: await statsFor(user.id) });
}
