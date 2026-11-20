/**
 * Checks the auth boundary of the api/ handlers against the real database:
 * guests and bad tokens must be rejected, and the schema must be in place.
 * Authorised flows need a real Clerk session token; pass one with
 * CLERK_TEST_TOKEN=<jwt> to run those too.
 *
 *   npm run api:smoke
 */
import { readFileSync, existsSync } from 'node:fs';
import { db } from '../api/_lib';
import { onEvent } from '../api/_events';
import config from '../api/config';
import me from '../api/auth/me';
import saves from '../api/saves/index';
import saveItem from '../api/saves/[id]';
import activity from '../api/activity';
import rooms from '../api/rooms/index';
import roomJoin from '../api/rooms/join';
import roomItem from '../api/rooms/[id]';
import roomState from '../api/rooms/[id]/state';
import roomBoard from '../api/rooms/[id]/board';
import { closeIdleRooms } from '../api/rooms/_util';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

type FakeRes = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  setHeader: (name: string, value: string | string[]) => void;
  getHeader: (name: string) => string | string[] | undefined;
  end: (chunk?: string) => void;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
  };
  return res;
}

function makeReq(url: string, init: { method?: string; auth?: string; body?: unknown } = {}) {
  const raw = init.body === undefined ? '' : JSON.stringify(init.body);
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  const req = {
    url,
    method: init.method ?? 'GET',
    headers: { authorization: init.auth ?? '', host: 'localhost:3000' } as Record<string, string>,
    on(event: string, fn: (arg?: unknown) => void) {
      listeners[event] = listeners[event] ? [...listeners[event], fn] : [fn];
      // the body is delivered once somebody is listening for its end, not before
      if (event === 'end') setTimeout(emit, 0);
      return req;
    },
    destroy() {},
  };
  // A signed-in handler awaits the session before it reads the body, so the
  // body events have to wait for whoever is listening: firing them on the next
  // tick left `readBody` waiting on an `end` that had already gone by, and the
  // whole run died silently with nothing printed.
  let fired = false;
  function emit() {
    if (fired) return;
    fired = true;
    if (raw) listeners.data?.forEach((fn) => fn(Buffer.from(raw)));
    listeners.end?.forEach((fn) => fn());
  }
  return req;
}

const parse = (res: FakeRes) => {
  try {
    return JSON.parse(res.body || '{}');
  } catch {
    return { raw: res.body };
  }
};

async function run() {
  const sql = db();
  const results: string[] = [];
  const check = (label: string, ok: boolean, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
  };

  // --- schema --------------------------------------------------------------
  const columns = (await sql.query(
    `select column_name from information_schema.columns
      where table_name = 'users' order by ordinal_position`
  )) as { column_name: string }[];
  const names = columns.map((row) => row.column_name);
  check('users.clerk_user_id exists', names.includes('clerk_user_id'), names.join(','));
  check('users.google_sub is gone', !names.includes('google_sub'));
  check('saves table exists', ((await sql.query("select to_regclass('public.saves') as t")) as { t: string | null }[])[0]?.t !== null);
  const saveColumns = (await sql.query(
    `select column_name from information_schema.columns where table_name = 'saves'`
  )) as { column_name: string }[];
  check('saves.board exists', saveColumns.some((row) => row.column_name === 'board'), saveColumns.map((r) => r.column_name).join(','));
  check('activity table exists', ((await sql.query("select to_regclass('public.activity') as t")) as { t: string | null }[])[0]?.t !== null);
  const roomTables = (await sql.query(
    "select to_regclass('public.rooms') as r, to_regclass('public.room_members') as m, to_regclass('public.room_state') as s"
  )) as { r: string | null; m: string | null; s: string | null }[];
  check(
    'rooms tables exist',
    Boolean(roomTables[0]?.r && roomTables[0]?.m && roomTables[0]?.s),
    JSON.stringify(roomTables[0])
  );
  const roomColumns = (await sql.query(
    `select column_name from information_schema.columns where table_name = 'rooms'`
  )) as { column_name: string }[];
  check('rooms has both invite codes', roomColumns.some((row) => row.column_name === 'editor_code'));
  check(
    'rooms tracks activity and a close',
    roomColumns.some((row) => row.column_name === 'last_active_at') &&
      roomColumns.some((row) => row.column_name === 'closed_at'),
    roomColumns.map((row) => row.column_name).join(',')
  );
  const idleIndex = (await sql.query(
    `select indexname from pg_indexes where tablename = 'rooms' and indexname = 'rooms_idle_idx'`
  )) as { indexname: string }[];
  check('the idle sweep has its index', idleIndex.length === 1);
  const boardTable = (await sql.query("select to_regclass('public.room_board') as b")) as { b: string | null }[];
  check('room_board table exists', boardTable[0]?.b !== null);

  // --- guests --------------------------------------------------------------
  let res = makeRes();
  await config(makeReq('/api/config') as never, res as never);
  check(
    'config hands out the public key for guests',
    res.statusCode === 200 && parse(res).clerkPublishableKey !== undefined,
    JSON.stringify(parse(res))
  );
  check(
    'config never leaks a secret',
    !JSON.stringify(parse(res)).includes(process.env.CLERK_SECRET_KEY ?? '\u0000'),
    'secret key present in the response'
  );

  res = makeRes();
  await me(makeReq('/api/auth/me') as never, res as never);
  check('guest /me is user:null', parse(res).user === null, JSON.stringify(parse(res)));

  res = makeRes();
  await saves(makeReq('/api/saves') as never, res as never);
  check('guest list is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await saves(makeReq('/api/saves', { method: 'POST', body: { title: 'x', language: 'java', code: 'a' } }) as never, res as never);
  check('guest create is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await saveItem(makeReq('/api/saves/1', { method: 'DELETE' }) as never, res as never);
  check('guest delete is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await activity(makeReq('/api/activity', { method: 'POST', body: { kind: 'run' } }) as never, res as never);
  check('guest activity is 401', res.statusCode === 401, `got ${res.statusCode}`);

  // --- forged / expired tokens --------------------------------------------
  res = makeRes();
  await saves(makeReq('/api/saves', { auth: 'Bearer not-a-real-jwt' }) as never, res as never);
  check('garbage bearer token is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await saves(makeReq('/api/saves', { auth: 'Basic abc' }) as never, res as never);
  check('non-bearer auth is 401', res.statusCode === 401, `got ${res.statusCode}`);

  // --- rooms: every entry point needs a session ---------------------------
  res = makeRes();
  await rooms(makeReq('/api/rooms') as never, res as never);
  check('guest room list is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await rooms(makeReq('/api/rooms', { method: 'POST', body: { name: 'x' } }) as never, res as never);
  check('guest room create is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomJoin(makeReq('/api/rooms/join', { method: 'POST', body: { code: 'ABCD2345' } }) as never, res as never);
  check('guest room join is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomItem(makeReq('/api/rooms/1') as never, res as never);
  check('guest room read is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomState(makeReq('/api/rooms/1/state', { method: 'PUT', body: { index: 1 } }) as never, res as never);
  check('guest room state push is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomBoard(makeReq('/api/rooms/1/board') as never, res as never);
  check('guest room board read is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomBoard(makeReq('/api/rooms/1/board', { method: 'PUT', body: { elements: [] } }) as never, res as never);
  check('guest room board push is 401', res.statusCode === 401, `got ${res.statusCode}`);

  res = makeRes();
  await roomItem(makeReq('/api/rooms/1', { method: 'DELETE' }) as never, res as never);
  check('guest room delete is 401', res.statusCode === 401, `got ${res.statusCode}`);

  // --- authorised flows (needs a live Clerk session token) ----------------
  const token = process.env.CLERK_TEST_TOKEN;
  if (!token) {
    results.push('SKIP  signed-in save/star/streak flow — set CLERK_TEST_TOKEN=<session jwt> to run it');
  } else {
    const auth = `Bearer ${token}`;
    res = makeRes();
    await me(makeReq('/api/auth/me', { auth }) as never, res as never);
    const who = parse(res);
    check('token resolves to a user row', typeof who.user?.id === 'number', JSON.stringify(who.user?.email));

    res = makeRes();
    await saves(
      makeReq('/api/saves', {
        method: 'POST',
        auth,
        body: {
          title: 'Smoke',
          language: 'java',
          code: 'class Main {}',
          board: [{ id: 'smoke-rect', type: 'rectangle', version: 1 }],
        },
      }) as never,
      res as never
    );
    const created = parse(res);
    check('create returns 201', res.statusCode === 201, `got ${res.statusCode}`);
    check('create stores the drawing', created.save?.board?.length === 1, JSON.stringify(created.save?.board));
    const id = Number(created.save?.id);

    if (id) {
      res = makeRes();
      await saveItem(makeReq(`/api/saves/${id}`, { method: 'PATCH', auth, body: { favorite: true } }) as never, res as never);
      check('star toggle works', parse(res).save?.favorite === true);

      res = makeRes();
      await activity(makeReq('/api/activity', { method: 'POST', auth, body: { kind: 'run' } }) as never, res as never);
      check('run counts towards the streak', parse(res).stats?.runsToday >= 1, JSON.stringify(parse(res).stats));

      res = makeRes();
      await saveItem(makeReq(`/api/saves/${id}`, { method: 'DELETE', auth }) as never, res as never);
      check('owner can delete', res.statusCode === 200 && parse(res).ok === true);
    }

    // --- room lifecycle: pushes, idle close, reopen -----------------------
    // the browser is not involved: the same handlers the app calls are run
    // against the real database, and the event bus is watched for the payloads
    // the WebSocket bridge forwards.
    const events: string[] = [];
    const stopEvents = onEvent((topic, event) => events.push(`${topic}|${event.type}`));

    res = makeRes();
    await rooms(
      makeReq('/api/rooms', {
        method: 'POST',
        auth,
        body: { name: 'Smoke room', language: 'java', code: 'class Main {}', inputs: '' },
      }) as never,
      res as never
    );
    const roomBody = parse(res);
    const roomId = Number(roomBody.room?.id);
    check('room create returns 201', res.statusCode === 201, `got ${res.statusCode}`);
    check('a new room is open', roomBody.room?.closedAt === null, JSON.stringify(roomBody.room?.closedAt));

    if (roomId) {
      res = makeRes();
      await roomState(
        makeReq(`/api/rooms/${roomId}/state`, {
          method: 'PUT',
          auth,
          body: { code: 'class Main { }', baseVersion: 1 },
        }) as never,
        res as never
      );
      check('state push is 200', res.statusCode === 200, `got ${res.statusCode}`);
      check('state push is published to the room', events.includes(`room:${roomId}|state`), events.join(' '));

      res = makeRes();
      await roomBoard(
        makeReq(`/api/rooms/${roomId}/board`, {
          method: 'PUT',
          auth,
          body: { elements: [{ id: 'smoke-1', type: 'rectangle', version: 1 }], baseVersion: 0 },
        }) as never,
        res as never
      );
      check('board push is 200', res.statusCode === 200, `got ${res.statusCode}`);
      check('board push is published to the room', events.includes(`room:${roomId}|board`), events.join(' '));

      res = makeRes();
      await roomItem(
        makeReq(`/api/rooms/${roomId}`, { method: 'PATCH', auth, body: { name: 'Smoke room 2' } }) as never,
        res as never
      );
      check('rename is 200', res.statusCode === 200, `got ${res.statusCode}`);
      check('rename is published to the room', events.includes(`room:${roomId}|members`), events.join(' '));

      const aged = (await sql.query('select last_active_at, closed_at from rooms where id = $1', [roomId])) as {
        last_active_at: string;
        closed_at: string | null;
      }[];
      check(
        'a write counts as activity',
        Date.now() - new Date(aged[0]?.last_active_at ?? 0).getTime() < 60_000,
        aged[0]?.last_active_at
      );
      check('the room is open after activity', aged[0]?.closed_at === null);

      // age it past the idle window: the sweep must close it and say so
      await sql.query("update rooms set last_active_at = now() - interval '25 minutes' where id = $1", [roomId]);
      const closedIds = await closeIdleRooms();
      check('the idle sweep closes the aged room', closedIds.includes(roomId), closedIds.join(','));
      check('the close is published to the room', events.includes(`room:${roomId}|closed`), events.join(' '));

      res = makeRes();
      await roomItem(makeReq(`/api/rooms/${roomId}?since=5`, { auth }) as never, res as never);
      check(
        'a poll of a closed room answers closed',
        res.statusCode === 200 && parse(res).closed === true,
        JSON.stringify(parse(res))
      );

      res = makeRes();
      await roomItem(makeReq(`/api/rooms/${roomId}`, { auth }) as never, res as never);
      const reopened = parse(res);
      check(
        'opening it again reopens it with its work intact',
        res.statusCode === 200 && reopened.room?.closedAt === null && reopened.state?.code === 'class Main { }',
        JSON.stringify({ closedAt: reopened.room?.closedAt, code: reopened.state?.code })
      );

      res = makeRes();
      await roomItem(makeReq(`/api/rooms/${roomId}`, { method: 'DELETE', auth }) as never, res as never);
      check('the test room is removed', res.statusCode === 200 && parse(res).ok === true, `got ${res.statusCode}`);
    }
    stopEvents();
  }

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.filter((l) => l.startsWith('PASS')).length} API CHECKS PASSED`);
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
