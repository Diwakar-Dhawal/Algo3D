import { apiRequest } from '../auth/api';
import type { RoomBoard, RoomSnapshot, RoomState, RoomSummary, StatePatch } from './types';

type PatchBody = {
  name?: string;
  member?: { userId: number; role: string };
  removeUserId?: number;
  leave?: boolean;
};

export const roomsApi = {
  list: () => apiRequest<{ rooms: RoomSummary[] }>('/api/rooms'),
  create: (body: { name: string; language: string; code: string; inputs: string }) =>
    apiRequest<RoomSnapshot>('/api/rooms', { method: 'POST', body }),
  join: (code: string) => apiRequest<{ roomId: number; role: string }>('/api/rooms/join', { method: 'POST', body: { code } }),
  get: (id: number, since?: number) =>
    apiRequest<RoomSnapshot>(`/api/rooms/${id}${since ? `?since=${since}` : ''}`),
  patch: (id: number, body: PatchBody) =>
    apiRequest<RoomSnapshot & { left?: boolean }>(`/api/rooms/${id}`, { method: 'PATCH', body }),
  remove: (id: number) => apiRequest<{ ok: boolean }>(`/api/rooms/${id}`, { method: 'DELETE' }),
  push: (id: number, body: StatePatch & { baseVersion: number }) =>
    apiRequest<{ state?: RoomState; error?: string }>(`/api/rooms/${id}/state`, { method: 'PUT', body }),
  board: (id: number, since?: number) =>
    apiRequest<{ board?: RoomBoard }>(`/api/rooms/${id}/board${since ? `?since=${since}` : ''}`),
  pushBoard: (id: number, body: { elements: unknown[]; baseVersion: number }) =>
    apiRequest<{ board?: RoomBoard; error?: string }>(`/api/rooms/${id}/board`, { method: 'PUT', body }),
};
