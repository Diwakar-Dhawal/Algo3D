/**
 * PATCH  /api/saves/:id  → rename, overwrite the code/inputs, or toggle the star
 * DELETE /api/saves/:id  → remove it
 * Every query is scoped to the signed-in user.
 */
import { db, json, readBody, requireUser } from '../_lib.js';
import { parseTags } from './_tags.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Row = {
  id: number;
  title: string;
  language: string;
  code: string;
  inputs: string;
  description: string;
  favorite: boolean;
  board: unknown;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

const shape = (row: Row) => ({
  id: Number(row.id),
  title: row.title,
  language: row.language,
  code: row.code,
  inputs: row.inputs,
  description: row.description,
  favorite: row.favorite,
  board: Array.isArray(row.board) ? row.board : null,
  tags: Array.isArray(row.tags) ? row.tags : [],
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res);
  if (!user) return;

  const url = new URL(req.url ?? '/', 'http://localhost');
  const id = Number(url.searchParams.get('id') ?? url.pathname.split('/').pop());
  if (!Number.isInteger(id) || id <= 0) {
    json(res, 400, { error: 'invalid id' });
    return;
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const body = await readBody<{
      title?: unknown;
      code?: unknown;
      inputs?: unknown;
      description?: unknown;
      favorite?: unknown;
      tags?: unknown;
    }>(req);

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) || 'Untitled program' : null;
    const code = typeof body.code === 'string' ? body.code.slice(0, 200_000) : null;
    const inputs = typeof body.inputs === 'string' ? body.inputs.slice(0, 20_000) : null;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : null;
    const favorite = typeof body.favorite === 'boolean' ? body.favorite : null;
    // an absent list means "leave the tags alone"; an empty one clears them
    const tags = Array.isArray(body.tags) ? parseTags(body.tags) : null;

    if (title === null && code === null && inputs === null && description === null && favorite === null && tags === null) {
      json(res, 400, { error: 'nothing to update' });
      return;
    }

    const rows = (await db().query(
      `update saves
          set title       = coalesce($1, title),
              code        = coalesce($2, code),
              inputs      = coalesce($3, inputs),
              description = coalesce($4, description),
              favorite    = coalesce($5, favorite),
              tags        = coalesce($6::text[], tags),
              updated_at  = now()
        where id = $7 and user_id = $8
        returning id, title, language, code, inputs, description, favorite, board, tags, created_at, updated_at`,
      [title, code, inputs, description, favorite, tags, id, user.id]
    )) as Row[];

    if (!rows.length) {
      json(res, 404, { error: 'not found' });
      return;
    }
    json(res, 200, { save: shape(rows[0]) });
    return;
  }

  if (req.method === 'DELETE') {
    const rows = (await db().query('delete from saves where id = $1 and user_id = $2 returning id', [id, user.id])) as { id: number }[];
    if (!rows.length) {
      json(res, 404, { error: 'not found' });
      return;
    }
    json(res, 200, { ok: true });
    return;
  }

  json(res, 405, { error: 'method not allowed' });
}
