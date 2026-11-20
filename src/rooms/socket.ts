/**
 * Realtime room channel.
 *
 * `scripts/ws-server.ts` keeps one socket per signed-in tab and pushes each
 * change as it happens, so a stroke or a keystroke lands in the other tab in
 * milliseconds instead of on the next poll. Polling never goes away: it is the
 * fallback for a deployment that cannot hold a connection (the API behind
 * Vercel's functions is request-scoped), so a tab that never upgrades keeps
 * working exactly as it did before.
 *
 * The handshake is server-checked: the session token is verified against Clerk,
 * then `join` is refused unless `room_members` has a row for that account. The
 * browser never decides which room it may listen to.
 */
import { sessionToken } from '../auth/api';
import type { RoomState } from './types';

export type RoomEvent =
  | { type: 'state'; state: RoomState }
  | { type: 'board'; version: number }
  | { type: 'members' }
  | { type: 'room' }
  | { type: 'closed' }
  | { type: 'notice'; text: string };

type Handler = (event: RoomEvent) => void;

const handlers = new Set<Handler>();

/** listen to the events of the room this tab has open; returns the unsubscribe */
export function onRoomEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

function publish(event: RoomEvent): void {
  for (const handler of handlers) {
    try {
      handler(event);
    } catch {
      // one pane must not break the channel for the others
    }
  }
}

const SOCKET_PATH = '/api/ws';
/** after this many failed attempts the tab stays on polling for the session */
const MAX_ATTEMPTS = 6;

/**
 * Connects for one room and reports whether the socket is live. Closing the
 * returned function ends the connection and any pending retry.
 */
export function openRoomSocket(roomId: number, onLive: (live: boolean) => void): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let attempt = 0;

  const schedule = () => {
    if (stopped || attempt >= MAX_ATTEMPTS) return;
    attempt += 1;
    retry = window.setTimeout(() => void connect(), Math.min(20_000, 1000 * 2 ** (attempt - 1)));
  };

  const connect = async () => {
    if (stopped) return;
    const token = await sessionToken();
    if (stopped) return;
    // the Clerk bridge may still be loading on the first render
    if (!token) {
      schedule();
      return;
    }

    const url = new URL(SOCKET_PATH, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));

    ws.onmessage = (message) => {
      let event: { type?: string; state?: RoomState; text?: string; version?: number };
      try {
        event = JSON.parse(String(message.data)) as typeof event;
      } catch {
        return;
      }
      if (!event.type) return;

      if (event.type === 'ready') {
        attempt = 0;
        onLive(true);
        ws.send(JSON.stringify({ type: 'join', roomId }));
        return;
      }
      if (event.type === 'state' && event.state) publish({ type: 'state', state: event.state });
      else if (event.type === 'board') publish({ type: 'board', version: Number(event.version) || 0 });
      else if (event.type === 'notice' && typeof event.text === 'string')
        publish({ type: 'notice', text: event.text });
      else if (event.type === 'members' || event.type === 'room' || event.type === 'closed')
        publish({ type: event.type });
    };

    ws.onclose = () => {
      if (socket === ws) socket = null;
      onLive(false);
      schedule();
    };
    ws.onerror = () => {
      // onclose follows, and that is where the retry is decided
    };
  };

  void connect();

  return () => {
    stopped = true;
    if (retry) window.clearTimeout(retry);
    onLive(false);
    socket?.close();
    socket = null;
  };
}
