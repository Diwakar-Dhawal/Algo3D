/**
 * Runs the api/ functions on http://localhost:3000 so `npm run dev` is full-stack
 * without needing `vercel login`. Vite proxies /api here (see vite.config.ts).
 *
 *   npm run dev:api
 */
import { createServer } from 'node:http';
import { attachWebSocket } from './ws-server';
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
import { SWEEP_EVERY_MS, closeIdleRooms } from '../api/rooms/_util';

const PORT = Number(process.env.API_PORT ?? 3000);

type Handler = (req: never, res: never) => unknown | Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/config': config as unknown as Handler,
  '/api/auth/me': me as unknown as Handler,
  '/api/saves': saves as unknown as Handler,
  '/api/activity': activity as unknown as Handler,
  '/api/rooms': rooms as unknown as Handler,
  '/api/rooms/join': roomJoin as unknown as Handler,
};

/** nested paths that Vercel's file router would handle for us in production */
const dynamicRoutes: [RegExp, Handler][] = [
  [/^\/api\/rooms\/\d+\/board$/, roomBoard as unknown as Handler],
  [/^\/api\/rooms\/\d+\/state$/, roomState as unknown as Handler],
  [/^\/api\/rooms\/\d+$/, roomItem as unknown as Handler],
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  const handler =
    routes[path] ??
    dynamicRoutes.find(([pattern]) => pattern.test(path))?.[1] ??
    (/^\/api\/saves\/[^/]+$/.test(path) ? (saveItem as unknown as Handler) : null);

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  try {
    await handler(req as never, res as never);
  } catch (error) {
    console.error(`${req.method} ${path} failed:`, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'server error' }));
    }
  }
});

// room updates are pushed over this socket; the browser falls back to polling
// wherever the upgrade cannot answer (a serverless deployment, for one)
attachWebSocket(server);

/** close rooms nobody has touched, so a tab left open stops polling */
const sweep = () => {
  void closeIdleRooms().catch(() => undefined);
};
sweep();
setInterval(sweep, SWEEP_EVERY_MS).unref();

server.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
  console.log(`ws listening on ws://localhost:${PORT}/api/ws`);
  if (!process.env.CLERK_SECRET_KEY) console.warn('CLERK_SECRET_KEY is not set — every authenticated call will fail');
  if (!process.env.DATABASE_URL) console.warn('DATABASE_URL is not set — database calls will fail');
});
