import { useState } from 'react';
import { CodeLab } from './CodeLab';
import { Library } from './Library';
import { Show, SignInButton, UserButton } from '@clerk/react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { GoogleMark } from './auth/GoogleMark';

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

export default function App() {
  const [mode, setMode] = useState<'code' | 'library'>('code');

  return (
    <AuthProvider>
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
              Your code
            </button>
            <button className={`mode ${mode === 'library' ? 'on' : ''}`} onClick={() => setMode('library')}>
              Algorithm library
            </button>
          </nav>

          <Account />
        </header>

        {mode === 'code' ? <CodeLab /> : <Library />}
      </div>
    </AuthProvider>
  );
}
