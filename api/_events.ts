/**
 * In-process event bus between the API handlers and the WebSocket bridge
 * (`scripts/ws-server.ts`).
 *
 * A handler publishes to a topic and every socket joined to that topic gets the
 * event pushed. Nothing here imports a socket library or Node-only module, so the
 * same file bundles cleanly into a serverless function, where it simply has no
 * listeners and every publish is a no-op — the browser then keeps polling.
 */

export type RoomEventBody =
  | { type: 'state'; state: unknown }
  | { type: 'board'; version: number }
  | { type: 'members' }
  | { type: 'room' }
  | { type: 'closed' }
  | { type: 'notice'; text: string };

type Listener = (topic: string, event: RoomEventBody) => void;

const listeners = new Set<Listener>();

/** the bridge registers once per process; returns the unsubscribe */
export function onEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emit(topic: string, event: RoomEventBody): void {
  for (const listener of listeners) {
    try {
      listener(topic, event);
    } catch {
      // one bad socket must not stop the room from telling everyone else
    }
  }
}

/** a room's channel: only members who joined it receive these */
export const roomTopic = (roomId: number): string => `room:${roomId}`;

/** one account's channel, for notifications that are not about a room */
export const userTopic = (userId: number): string => `user:${userId}`;

export function emitRoom(roomId: number, event: RoomEventBody): void {
  emit(roomTopic(roomId), event);
}
