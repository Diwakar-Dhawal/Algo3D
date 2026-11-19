/**
 * Room roles and what each one may do — the canonical table.
 *
 * It lives here, inside `api/`, because Vercel compiles each file under `api/`
 * on its own: a function that imports from `src/` can fail at runtime. The
 * browser reaches the same table through `src/rooms/roles.ts`, which re-exports
 * this file, so there is still exactly one definition.
 *
 * To add a role (`presenter`, `mentor`, `ta`, …) add the entry here plus
 * whatever UI uses it; both sides pick it up.
 *
 * The server never trusts the role the browser claims — it reads the role from
 * `room_members` and checks it against these capabilities.
 */

export type RoomRole = 'owner' | 'editor' | 'viewer';

export type RoomCapability =
  | 'editCode' // change the source, inputs or language
  | 'runCode' // compile + trace the program
  | 'driveTrace' // move the shared step (playbar, scrubber)
  | 'invite' // see and share both invite links
  | 'manageRoles' // promote/demote other members
  | 'manageRoom'; // rename, delete, change room settings

export type RoleSpec = {
  label: string;
  hint: string;
  caps: RoomCapability[];
};

export const ROOM_ROLES: Record<RoomRole, RoleSpec> = {
  owner: {
    label: 'Owner',
    hint: 'Everything, including members, roles and the room itself.',
    caps: ['editCode', 'runCode', 'driveTrace', 'invite', 'manageRoles', 'manageRoom'],
  },
  editor: {
    label: 'Editor',
    hint: 'Can change the code, run it and move the trace.',
    caps: ['editCode', 'runCode', 'driveTrace'],
  },
  viewer: {
    label: 'Viewer',
    hint: 'Watches only: cannot change the code, run it or move the trace.',
    caps: [],
  },
};

/** roles the owner may hand out; ownership itself is never assignable */
export const ASSIGNABLE_ROLES: RoomRole[] = ['viewer', 'editor'];

export const ROLE_ORDER: RoomRole[] = ['owner', 'editor', 'viewer'];

export function isRoomRole(value: unknown): value is RoomRole {
  return typeof value === 'string' && value in ROOM_ROLES;
}

export function can(role: RoomRole | null | undefined, cap: RoomCapability): boolean {
  if (!role) return false;
  return ROOM_ROLES[role].caps.includes(cap);
}

export function roleLabel(role: RoomRole): string {
  return ROOM_ROLES[role]?.label ?? role;
}
