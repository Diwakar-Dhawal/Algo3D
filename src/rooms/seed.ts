/** The lab publishes its current program here so "start a room" can seed it. */

export type RoomSeed = { language: string; code: string; inputs: string };

let seed: RoomSeed = { language: 'java', code: '', inputs: '' };

export function setRoomSeed(next: RoomSeed): void {
  seed = next;
}

export function getRoomSeed(): RoomSeed {
  return seed;
}
