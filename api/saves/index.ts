/**
 * GET  /api/saves  → the signed-in user's programs (favourites first)
 * POST /api/saves  → save the current program
 */
import { db, json, readBody, requireUser } from '../_lib.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LANGUAGES = new Set(['java', 'python', 'javascript', 'cpp']);
const MAX_SAVES = 300;

type Row = {
  id: number;
  title: string;
  language: string;
  code: string;
  inputs: string;
  description: string;
  favorite: boolean;
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
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET' || req.method === 'HEAD') {
    const rows = (await db().query(
      `select id, title, language, code, inputs, description, favorite, created_at, updated_at
         from saves where user_id = $1
        order by favorite desc, updated_at desc
        limit ${MAX_SAVES}`,
      [user.id]
    )) as Row[];
    json(res, 200, { saves: rows.map(shape) });
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody<{
      title?: unknown;
      language?: unknown;
      code?: unknown;
      inputs?: unknown;
      description?: unknown;
      favorite?: unknown;
    }>(req);
    const title = String(body.title ?? '').trim().slice(0, 120) || 'Untitled program';
    const language = String(body.language ?? 'java');
    const code = String(body.code ?? '');
    const inputs = String(body.inputs ?? '').slice(0, 20_000);
    const description = String(body.description ?? '').trim().slice(0, 2000);
    const favorite = body.favorite === true;

    if (!LANGUAGES.has(language)) {
      json(res, 400, { error: 'unknown language' });
      return;
    }
    if (!code.trim()) {
      json(res, 400, { error: 'nothing to save: the editor is empty' });
      return;
    }
    if (code.length > 200_000) {
      json(res, 413, { error: 'program is too large to save' });
      return;
    }

    const count = (await db().query('select count(*)::int as n from saves where user_id = $1', [user.id])) as { n: number }[];
    if ((count[0]?.n ?? 0) >= MAX_SAVES) {
      json(res, 409, { error: `you already have ${MAX_SAVES} saved programs — delete a few first` });
      return;
    }

    const rows = (await db().query(
      `insert into saves (user_id, title, language, code, inputs, description, favorite)
            values ($1, $2, $3, $4, $5, $6, $7)
         returning id, title, language, code, inputs, description, favorite, created_at, updated_at`,
      [user.id, title, language, code, inputs, description, favorite]
    )) as Row[];
    await db().query(
      `insert into activity (user_id, day, kind, count) values ($1, current_date, 'save', 1)
       on conflict (user_id, day, kind) do update set count = activity.count + 1`,
      [user.id]
    );
    json(res, 201, { save: shape(rows[0]) });
    return;
  }

  json(res, 405, { error: 'method not allowed' });
}
