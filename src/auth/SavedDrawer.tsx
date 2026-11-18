import { useEffect, useMemo, useState } from 'react';
import { SignInButton } from '@clerk/react';
import { authApi } from './api';
import type { Save } from './api';
import { useAuth } from './AuthContext';
import { GoogleMark } from './GoogleMark';

type Props = {
  open: boolean;
  onClose: () => void;
  current: { language: string; code: string; inputs: string };
  onLoad: (save: Save) => void;
};

const LANG_LABEL: Record<string, string> = {
  java: 'Java',
  python: 'Python',
  javascript: 'JavaScript',
  cpp: 'C++',
};

function when(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SavedDrawer({ open, onClose, current, onLoad }: Props) {
  const { user, stats, available, setStats } = useAuth();
  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [onlyStars, setOnlyStars] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle((prev) => prev || `${LANG_LABEL[current.language] ?? current.language} · ${new Date().toLocaleDateString()}`);
    if (!user) {
      setSaves([]);
      return;
    }
    let live = true;
    setLoading(true);
    void authApi.list().then((result) => {
      if (!live) return;
      setLoading(false);
      if (result) setSaves(result.saves);
      else setNote('Could not load your programs — try again.');
    });
    return () => {
      live = false;
    };
  }, [open, user, current.language]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const shown = useMemo(() => (onlyStars ? saves.filter((save) => save.favorite) : saves), [saves, onlyStars]);

  if (!open) return null;

  const saveCurrent = async () => {
    setBusy('new');
    setNote(null);
    const result = await authApi.create({
      title: title.trim() || 'Untitled program',
      language: current.language,
      code: current.code,
      inputs: current.inputs,
    });
    setBusy(null);
    if (!result) {
      setNote('Could not save — are you still signed in?');
      return;
    }
    setSaves((prev) => [result.save, ...prev]);
    setTitle('');
    setStats(stats ? { ...stats, saves: stats.saves + 1 } : stats);
    setNote('Saved.');
  };

  const toggleStar = async (save: Save) => {
    setBusy(save.id);
    const result = await authApi.update(save.id, { favorite: !save.favorite });
    setBusy(null);
    if (!result) {
      setNote('Could not update that program.');
      return;
    }
    setSaves((prev) => prev.map((item) => (item.id === save.id ? result.save : item)));
    if (stats) {
      const delta = result.save.favorite ? 1 : -1;
      setStats({ ...stats, favorites: Math.max(0, stats.favorites + delta) });
    }
  };

  const remove = async (save: Save) => {
    if (!window.confirm(`Delete “${save.title}”?`)) return;
    setBusy(save.id);
    const result = await authApi.remove(save.id);
    setBusy(null);
    if (!result) {
      setNote('Could not delete that program.');
      return;
    }
    setSaves((prev) => prev.filter((item) => item.id !== save.id));
    setStats(
      stats
        ? { ...stats, saves: Math.max(0, stats.saves - 1), favorites: Math.max(0, stats.favorites - (save.favorite ? 1 : 0)) }
        : stats
    );
  };

  return (
    <div className="drawer-scrim" onClick={onClose} role="presentation">
      <aside className="drawer" role="dialog" aria-label="Saved programs" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">Library</span>
            <h2>Saved programs</h2>
          </div>
          <button className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {!available ? (
          <p className="drawer-empty">
            Accounts are not reachable from this build. Run <code>npx vercel dev</code> for local API access, or open
            the deployed site.
          </p>
        ) : !user ? (
          <div className="drawer-empty">
            <p>Sign in with Google to save programs across devices and star your favourites.</p>
            <SignInButton mode="modal">
              <span className="btn-google">
                <GoogleMark /> Continue with Google
              </span>
            </SignInButton>
          </div>
        ) : (
          <>
            <div className="drawer-save">
              <input
                className="drawer-input"
                value={title}
                placeholder="Name this program"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveCurrent();
                }}
              />
              <button className="btn-gold" onClick={saveCurrent} disabled={busy === 'new'}>
                {busy === 'new' ? 'Saving…' : 'Save current'}
              </button>
            </div>

            <div className="drawer-tabs">
              <button className={`chip ${onlyStars ? '' : 'on'}`} onClick={() => setOnlyStars(false)}>
                All {saves.length}
              </button>
              <button className={`chip ${onlyStars ? 'on' : ''}`} onClick={() => setOnlyStars(true)}>
                ★ Favourites {saves.filter((save) => save.favorite).length}
              </button>
            </div>

            {note ? <p className="drawer-note">{note}</p> : null}

            {loading ? (
              <p className="drawer-empty">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="drawer-empty">
                {onlyStars ? 'No favourites yet — tap the ☆ on a program.' : 'Nothing saved yet. Edit some code and press “Save current”.'}
              </p>
            ) : (
              <ul className="save-list">
                {shown.map((save) => (
                  <li key={save.id} className={busy === save.id ? 'is-busy' : ''}>
                    <button
                      className={`star ${save.favorite ? 'on' : ''}`}
                      onClick={() => void toggleStar(save)}
                      title={save.favorite ? 'Remove from favourites' : 'Add to favourites'}
                    >
                      {save.favorite ? '★' : '☆'}
                    </button>
                    <button className="save-main" onClick={() => onLoad(save)} title="Open in the editor">
                      <span className="save-title">{save.title}</span>
                      <span className="save-meta">
                        {LANG_LABEL[save.language] ?? save.language} · {when(save.updatedAt)} · {save.code.split('\n').length} lines
                      </span>
                    </button>
                    <button className="save-del" onClick={() => void remove(save)} title="Delete">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

