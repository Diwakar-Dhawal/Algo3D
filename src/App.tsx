import { lazy, Suspense, useEffect, useState } from 'react';
import { CodeLab } from './CodeLab';
import { Show, SignInButton, UserButton } from '@clerk/react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { GoogleMark } from './auth/GoogleMark';
import { RoomsProvider, useRooms } from './rooms/RoomContext';
import { RoomsDrawer } from './rooms/RoomsDrawer';
import { ThemeProvider, ThemeToggle } from './theme/ThemeContext';
import { PaneBoundary } from './components/PaneBoundary';
import { ShortcutSheet } from './components/Shortcuts';

/** the library and the whiteboard (with excalidraw) only load when you open them */
const Library = lazy(() => import('./Library').then((mod) => ({ default: mod.Library })));
const Whiteboard = lazy(() => import('./board/Whiteboard').then((mod) => ({ default: mod.Whiteboard })));

function Account() {
  const { user, stats, loading, available } = useAuth();

  if (!available) return null;
  if (loading) return <div className="account is-idle" />;

  const name = user?.name ?? user?.email ?? '';
  return (
    <div className="account">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <span className="btn-google" title="Sign in with Google">
            <GoogleMark /> Sign in
          </span>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton appearance={{ elements: { userButtonAvatarBox: { width: '26px', height: '26px' } } }} />
        {name ? (
          <span className="account-name" title={user?.email ?? ''}>
            {name}
          </span>
        ) : null}
        {stats && stats.streak > 0 ? (
          <span className="account-streak" title={`${stats.streak}-day streak · ${stats.runsToday} runs today`}>
            🔥 {stats.streak}
          </span>
        ) : null}
      </Show>
    </div>
  );
}

function RoomsButton({ onOpen }: { onOpen: () => void }) {
  const { user, available } = useAuth();
  const { active } = useRooms();
  if (!available || !user) return null;
  return (
    <button
      className={`ghost-action rooms-btn ${active ? 'is-live' : ''}`}
      onClick={onOpen}
      title={active ? `In room “${active.room.name}”` : 'Collaborate in a room'}
    >
      {active ? `● ${active.room.name}` : 'Rooms'}
    </button>
  );
}

type Mode = 'code' | 'library' | 'board';
const MODE_KEY = 'algo3d:mode';

function readMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'library' || stored === 'board' || stored === 'code') return stored;
  } catch {
    /* storage blocked: start in the lab */
  }
  return 'code';
}

function Shell() {
  const [mode, setMode] = useState<Mode>(readMode);
  const [inviteCode] = useState(() => new URLSearchParams(window.location.search).get('room') ?? '');
  const [roomsOpen, setRoomsOpen] = useState(() => inviteCode.length > 0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { active } = useRooms();
  const roomId = active?.room.id ?? null;

  // joining a room takes you to the code lab, but a board you opened stays open
  useEffect(() => {
    if (roomId) setMode((now) => (now === 'library' ? 'code' : now));
  }, [roomId]);

  // the tab you were on survives a reload
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage blocked: the choice just does not persist */
    }
  }, [mode]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">A3</div>
          <div className="brand-text">
            <h1>Algo3D</h1>
            <p>Java, Python, JavaScript and C++, stepped through in three dimensions</p>
          </div>
        </div>

        <nav className="modes">
          <button className={`mode ${mode === 'code' ? 'on' : ''}`} onClick={() => setMode('code')}>
            <span className="mode-full">Your code</span>
            <span className="mode-short">Code</span>
          </button>
          <button className={`mode ${mode === 'library' ? 'on' : ''}`} onClick={() => setMode('library')}>
            <span className="mode-full">Algorithm library</span>
            <span className="mode-short">Library</span>
          </button>
          <button className={`mode ${mode === 'board' ? 'on' : ''}`} onClick={() => setMode('board')}>
            <span className="mode-full">Whiteboard</span>
            <span className="mode-short">Board</span>
          </button>
        </nav>

        <ThemeToggle />
        <button
          className="icon-btn help-btn"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => setShortcutsOpen(true)}
        >
          ?
        </button>
        <RoomsButton onOpen={() => setRoomsOpen(true)} />
        <Account />
      </header>

      <PaneBoundary label={mode === 'library' ? 'Library' : 'Whiteboard'} resetKey={mode}>
        {mode === 'code' ? (
          <CodeLab onOpenRooms={() => setRoomsOpen(true)} onOpenBoard={() => setMode('board')} />
        ) : (
          <Suspense
            fallback={
              <div className="mode-loading">
                <span className="spinner" aria-hidden="true" />
                <span>{mode === 'library' ? 'Loading the algorithm library…' : 'Loading the whiteboard…'}</span>
              </div>
            }
          >
            {mode === 'library' ? <Library /> : <Whiteboard />}
          </Suspense>
        )}
      </PaneBoundary>

      <RoomsDrawer open={roomsOpen} onClose={() => setRoomsOpen(false)} initialCode={inviteCode} />
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RoomsProvider>
          <Shell />
        </RoomsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
