/**
 * Runs the api/ functions on http://localhost:3000 so `npm run dev` is full-stack
 * without needing `vercel login`. Vite proxies /api here (see vite.config.ts).
 *
 *   npm run dev:api
 */
import { createServer } from 'node:http';
import me from '../api/auth/me';
import saves from '../api/saves/index';
import saveItem from '../api/saves/[id]';
import activity from '../api/activity';
import rooms from '../api/rooms/index';
import roomJoin from '../api/rooms/join';
import roomItem from '../api/rooms/[id]';
import roomState from '../api/rooms/[id]/state';

const PORT = Number(process.env.API_PORT ?? 3000);

type Handler = (req: never, res: never) => unknown | Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/auth/me': me as unknown as Handler,
  '/api/saves': saves as unknown as Handler,
  '/api/activity': activity as unknown as Handler,
  '/api/rooms': rooms as unknown as Handler,
  '/api/rooms/join': roomJoin as unknown as Handler,
};

/** nested paths that Vercel's file router would handle for us in production */
const dynamicRoutes: [RegExp, Handler][] = [
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

server.listen(PORT, () => {
  console.log(`api listening on http://localhost:${PORT}`);
  if (!process.env.CLERK_SECRET_KEY) console.warn('CLERK_SECRET_KEY is not set — every authenticated call will fail');
  if (!process.env.DATABASE_URL) console.warn('DATABASE_URL is not set — database calls will fail');
});
