import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/react';
import { useAuth } from '../auth/AuthContext';
import { AccountsNotice } from '../auth/AccountsNotice';
import { GoogleMark } from '../auth/GoogleMark';
import { useRooms } from './RoomContext';
import { ROOM_ROLES, roleLabel } from './roles';
import { getRoomSeed } from './seed';
import type { RoomMember, RoomSummary } from './types';

/** a room is live while someone is in it, open while it is merely usable, closed once it went idle */
type RoomStatus = 'live' | 'open' | 'closed';

const STATUS_LABEL: Record<RoomStatus, string> = { live: 'live', open: 'open', closed: 'closed' };
/** live rooms first, then open, then the ones the idle sweep closed */
const STATUS_RANK: Record<RoomStatus, number> = { live: 0, open: 1, closed: 2 };

function statusOf(room: RoomSummary): RoomStatus {
  if (room.closed) return 'closed';
  return room.online > 0 ? 'live' : 'open';
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** pre-filled join code, from a ?room= invite link */
  initialCode?: string;
};

function initials(member: RoomMember): string {
  const source = member.name || member.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

export function RoomsDrawer({ open, onClose, initialCode = '' }: Props) {
  const { user, available } = useAuth();
  const rooms = useRooms();
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [copied, setCopied] = useState<'viewer' | 'editor' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** the room whose delete/leave is waiting for a second click */
  const [confirmRoom, setConfirmRoom] = useState<number | null>(null);
  const [roomFilter, setRoomFilter] = useState<'all' | RoomStatus>('all');

  useEffect(() => {
    if (open && initialCode) setCode(initialCode);
  }, [open, initialCode]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setConfirmDelete(false);
      setConfirmRoom(null);
      setCopied(null);
      return;
    }
    if (user) void rooms.refreshList();
  }, [open, user, rooms.refreshList]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = rooms.active;
  const role = rooms.role;
  // live rooms above open ones, and the idle-closed ones last
  const shownRooms = rooms.rooms
    .filter((room) => roomFilter === 'all' || statusOf(room) === roomFilter)
    .slice()
    .sort((a, b) => STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]);

  const create = async () => {
    setBusy('create');
    setError(null);
    const ok = await rooms.createRoom(name.trim() || 'Untitled room', getRoomSeed());
    setBusy(null);
    if (ok) setName('');
    else setError('Could not create the room.');
  };

  /** delete your own room, or leave someone else's, straight from the list */
  const removeRoom = async (room: RoomSummary) => {
    setConfirmRoom(null);
    const mine = room.ownerId === user?.id;
    const ok = mine ? await rooms.deleteRoomById(room.id) : await rooms.leaveRoomById(room.id);
    if (!ok) setError(mine ? 'Could not delete that room.' : 'Could not leave that room.');
  };

  const join = async () => {
    setBusy('join');
    setError(null);
    const problem = await rooms.joinRoom(code);
    setBusy(null);
    if (problem) setError(problem);
    else setCode('');
  };

  const copy = async (kind: 'viewer' | 'editor') => {
    const url = rooms.inviteUrl(kind);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('Copy did not work — select the link and copy it manually.');
    }
  };

  return (
    <div className="drawer-scrim" onClick={onClose} role="presentation">
      <aside
        className="drawer rooms-drawer"
        role="dialog"
        aria-label="Collaboration rooms"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">Collaborate</span>
            <h2>Rooms</h2>
          </div>
          <button className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {!available ? (
          <AccountsNotice kind="rooms" />
        ) : !user ? (
          <div className="drawer-empty">
            <p>Sign in with Google to start or join a room.</p>
            <SignInButton mode="modal">
              <span className="btn-google">
                <GoogleMark /> Continue with Google
              </span>
            </SignInButton>
          </div>
        ) : (
          <>
            {rooms.notice ? <p className="drawer-note">{rooms.notice}</p> : null}
            {error ? <p className="drawer-note is-error">{error}</p> : null}

            {active ? (
              <section className="room-active">
                <div className="room-active-head">
                  <h3>{active.room.name}</h3>
                  <span className={`chip ${role === 'viewer' ? '' : 'on'}`}>{role ? roleLabel(role) : 'Member'}</span>
                  <span className={`room-live ${rooms.connected ? 'on' : ''}`}>
                    {rooms.connected ? 'live' : 'reconnecting'}
                  </span>
                </div>

                <p className="room-hint">
                  {role === 'viewer'
                    ? 'You are watching: the code, the run and the step are controlled by the editors.'
                    : 'You can change the code, run it and move the step. Only one editor types at a time.'}
                </p>

                {rooms.can('invite') ? (
                  <div className="room-links">
                    {(['viewer', 'editor'] as const).map((kind) => (
                      <div className="room-link" key={kind}>
                        <span className="room-link-label">
                          {kind === 'editor' ? 'Editor link' : 'Viewer link'}
                          <i>{kind === 'editor' ? 'can change code and run' : 'watch only'}</i>
                        </span>
                        <div className="room-link-row">
                          <input
                            className="drawer-input"
                            readOnly
                            value={rooms.inviteUrl(kind)}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <button className="ghost-action" onClick={() => void copy(kind)}>
                            {copied === kind ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="drawer-empty">Ask the owner for an invite link to bring someone in.</p>
                )}

                {rooms.can('manageRoom') ? (
                  <div className="room-rename">
                    <input
                      key={active.room.name}
                      className="drawer-input"
                      defaultValue={active.room.name}
                      placeholder="Room name"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void rooms.renameRoom(event.currentTarget.value);
                      }}
                    />
                    <button
                      className="ghost-action"
                      onClick={(event) => {
                        const input = event.currentTarget.previousElementSibling as HTMLInputElement | null;
                        if (input) void rooms.renameRoom(input.value);
                      }}
                    >
                      Rename
                    </button>
                  </div>
                ) : null}

                <div className="room-members-head">
                  <span className="eyebrow">Members</span>
                  <span className="eyebrow soft">
                    {active.members.filter((member) => member.online).length} online · {active.members.length} total
                  </span>
                </div>

                <ul className="room-members">
                  {active.members.map((member) => (
                    <li key={member.userId}>
                      <span className={`room-avatar ${member.online ? 'on' : ''}`}>
                        {member.picture ? <img src={member.picture} alt="" /> : initials(member)}
                      </span>
                      <span className="room-person">
                        <b>{member.name}</b>
                        <i>{member.email}</i>
                      </span>
                      {rooms.can('manageRoles') && member.role !== 'owner' && member.userId !== user.id ? (
                        <select
                          className="minimal-select"
                          value={member.role}
                          onChange={(event) =>
                            void rooms.setMemberRole(member.userId, event.target.value as 'viewer' | 'editor')
                          }
                        >
                          {(['viewer', 'editor'] as const).map((option) => (
                            <option key={option} value={option}>
                              {ROOM_ROLES[option].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="room-role-tag">{roleLabel(member.role)}</span>
                      )}
                      {rooms.can('manageRoles') && member.role !== 'owner' && member.userId !== user.id ? (
                        <button
                          className="save-del"
                          title="Remove from the room"
                          onClick={() => void rooms.removeMember(member.userId)}
                        >
                          ✕
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <div className="room-danger">
                  {role !== 'owner' ? (
                    <button className="ghost-action" onClick={() => void rooms.leaveRoom()}>
                      Leave room
                    </button>
                  ) : null}
                  {rooms.can('manageRoom') ? (
                    confirmDelete ? (
                      <span className="room-confirm">
                        Delete this room for everyone?
                        <button className="ghost-action danger" onClick={() => void rooms.deleteRoom()}>
                          Delete
                        </button>
                        <button className="link-btn" onClick={() => setConfirmDelete(false)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button className="ghost-action danger" onClick={() => setConfirmDelete(true)}>
                        Delete room
                      </button>
                    )
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                <section className="room-block">
                  <span className="eyebrow">Start a room</span>
                  <div className="room-inline">
                    <input
                      className="drawer-input"
                      value={name}
                      placeholder="Room name"
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void create();
                      }}
                    />
                    <button className="btn-gold" onClick={() => void create()} disabled={busy === 'create'}>
                      {busy === 'create' ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                  <p className="room-hint">
                    Starts from the code in the editor. You own the room and hand out two links: one for editors, one
                    for viewers.
                  </p>
                </section>

                <section className="room-block">
                  <span className="eyebrow">Join with a code</span>
                  <div className="room-inline">
                    <input
                      className="drawer-input room-code"
                      value={code}
                      placeholder="ABCD2345"
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void join();
                      }}
                    />
                    <button className="btn-gold" onClick={() => void join()} disabled={busy === 'join'}>
                      {busy === 'join' ? 'Joining…' : 'Join'}
                    </button>
                  </div>
                  <p className="room-hint">The code decides your role: editor codes can change code and run.</p>
                </section>

                <section className="room-block">
                  <span className="eyebrow">Your rooms</span>
                  {rooms.listLoading && rooms.rooms.length === 0 ? (
                    <p className="drawer-empty drawer-loading">
                      <span className="spinner" aria-hidden="true" />
                      Loading your rooms…
                    </p>
                  ) : null}
                  {!rooms.listLoading && rooms.rooms.length === 0 ? (
                    <p className="drawer-empty">No rooms yet — start one above.</p>
                  ) : null}
                  {rooms.rooms.length > 0 ? (
                    <div className="drawer-tabs room-filter" role="group" aria-label="Filter rooms by status">
                      {(['all', 'live', 'open', 'closed'] as const).map((option) => {
                        const count =
                          option === 'all'
                            ? rooms.rooms.length
                            : rooms.rooms.filter((room) => statusOf(room) === option).length;
                        return (
                          <button
                            key={option}
                            className={`chip ${roomFilter === option ? 'on' : ''}`}
                            onClick={() => setRoomFilter(option)}
                          >
                            {option === 'all' ? 'All' : STATUS_LABEL[option]}{' '}
                            <span className="chip-count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <ul className="room-list">
                    {shownRooms.map((entry) => {
                      const status = statusOf(entry);
                      const mine = entry.ownerId === user?.id;
                      return (
                        <li key={entry.id} className="room-row">
                          <button className="room-open" onClick={() => void rooms.openRoom(entry.id)}>
                            <span className="room-row-head">
                              <b>{entry.name}</b>
                              <span className={`room-tag ${status}`}>{STATUS_LABEL[status]}</span>
                            </span>
                            <span>
                              {roleLabel(entry.role)} · {entry.online} online · {entry.members} member
                              {entry.members === 1 ? '' : 's'} · owner {entry.ownerName ?? 'unknown'}
                            </span>
                          </button>
                          {confirmRoom === entry.id ? (
                            <span className="room-row-confirm">
                              <button className="ghost-action danger" onClick={() => void removeRoom(entry)}>
                                {mine ? 'Delete' : 'Leave'}
                              </button>
                              <button className="link-btn" onClick={() => setConfirmRoom(null)}>
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="save-del"
                              title={mine ? 'Delete this room for everyone' : 'Leave this room'}
                              onClick={() => setConfirmRoom(entry.id)}
                            >
                              ✕
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {shownRooms.length === 0 ? (
                    <p className="drawer-empty">No {roomFilter} rooms right now.</p>
                  ) : null}
                </section>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
