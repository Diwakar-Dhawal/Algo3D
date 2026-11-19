/**
 * Shared bits for the API functions: Postgres access, JSON helpers and Clerk-backed
 * authentication. Vercel runs each file in api/ as a Node function.
 */
import { neon } from '@neondatabase/serverless';
import { createClerkClient, verifyToken } from '@clerk/backend';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ApiUser = {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: string;
};

export type ApiStats = {
  saves: number;
  favorites: number;
  streak: number;
  runsToday: number;
  lastRunDay: string | null;
};

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;

export function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    client = neon(url);
  }
  return client;
}

let clerk: ReturnType<typeof createClerkClient> | null = null;

export function clerkClient(): ReturnType<typeof createClerkClient> {
  if (!clerk) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error('CLERK_SECRET_KEY is not configured');
    clerk = createClerkClient({ secretKey });
  }
  return clerk;
}

/* ---------- responses ---------- */

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** reads and JSON-parses a request body, capped at 1 MB */
export function readBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        req.destroy();
        resolve({} as T);
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch {
        resolve({} as T);
      }
    });
    req.on('error', () => resolve({} as T));
  });
}

/* ---------- Clerk sessions ---------- */

const bearer = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
};

/**
 * The Clerk user id behind this request, or null. The session token is verified
 * against Clerk's JWKS, then the matching row in `users` is loaded (created on
 * first sight, with the profile pulled from Clerk's Backend API).
 */
export async function currentUser(req: IncomingMessage): Promise<ApiUser | null> {
  const token = bearer(req);
  if (!token) return null;

  let sub: string;
  try {
    const claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      ...(process.env.APP_ORIGIN ? { authorizedParties: [process.env.APP_ORIGIN.replace(/\/$/, '')] } : {}),
    });
    if (!claims.sub) return null;
    sub = claims.sub;
  } catch {
    return null;
  }

  const found = (await db().query(
    'select id, email, name, picture, created_at from users where clerk_user_id = $1',
    [sub]
  )) as Record<string, unknown>[];

  if (found.length) {
    return {
      id: Number(found[0].id),
      email: String(found[0].email),
      name: (found[0].name as string | null) ?? null,
      picture: (found[0].picture as string | null) ?? null,
      createdAt: new Date(found[0].created_at as string).toISOString(),
    };
  }

  // first request from this account: copy the profile across
  let email = `${sub}@users.noreply.clerk`;
  let name: string | null = null;
  let picture: string | null = null;
  try {
    const profile = await clerkClient().users.getUser(sub);
    email = profile.primaryEmailAddress?.emailAddress ?? profile.emailAddresses[0]?.emailAddress ?? email;
    name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.username || null;
    picture = profile.imageUrl ?? null;
  } catch {
    // a profile lookup failure must not lock the user out
  }

  const created = (await db().query(
    `insert into users (clerk_user_id, email, name, picture)
          values ($1, $2, $3, $4)
     on conflict (clerk_user_id) do update set last_seen_at = now()
      returning id, email, name, picture, created_at`,
    [sub, email, name, picture]
  )) as Record<string, unknown>[];

  return {
    id: Number(created[0].id),
    email: String(created[0].email),
    name: (created[0].name as string | null) ?? null,
    picture: (created[0].picture as string | null) ?? null,
    createdAt: new Date(created[0].created_at as string).toISOString(),
  };
}

/** returns the user, or answers 401 and returns null */
export async function requireUser(req: IncomingMessage, res: ServerResponse): Promise<ApiUser | null> {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { error: 'sign in required' });
    return null;
  }
  return user;
}

/* ---------- stats (the streak comes from the activity table) ---------- */

export async function statsFor(userId: number): Promise<ApiStats> {
  const counts = (await db().query(
    `select count(*)::int as saves, count(*) filter (where favorite)::int as favorites
       from saves where user_id = $1`,
    [userId]
  )) as { saves: number; favorites: number }[];

  // every row is a day the account was seen (a login row is written by /api/auth/me),
  // so the streak is the unbroken run of days ending today
  const days = (await db().query(
    `select to_char(day, 'YYYY-MM-DD') as day,
            coalesce(sum(count) filter (where kind = 'run'), 0)::int as runs
       from activity where user_id = $1
      group by day order by day desc limit 400`,
    [userId]
  )) as { day: string; runs: number }[];

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const seen = new Set(days.map((row) => row.day));

  // a streak survives until a whole day is missed: start at today, or yesterday
  // when today's visit has not been recorded yet
  let streak = 0;
  let cursor = seen.has(today) ? today : seen.has(yesterday) ? yesterday : null;
  while (cursor && seen.has(cursor)) {
    streak++;
    cursor = new Date(new Date(`${cursor}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  }

  return {
    saves: counts[0]?.saves ?? 0,
    favorites: counts[0]?.favorites ?? 0,
    streak,
    runsToday: days.find((row) => row.day === today)?.runs ?? 0,
    lastRunDay: days.find((row) => row.runs > 0)?.day ?? null,
  };
}
