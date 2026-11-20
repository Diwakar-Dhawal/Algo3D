import { useEffect, useMemo, useState } from 'react';
import { SignInButton } from '@clerk/react';
import { authApi } from './api';
import type { Save } from './api';
import { useAuth } from './AuthContext';
import { AccountsNotice } from './AccountsNotice';
import { GoogleMark } from './GoogleMark';
import type { BoardElement } from '../board/elements';
import { readPersonalBoard } from '../board/storage';
import { addLocalSave, isLocalSave, localSaves, removeLocalSave, updateLocalSave } from '../saves/local';
import { MAX_TAGS, PRESET_TAGS, addTag, normaliseTag, tagCounts, toggleTag } from '../saves/tags';

type Props = {
  open: boolean;
  onClose: () => void;
  current: { language: string; code: string; inputs: string };
  onLoad: (save: Save) => void;
  /** so the editor can stop pointing at the program it had open */
  onDeleted?: (id: number) => void;
};

const LANG_LABEL: Record<string, string> = {
  java: 'Java',
  python: 'Python',
  javascript: 'JavaScript',
  cpp: 'C++',
};

/** the extension the language would really use on disk */
const LANG_EXT: Record<string, string> = {
  java: 'java',
  python: 'py',
  javascript: 'js',
  cpp: 'cpp',
};

/** `Two Sum` in Python becomes `Two-Sum.py`, safe on every filesystem */
function fileName(save: Save): string {
  const base = save.title
    // a date in the title is common ("Java · 11/21/2026"): slashes become dashes
    // rather than disappearing into "Java-11212026"
    .replace(/[/\\:]+/g, '-')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
  return `${base || 'program'}.${LANG_EXT[save.language] ?? 'txt'}`;
}

/** a save you can keep outside this app: the const program as a real source file */
function downloadSave(save: Save): void {
  const url = URL.createObjectURL(new Blob([save.code], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(save);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // the download starts from the href; revoking straight away can cancel it
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

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

/**
 * Tags for one program: the common topics one click away, plus a field for a
 * tag of your own ("my-revision", "interview-prep").
 */
function TagPicker({ value, onChange, id }: { value: string[]; onChange: (next: string[]) => void; id: string }) {
  const [custom, setCustom] = useState('');
  const commit = () => {
    const next = addTag(value, custom);
    setCustom('');
    if (next.length !== value.length) onChange(next);
  };
  const full = value.length >= MAX_TAGS;

  return (
    <div className="tag-picker">
      <div className="tag-row" role="group" aria-label="Tags">
        {PRESET_TAGS.map((tag) => {
          const on = value.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`tag-chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(toggleTag(value, tag))}
            >
              {tag}
            </button>
          );
        })}
        {value
          .filter((tag) => !PRESET_TAGS.includes(tag))
          .map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-chip on is-own"
              title="Remove this tag"
              onClick={() => onChange(value.filter((item) => item !== tag))}
            >
              {tag} ✕
            </button>
          ))}
      </div>
      <div className="tag-add">
        <input
          id={`${id}-tag`}
          className="drawer-input"
          value={custom}
          placeholder={full ? `up to ${MAX_TAGS} tags` : 'Your own tag'}
          disabled={full}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" className="ghost-action" onClick={commit} disabled={full || !normaliseTag(custom)}>
          Add
        </button>
      </div>
    </div>
  );
}

export function SavedDrawer({ open, onClose, current, onLoad, onDeleted }: Props) {
  const { user, stats, available, setStats } = useAuth();
  const [saves, setSaves] = useState<Save[]>([]);
  /** programs saved on this device by a signed-out visitor */
  const [local, setLocal] = useState<Save[]>(() => localSaves());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /** tags for the program about to be saved */
  const [tags, setTags] = useState<string[]>([]);
  const [onlyStars, setOnlyStars] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', tags: [] as string[] });
  /** the private whiteboard as it stands when the drawer opens */
  const [drawing, setDrawing] = useState<BoardElement[]>([]);
  const [withBoard, setWithBoard] = useState(false);

  useEffect(() => {
    if (!open) return;
    const snapshot = readPersonalBoard(user?.id ?? null);
    setDrawing(snapshot);
    setWithBoard(snapshot.length > 0);
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;
    setTitle((prev) => prev || `${LANG_LABEL[current.language] ?? current.language} · ${new Date().toLocaleDateString()}`);
    // device-only programs are always there, signed in or not
    setLocal(localSaves());
    if (!user) {
      setSaves([]);
      setLoading(false);
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

  const all = useMemo(() => [...local, ...saves], [local, saves]);

  /** every tag in use, busiest first, for the filter row */
  const availableTags = useMemo(() => tagCounts(all), [all]);

  const shown = useMemo(() => {
    const starred = onlyStars ? all.filter((save) => save.favorite) : all;
    const tagged = tagFilter ? starred.filter((save) => (save.tags ?? []).includes(tagFilter)) : starred;
    const needle = query.trim().toLowerCase();
    if (!needle) return tagged;
    return tagged.filter((save) =>
      `${save.title} ${save.description ?? ''} ${LANG_LABEL[save.language] ?? save.language} ${(save.tags ?? []).join(' ')}`
        .toLowerCase()
        .includes(needle)
    );
  }, [all, onlyStars, tagFilter, query]);

  if (!open) return null;

  const saveCurrent = async () => {
    setBusy('new');
    setNote(null);
    // without an account the program stays in this browser; the strip at the top
    // of the drawer says so on every visit
    if (!user) {
      const created = addLocalSave({
        title: title.trim() || 'Untitled program',
        description: description.trim(),
        language: current.language,
        code: current.code,
        inputs: current.inputs,
        favorite: false,
        tags,
      });
      setBusy(null);
      if (!created) {
        setNote('This browser refused the save — storage may be full or blocked.');
        return;
      }
      setLocal(localSaves());
      setTitle('');
      setDescription('');
      setTags([]);
      setNote('Saved on this device.');
      return;
    }
    const result = await authApi.create({
      title: title.trim() || 'Untitled program',
      description: description.trim(),
      language: current.language,
      code: current.code,
      inputs: current.inputs,
      board: withBoard && drawing.length ? drawing : undefined,
      tags,
    });
    setBusy(null);
    if (!result) {
      setNote('Could not save — are you still signed in?');
      return;
    }
    setSaves((prev) => [result.save, ...prev]);
    setTitle('');
    setDescription('');
    setTags([]);
    setStats(stats ? { ...stats, saves: stats.saves + 1 } : stats);
    setNote(withBoard && drawing.length ? 'Saved with your drawing.' : 'Saved.');
  };

  const startEdit = (save: Save) => {
    setEditing(save.id);
    setDraft({ title: save.title, description: save.description ?? '', tags: save.tags ?? [] });
    setNote(null);
  };

  const commitEdit = async (save: Save) => {
    setBusy(save.id);
    if (isLocalSave(save)) {
      const next = updateLocalSave(save.id, {
        title: draft.title.trim() || 'Untitled program',
        description: draft.description.trim(),
        tags: draft.tags,
      });
      setBusy(null);
      if (!next) setNote('Could not update that program.');
      else {
        setLocal(localSaves());
        setEditing(null);
      }
      return;
    }
    const result = await authApi.update(save.id, {
      title: draft.title.trim() || 'Untitled program',
      description: draft.description.trim(),
      tags: draft.tags,
    });
    setBusy(null);
    if (!result) {
      setNote('Could not update that program.');
      return;
    }
    setSaves((prev) => prev.map((item) => (item.id === save.id ? result.save : item)));
    setEditing(null);
  };

  const toggleStar = async (save: Save) => {
    setBusy(save.id);
    if (isLocalSave(save)) {
      const next = updateLocalSave(save.id, { favorite: !save.favorite });
      setBusy(null);
      if (!next) setNote('Could not update that program.');
      else setLocal(localSaves());
      return;
    }
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
    if (isLocalSave(save)) {
      const ok = removeLocalSave(save.id);
      setBusy(null);
      if (!ok) {
        setNote('Could not delete that program.');
        return;
      }
      setLocal(localSaves());
      onDeleted?.(save.id);
      return;
    }
    const result = await authApi.remove(save.id);
    setBusy(null);
    if (!result) {
      setNote('Could not delete that program.');
      return;
    }
    setSaves((prev) => prev.filter((item) => item.id !== save.id));
    onDeleted?.(save.id);
    setStats(
      stats
        ? { ...stats, saves: Math.max(0, stats.saves - 1), favorites: Math.max(0, stats.favorites - (save.favorite ? 1 : 0)) }
        : stats
    );
  };

  return (
    <div className="drawer-scrim" onClick={onClose} role="presentation">
      <aside className="drawer" role="dialog" aria-label="Saved codes" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">Your library</span>
            <h2>Saved codes</h2>
          </div>
          <button className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {!available ? <AccountsNotice kind="library" /> : null}

        {!user ? (
          <div className="drawer-device">
            <p>
              <b>Saved on this device only.</b> These programs live in this browser — clearing site data or signing in
              on another computer will not bring them along.
            </p>
            {available ? (
              <SignInButton mode="modal">
                <span className="btn-google">
                  <GoogleMark /> Sign in to sync
                </span>
              </SignInButton>
            ) : null}
          </div>
        ) : null}

        <>
            <div className="drawer-save">
              <span className="eyebrow">Save the code in the editor</span>
              <input
                className="drawer-input"
                value={title}
                placeholder="Name this program"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveCurrent();
                }}
              />
              <textarea
                className="drawer-desc"
                rows={2}
                value={description}
                placeholder="Description — what does it do, what should the reader notice? (optional)"
                onChange={(event) => setDescription(event.target.value)}
              />
              <label className="pop-check">
                <input
                  type="checkbox"
                  checked={withBoard}
                  disabled={drawing.length === 0}
                  onChange={(event) => setWithBoard(event.target.checked)}
                />
                <span>
                  Include my whiteboard
                  {drawing.length ? ` · ${drawing.length} shapes` : ' · nothing drawn yet'}
                </span>
              </label>
              <TagPicker id="new-save" value={tags} onChange={setTags} />
              <button className="btn-gold" onClick={saveCurrent} disabled={busy === 'new'}>
                {busy === 'new' ? 'Saving…' : 'Save current'}
              </button>
            </div>

            <div className="drawer-tabs">
              <button className={`chip ${onlyStars ? '' : 'on'}`} onClick={() => setOnlyStars(false)}>
                All {all.length}
              </button>
              <button className={`chip ${onlyStars ? 'on' : ''}`} onClick={() => setOnlyStars(true)}>
                ★ Favourites {all.filter((save) => save.favorite).length}
              </button>
            </div>

            {all.length > 0 ? (
              <input
                className="drawer-input drawer-search"
                type="search"
                value={query}
                placeholder="Search titles, descriptions, tags"
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : null}

            {availableTags.length > 0 ? (
              <div className="drawer-tabs tag-filter" role="group" aria-label="Filter by tag">
                <button className={`chip ${tagFilter === null ? 'on' : ''}`} onClick={() => setTagFilter(null)}>
                  All tags
                </button>
                {availableTags.map(({ tag, count }) => (
                  <button
                    key={tag}
                    className={`chip ${tagFilter === tag ? 'on' : ''}`}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  >
                    {tag} <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {note ? <p className="drawer-note">{note}</p> : null}

            {loading ? (
              <p className="drawer-empty drawer-loading">
                <span className="spinner" aria-hidden="true" />
                Loading your saved codes…
              </p>
            ) : shown.length === 0 ? (
              <p className="drawer-empty">
                {query.trim()
                  ? `No saved programs match “${query.trim()}”.`
                  : onlyStars
                    ? 'No favourites yet — tap the ☆ on a program.'
                    : 'Nothing saved yet. Edit some code and press “Save current”.'}
              </p>
            ) : (
              <ul className="save-list">
                {shown.map((save) =>
                  editing === save.id ? (
                    <li key={save.id} className={`save-edit-item ${busy === save.id ? 'is-busy' : ''}`}>
                      <input
                        className="drawer-input"
                        value={draft.title}
                        placeholder="Name"
                        onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                      />
                      <textarea
                        className="drawer-desc"
                        rows={2}
                        value={draft.description}
                        placeholder="Description (optional)"
                        onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                      />
                      <TagPicker
                        id={`edit-${save.id}`}
                        value={draft.tags}
                        onChange={(next) => setDraft((prev) => ({ ...prev, tags: next }))}
                      />
                      <div className="save-edit-actions">
                        <button className="btn-gold" onClick={() => void commitEdit(save)} disabled={busy === save.id}>
                          Save
                        </button>
                        <button className="ghost-action" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </li>
                  ) : (
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
                        {save.description ? <span className="save-desc">{save.description}</span> : null}
                        <span className="save-meta">
                          {LANG_LABEL[save.language] ?? save.language} · {when(save.updatedAt)} ·{' '}
                          {save.code.split('\n').length} lines
                        </span>
                        {(save.tags ?? []).length ? (
                          <span className="save-tags">
                            {(save.tags ?? []).slice(0, 4).map((tag) => (
                              <span className="save-tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                            {(save.tags ?? []).length > 4 ? (
                              <span className="save-tag">+{(save.tags ?? []).length - 4}</span>
                            ) : null}
                          </span>
                        ) : null}
                        {isLocalSave(save) ? (
                          <span className="save-local" title="Stored in this browser only">
                            this device
                          </span>
                        ) : null}
                        {save.board?.length ? (
                          <span className="save-board" title="Saved with a whiteboard drawing">
                            ✏ {save.board.length} shapes
                          </span>
                        ) : null}
                      </button>
                      <button
                        className="save-edit"
                        onClick={() => downloadSave(save)}
                        title={`Download ${fileName(save)}`}
                      >
                        ⤓
                      </button>
                      <button className="save-edit" onClick={() => startEdit(save)} title="Edit name and description">
                        ✎
                      </button>
                      <button className="save-del" onClick={() => void remove(save)} title="Delete">
                        ✕
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
        </>
      </aside>
    </div>
  );
}
