/**
 * WebSocket bridge for the local API server (`scripts/api-dev.ts` on :3000).
 *
 * Room changes are pushed to the other tab instead of waiting for its next poll:
 * a stroke, a keystroke, a step move, a membership change, or the room closing
 * itself all arrive as one small message. Vercel functions are request-scoped and
 * cannot hold a connection, so only the local server wires this up — the browser
 * falls back to polling whenever the upgrade does not answer (see CHECKLIST.md).
 *
 * Handshake, all server-checked:
 *   1. the tab connects to /api/ws and sends `{ type: 'auth', token }`
 *   2. the token is verified against Clerk and the account row is loaded
 *   3. `{ type: 'join', roomId }` is refused unless `room_members` has a row for
 *      that account and room — the browser never decides who may listen
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { currentUser } from '../api/_lib';
import { onEvent, roomTopic, userTopic } from '../api/_events';
import { loadMembership, touchPresence } from '../api/rooms/_util';

/** sockets that never answer a ping are dropped after this */
const HEARTBEAT_MS = 30_000;
/** a socket that never authenticates is closed after this */
const AUTH_TIMEOUT_MS = 10_000;

type Client = {
  socket: WebSocket;
  userId: number;
  topics: Set<string>;
  alive: boolean;
};

type Message = { type?: unknown; token?: unknown; roomId?: unknown };

function parse(raw: unknown): Message | null {
  try {
    const value = JSON.parse(String(raw)) as unknown;
    return value && typeof value === 'object' ? (value as Message) : null;
  } catch {
    return null;
  }
}

function send(socket: WebSocket, event: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(event));
}

/** the account behind a session token, or 0 — reuses the API's own verification */
async function userIdFor(token: unknown): Promise<number> {
  if (typeof token !== 'string' || !token) return 0;
  const request = { headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
  const user = await currentUser(request);
  return user?.id ?? 0;
}

export function attachWebSocket(server: HttpServer): () => void {
  const hub = new WebSocketServer({ noServer: true });
  const clients = new Set<Client>();

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '');
    if (path !== '/api/ws') {
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket, head, (ws) => hub.emit('connection', ws, req));
  };

  hub.on('connection', (ws) => {
    const client: Client = { socket: ws, userId: 0, topics: new Set(), alive: true };
    clients.add(client);
    let authed = false;
    const deadline = setTimeout(() => {
      if (!authed) ws.close(4401, 'sign in required');
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      client.alive = true;
    });

    ws.on('message', (raw) => {
      void (async () => {
        const message = parse(raw);
        if (!message) return;

        if (message.type === 'auth') {
          if (authed) return;
          const userId = await userIdFor(message.token);
          if (!userId) {
            ws.close(4401, 'sign in required');
            return;
          }
          authed = true;
          client.userId = userId;
          client.topics.add(userTopic(userId));
          clearTimeout(deadline);
          send(ws, { type: 'ready', userId });
          return;
        }
        if (!authed) return;

        if (message.type === 'join') {
          const roomId = Number(message.roomId);
          if (!Number.isInteger(roomId) || roomId <= 0) return;
          const role = await loadMembership(roomId, client.userId);
          if (!role) {
            send(ws, { type: 'error', text: 'you are not in that room' });
            return;
          }
          client.topics.add(roomTopic(roomId));
          await touchPresence(roomId, client.userId);
          send(ws, { type: 'joined', roomId, role });
          return;
        }

        if (message.type === 'leave') {
          client.topics.delete(roomTopic(Number(message.roomId)));
        }
      })();
    });

    ws.on('close', () => {
      clearTimeout(deadline);
      clients.delete(client);
    });
    ws.on('error', () => {
      clients.delete(client);
    });
  });

  const stopEvents = onEvent((topic, event) => {
    for (const client of clients) if (client.topics.has(topic)) send(client.socket, event);
  });

  const beat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, HEARTBEAT_MS);

  server.on('upgrade', upgrade);

  return () => {
    clearInterval(beat);
    stopEvents();
    server.off('upgrade', upgrade);
    for (const client of clients) client.socket.close(1001, 'server restarting');
    hub.close();
  };
}
