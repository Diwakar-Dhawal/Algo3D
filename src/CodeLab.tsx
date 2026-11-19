import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, langById, runIn, sampleCode } from './lang';
import { formatInputs, suggestInputs } from './lang/inputs';
import type { LangId } from './lang/types';
import type { Trace } from './jvm/types';
import { MemoryStage } from './memory/MemoryStage';
import { valText } from './memory/layout';
import { Editor } from './components/Editor';
import { StepLog, type LogEntry } from './components/StepLog';
import { panelVars, startResize, syncCanvases } from './components/panels';
import type { Selected } from './topics/types';
import { useAuth } from './auth/AuthContext';
import { SavedDrawer } from './auth/SavedDrawer';
import { authApi } from './auth/api';
import type { Save } from './auth/api';
import { readPersonalBoard, writePersonalBoard } from './board/storage';
import type { BoardElement } from './board/elements';
import { useRooms } from './rooms/RoomContext';
import { roleLabel } from './rooms/roles';
import { setRoomSeed } from './rooms/seed';

const BASE_MS = 620;

/**
 * The clipboard API can hang or reject (insecure context, denied permission), so
 * give it a deadline and fall back to the old selection trick.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('clipboard timeout')), 1200)),
    ]);
    return true;
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function inputsFor(language: LangId, source: string): string {
  const suggestion = suggestInputs(language, source);
  return formatInputs(suggestion.values, suggestion.call);
}

type LabMemory = { code: Record<string, string>; inputs: Record<string, string>; sample: Record<string, string> };
type LabView = 'code' | 'visual' | 'panels';
type Saved = LabMemory & {
  lang: LangId;
  left: number;
  right: number;
  leftHidden: boolean;
  rightHidden: boolean;
  view: LabView;
};

const VIEWS: { id: LabView; label: string }[] = [
  { id: 'code', label: 'Code' },
  { id: 'visual', label: 'Visualizer' },
  { id: 'panels', label: 'Panels' },
];

const STORE_KEY = 'algo3d.lab.v2';

function loadSaved(): Partial<Saved> | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : null;
  } catch {
    return null;
  }
}

/** one buffer per language, so switching back never loses your edits */
function freshMemory(saved: Partial<Saved> | null): LabMemory {
  const memory: LabMemory = { code: {}, inputs: {}, sample: {} };
  for (const def of LANGS) {
    const source = saved?.code?.[def.id] ?? sampleCode(def.id, def.defaultSample);
    memory.code[def.id] = source;
    memory.sample[def.id] = saved?.sample?.[def.id] ?? def.defaultSample;
    memory.inputs[def.id] = saved?.inputs?.[def.id] ?? inputsFor(def.id, source);
  }
  return memory;
}

const KIND_LABEL: Record<string, string> = {
  call: 'call',
  return: 'return',
  stmt: 'step',
  write: 'write',
  error: 'error',
  end: 'end',
};

export function CodeLab({
  onOpenRooms,
  onOpenBoard,
}: { onOpenRooms?: () => void; onOpenBoard?: () => void } = {}) {
  const [boot] = useState(() => {
    const saved = loadSaved();
    // below the breakpoint the panels are tabs, so a saved collapse state would hide them
    const narrow = window.innerWidth <= 1080;
    return {
      saved,
      narrow,
      memory: freshMemory(saved),
      lang: saved?.lang ?? ('java' as LangId),
      view: saved?.view ?? ('visual' as LabView),
    };
  });

  const [view, setView] = useState<LabView>(boot.view);

  const [memory, setMemory] = useState<LabMemory>(boot.memory);
  const [lang, setLang] = useState<LangId>(boot.lang);
  const langDef = langById(lang);
  const sampleId = memory.sample[lang];
  const code = memory.code[lang];
  const inputs = memory.inputs[lang];
  // once the buffer drifts from the picked sample the select must say so
  const chosenSample = langDef.samples.find((option) => option.id === sampleId);
  const isCustom = !chosenSample || chosenSample.code !== code;
  const [inputsDirty, setInputsDirty] = useState(false);
  const [trace, setTrace] = useState<Trace>(() => runIn(boot.lang, boot.memory.code[boot.lang], boot.memory.inputs[boot.lang]));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [left, setLeft] = useState(() => boot.saved?.left ?? (window.innerWidth < 1440 ? 320 : 384));
  const [right, setRight] = useState(() => boot.saved?.right ?? (window.innerWidth < 1440 ? 288 : 328));
  const [leftHidden, setLeftHidden] = useState(() => (boot.narrow ? false : (boot.saved?.leftHidden ?? false)));
  const [rightHidden, setRightHidden] = useState(() => (boot.narrow ? false : (boot.saved?.rightHidden ?? false)));

  const { user, stats, recordRun, setStats } = useAuth();
  const [savesOpen, setSavesOpen] = useState(false);

  // ---- shared room -------------------------------------------------------
  const rooms = useRooms();
  const roomSession = rooms.active;
  const inRoom = Boolean(roomSession);
  const roomState = roomSession?.state ?? null;
  const meId = user?.id ?? 0;
  const driverId = roomState?.driver?.userId ?? null;
  const mayEdit = !inRoom || rooms.can('editCode');
  const mayRun = !inRoom || rooms.can('runCode');
  const mayDrive = !inRoom || rooms.can('driveTrace');
  // one editor types at a time: the room hands out a short lease
  const typingLocked = inRoom && mayEdit && driverId !== null && driverId !== meId;
  const canType = mayEdit && !typingLocked;
  const driverName = driverId
    ? roomSession?.members.find((member) => member.userId === driverId)?.name ?? 'Another editor'
    : '';
  /** the saved program behind the current buffer, so it can be starred in place */
  const [loaded, setLoaded] = useState<Save | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [favouriteNew, setFavouriteNew] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickNote, setQuickNote] = useState<string | null>(null);
  /** the private whiteboard, captured when the save dialog opens */
  const [quickBoard, setQuickBoard] = useState<BoardElement[]>([]);
  const [includeBoard, setIncludeBoard] = useState(false);
  const [boardNote, setBoardNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    const text = code;
    const copiedOk = await writeClipboard(text);
    if (!copiedOk) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const openQuickSave = () => {
    if (!user) {
      setSavesOpen(true);
      return;
    }
    setDraftTitle(`${langDef.label} · ${new Date().toLocaleDateString()}`);
    setDraftDesc('');
    setFavouriteNew(loaded?.favorite ?? false);
    setQuickNote(null);
    const drawing = readPersonalBoard(user?.id ?? null);
    setQuickBoard(drawing);
    setIncludeBoard(drawing.length > 0);
    setBoardNote(null);
    setSaveOpen(true);
  };

  const saveQuick = async () => {
    if (!user) return;
    setQuickBusy(true);
    setQuickNote(null);
    const result = await authApi.create({
      title: draftTitle.trim() || 'Untitled program',
      description: draftDesc.trim(),
      language: lang,
      code,
      inputs,
      favorite: favouriteNew,
      board: includeBoard && quickBoard.length ? quickBoard : undefined,
    });
    setQuickBusy(false);
    if (!result) {
      setQuickNote('Could not save — try again.');
      return;
    }
    setLoaded(result.save);
    setSaveOpen(false);
    setStats(
      stats
        ? { ...stats, saves: stats.saves + 1, favorites: stats.favorites + (result.save.favorite ? 1 : 0) }
        : stats
    );
  };

  /** stars the program that is currently open, without going through the drawer */
  const starLoaded = async () => {
    if (!loaded) return;
    const next = !loaded.favorite;
    setLoaded({ ...loaded, favorite: next });
    const result = await authApi.update(loaded.id, { favorite: next });
    if (!result) {
      setLoaded(loaded);
      return;
    }
    setLoaded(result.save);
    if (stats) setStats({ ...stats, favorites: Math.max(0, stats.favorites + (next ? 1 : -1)) });
  };

  const openSave = (save: Save) => {
    const target = save.language as LangId;
    setLang(target);
    setInputsDirty(true);
    remember(target, { code: save.code, inputs: save.inputs });
    setLoaded(save);
    setSavesOpen(false);
    run(save.code, target, save.inputs);
    // the drawing that travelled with the program comes back onto the board
    if (save.board && save.board.length) {
      writePersonalBoard(user?.id ?? null, save.board);
      setBoardNote(`Drawing restored (${save.board.length} shapes)`);
    } else {
      setBoardNote(null);
    }
  };

  const remember = (language: LangId, patch: Partial<{ code: string; inputs: string; sample: string }>) => {
    setMemory((prev) => ({
      code: patch.code === undefined ? prev.code : { ...prev.code, [language]: patch.code },
      inputs: patch.inputs === undefined ? prev.inputs : { ...prev.inputs, [language]: patch.inputs },
      sample: patch.sample === undefined ? prev.sample : { ...prev.sample, [language]: patch.sample },
    }));
  };

  const editCode = (next: string) => {
    if (!canType) return;
    const patch = { code: next, ...(inputsDirty ? {} : { inputs: inputsFor(lang, next) }) };
    remember(lang, patch);
    if (inRoom) rooms.push(patch);
  };

  // the rooms panel seeds a new room from whatever is on screen
  useEffect(() => {
    setRoomSeed({ language: lang, code, inputs });
  }, [lang, code, inputs]);

  // adopt the shared program whenever the room moves on (someone typed, ran or scrubbed)
  const appliedRoomId = useRef<number | null>(null);
  const appliedRoomVersion = useRef(0);

  useEffect(() => {
    const session = roomSession;
    const shared = roomState;
    if (!session || !shared) {
      appliedRoomId.current = null;
      appliedRoomVersion.current = 0;
      return;
    }
    if (appliedRoomId.current !== session.room.id) {
      appliedRoomId.current = session.room.id;
      appliedRoomVersion.current = 0;
    }
    if (shared.version <= appliedRoomVersion.current) return;
    appliedRoomVersion.current = shared.version;

    const target = (LANGS.some((def) => def.id === shared.language) ? shared.language : 'java') as LangId;
    setLang(target);
    setInputsDirty(true);
    remember(target, { code: shared.code, inputs: shared.inputs });
    setTrace(runIn(target, shared.code, shared.inputs));
    setIndex(shared.index);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomSession?.room.id, roomState?.version]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...memory, lang, left, right, leftHidden, rightHidden, view }));
    } catch {
      // private mode or blocked storage: the lab still works, it just forgets on reload
    }
  }, [memory, lang, left, right, leftHidden, rightHidden, view]);

  const toggleLeft = () => {
    setLeftHidden((value) => !value);
    syncCanvases();
  };
  const toggleRight = () => {
    setRightHidden((value) => !value);
    syncCanvases();
  };
  const outputRef = useRef<HTMLPreElement>(null);
  const stageOutRef = useRef<HTMLDivElement>(null);

  const steps = trace.steps;
  const total = steps.length;
  const safe = Math.min(index, Math.max(0, total - 1));
  const step = steps[safe];
  const atStart = safe <= 0;
  const atEnd = safe >= total - 1;

  /** move the playhead; in a room the step is shared, so the change is pushed */
  const syncStep = (next: number) => {
    if (!mayDrive) return;
    const clamped = Math.max(0, Math.min(total - 1, next));
    setPlaying(false);
    setIndex(clamped);
    if (inRoom) rooms.push({ index: clamped });
  };

  const run = (source: string, language: LangId = lang, box = inputs) => {
    if (!mayRun) return;
    recordRun();
    const next = runIn(language, source, box);
    setTrace(next);
    setIndex(0);
    setPlaying(false);
    setSelected(null);
    // show the result straight away instead of leaving the user on the editor
    setView('visual');
    // send the program along with the playhead, so joiners rebuild the trace
    // from the code that was actually run rather than a stale copy
    if (inRoom) rooms.push({ ...(mayEdit ? { language, code: source, inputs: box } : {}), index: 0 });
  };

  useEffect(() => {
    if (!playing || !step) return;
    if (atEnd) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      const nextIndex = safe + 1;
      setIndex(nextIndex);
      if (breakpoints.has(steps[nextIndex]?.line ?? -1)) setPlaying(false);
    }, BASE_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, safe, atEnd, speed, steps, breakpoints, step]);

  useEffect(() => {
    for (const node of [outputRef.current, stageOutRef.current]) {
      if (node) node.scrollTop = node.scrollHeight;
    }
  }, [step?.stdout]);

  // make sure the canvas measures itself once the panel grid has settled
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S saves from anywhere, including inside the editor
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saveOpen) openQuickSave();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          run(code);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run(code);
        return;
      }
      if (!mayDrive) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        syncStep(safe + 1);
      } else if (e.key === 'ArrowLeft') {
        syncStep(safe - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const runToBreakpoint = () => {
    if (!mayDrive) return;
    for (let i = safe + 1; i < total; i++) {
      if (breakpoints.has(steps[i].line)) {
        syncStep(i);
        return;
      }
    }
    syncStep(Math.max(0, total - 1));
  };

  const pickSample = (id: string) => {
    if (!canType) return;
    const sample = langDef.samples.find((s) => s.id === id);
    if (!sample) return;
    const next = inputsFor(lang, sample.code);
    setInputsDirty(false);
    remember(lang, { code: sample.code, inputs: next, sample: id });
    setBreakpoints(new Set());
    if (inRoom) rooms.push({ language: lang, code: sample.code, inputs: next });
    run(sample.code, lang, next);
  };

  const pickLang = (id: LangId) => {
    if (!canType) return;
    // each language keeps its own buffer, so switching back restores your work
    const source = memory.code[id];
    const box = memory.inputs[id];
    setLang(id);
    setInputsDirty(false);
    setBreakpoints(new Set());
    if (inRoom) rooms.push({ language: id, code: source, inputs: box });
    run(source, id, box);
  };

  const logEntries = useMemo<LogEntry[]>(() => {
    return steps.slice(0, safe + 1).map((entry) => ({
      note: entry.note,
      line: entry.line,
      changes: entry.effects.map((effect) => {
        const target = entry.heap.find((obj) => obj.id === effect.to.obj);
        const base = target?.label ?? `@${effect.to.obj}`;
        const label =
          effect.to.index !== undefined
            ? `${base}[${effect.to.index}]`
            : effect.to.field
              ? `${base}.${effect.to.field}`
              : base;
        return {
          label,
          from: effect.prev ? valText(effect.prev) : undefined,
          to: valText(effect.value),
        };
      }),
    }));
  }, [steps, safe]);

  const problem = trace.compileError
    ? { title: `Compile error · line ${trace.compileError.line}`, message: trace.compileError.message }
    : trace.error
      ? { title: 'Runtime error', message: trace.error }
      : null;

  return (
    <>
      {roomSession ? (
        <div className="room-strip">
          <span className={`room-live ${rooms.connected ? 'on' : ''}`} title={rooms.connected ? 'Live' : 'Reconnecting'} />
          <b>{roomSession.room.name}</b>
          <span className="room-chip">{roleLabel(roomSession.room.role)}</span>
          <span className="room-strip-note">
            {typingLocked
              ? `✎ ${driverName} is editing`
              : roomSession.room.role === 'viewer'
                ? 'Watching — the editors control the code and the trace'
                : 'Shared session — your changes land for everyone'}
          </span>
          {rooms.notice ? <span className="room-strip-note warn">{rooms.notice}</span> : null}
          {typingLocked ? (
            <button className="ghost-action" onClick={() => rooms.push({ code, takeover: true })}>
              Take over
            </button>
          ) : null}
          <span className="room-strip-members">
            {roomSession.members.filter((member) => member.online).length} online
          </span>
          {onOpenRooms ? (
            <button className="ghost-action" onClick={onOpenRooms}>
              Members
            </button>
          ) : null}
          <button className="link-btn" onClick={() => void rooms.leaveRoom()}>
            Leave
          </button>
        </div>
      ) : null}

      <main
        className="lab"
        data-view={view}
        style={panelVars({
          '--left-w': `${leftHidden ? 44 : left}px`,
          '--right-w': `${rightHidden ? 44 : right}px`,
        })}
      >
      <div className="mtabs" role="tablist" aria-label="Lab panes">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            role="tab"
            aria-selected={view === option.id}
            className={`mtab ${view === option.id ? 'on' : ''}`}
            onClick={() => setView(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section className={`editor-panel ${leftHidden ? 'is-collapsed' : ''}`}>
        {leftHidden ? (
          <button className="panel-stub" onClick={toggleLeft} title="Show source">
            <span>›</span>
            <i>Source</i>
          </button>
        ) : (
          <>
        <div className="panel-head">
          <span className="eyebrow">Source</span>
          <div className="head-actions">
            <select
              className="minimal-select lang-select"
              value={lang}
              disabled={!canType}
              onChange={(e) => pickLang(e.target.value as LangId)}
              title={canType ? 'Language' : 'Your role cannot change the code'}
            >
              {LANGS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="minimal-select"
              value={isCustom ? 'custom' : sampleId}
              disabled={!canType}
              onChange={(e) => {
                if (e.target.value !== 'custom') pickSample(e.target.value);
              }}
              title={isCustom ? 'This buffer no longer matches a sample' : 'Load a sample program'}
            >
              {isCustom ? <option value="custom">Custom</option> : null}
              {langDef.samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              className="ghost-action"
              onClick={() => setSavesOpen(true)}
              title={user ? 'Open your saved codes and favourites' : 'Sign in to save codes'}
            >
              ★ Saved codes
            </button>
            <button className="panel-collapse" onClick={toggleLeft} title="Collapse source">
              ‹
            </button>
          </div>
        </div>

        <p className="lang-note" title={langDef.subset}>
          <b>{langDef.file}</b> · {langDef.subset}
        </p>

        <Editor
          code={code}
          onChange={editCode}
          activeLine={step?.line ?? 0}
          breakpoints={breakpoints}
          onToggleBreakpoint={toggleBreakpoint}
          lang={lang}
          readOnly={!canType}
        />

        <div className="panel-foot">
          <button className="btn-gold" onClick={() => run(code)}>
            Run ▸
          </button>

          <div className="save-wrap">
            <button
              className="ghost-action save-btn"
              onClick={() => (saveOpen ? setSaveOpen(false) : openQuickSave())}
              title={user ? 'Save this code — name, description, drawing (⌘/Ctrl + S)' : 'Sign in to save codes'}
            >
              Save
            </button>
            {saveOpen && user ? (
              <>
                <div className="save-pop-scrim" onClick={() => setSaveOpen(false)} role="presentation" />
                <div className="save-pop" role="dialog" aria-label="Save this code">
                  <label className="pop-field">
                    <span>Name</span>
                    <input
                      className="drawer-input"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveQuick();
                      }}
                    />
                  </label>
                  <label className="pop-field">
                    <span>Description <i>optional</i></span>
                    <textarea
                      className="drawer-desc"
                      rows={3}
                      value={draftDesc}
                      placeholder="What does this code do?"
                      onChange={(event) => setDraftDesc(event.target.value)}
                    />
                  </label>
                  <label className="pop-check">
                    <input
                      type="checkbox"
                      checked={includeBoard}
                      disabled={quickBoard.length === 0}
                      onChange={(event) => setIncludeBoard(event.target.checked)}
                    />
                    <span>
                      Include my whiteboard
                      {quickBoard.length ? ` · ${quickBoard.length} shapes` : ' · nothing drawn yet'}
                    </span>
                  </label>
                  <div className="pop-row">
                    <button
                      className={`pop-star ${favouriteNew ? 'on' : ''}`}
                      onClick={() => setFavouriteNew((value) => !value)}
                      title="Also mark it as a favourite"
                    >
                      {favouriteNew ? '★' : '☆'} Favourite
                    </button>
                    <button className="btn-gold" onClick={() => void saveQuick()} disabled={quickBusy}>
                      {quickBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {quickNote ? <p className="pop-note">{quickNote}</p> : null}
                  <button
                    className="link-btn pop-more"
                    onClick={() => {
                      setSaveOpen(false);
                      setSavesOpen(true);
                    }}
                  >
                    Open saved codes →
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <button className="ghost-action" onClick={() => void copyCode()} title="Copy the whole program to the clipboard">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>

          {loaded ? (
            <button
              className={`save-star ${loaded.favorite ? 'on' : ''}`}
              onClick={() => void starLoaded()}
              title={loaded.favorite ? 'Remove the open program from favourites' : 'Favourite the open program'}
            >
              {loaded.favorite ? '★' : '☆'}
            </button>
          ) : null}

          {boardNote && onOpenBoard ? (
            <button className="draw-note" onClick={onOpenBoard} title="Open the whiteboard">
              ✏ {boardNote} · Open →
            </button>
          ) : null}
          <span className="foot-hint">⌘/Ctrl + Enter</span>
          <span className="foot-hint right">{steps.length} steps</span>
        </div>
          </>
        )}
      </section>

      <section className="stage-wrap">
        <div className="stage">
          <div className="stage-scroll">
            {steps.length > 0 && step ? (
              <MemoryStage
                step={step}
                stepIndex={safe}
                onInspect={setSelected}
                animMs={Math.round(Math.max(180, Math.min(520, (BASE_MS / speed) * 0.78)))}
                resetKey={trace}
              />
            ) : (
              <div className="stage-empty">
                <p>{problem?.title ?? 'Nothing to visualize yet'}</p>
                <span>{problem?.message ?? 'Press Run to trace your program.'}</span>
              </div>
            )}
          </div>

          {step && (
            <div className="stage-note">
              <div className="note-top">
                <span className="pill">{KIND_LABEL[step.kind] ?? step.kind}</span>
                <span className="pill soft">
                  line {step.line} · step {safe + 1}/{total}
                </span>
              </div>
              <p>{step.note}</p>
            </div>
          )}

          {(problem || step?.stdout) && (
            <div className="stage-bottom">
              {problem && steps.length > 0 && (
                <div className="stage-error">
                  <b>{problem.title}</b>
                  <span>{problem.message}</span>
                </div>
              )}
              {step?.stdout ? (
                <div className="stage-output" ref={stageOutRef}>
                  <div className="out-head">
                    <span>output</span>
                    <span>{step.stdout.split('\n').length - 1} lines</span>
                  </div>
                  <pre>{step.stdout}</pre>
                </div>
              ) : null}
            </div>
          )}

          <div className="hint-float">click a cell to inspect · drag to move · scroll to zoom · space to play</div>
        </div>

        <div className="playbar">
          <button className="icon-btn" title="Restart" disabled={!mayDrive} onClick={() => syncStep(0)}>
            ↺
          </button>
          <button className="icon-btn" title="Previous step" disabled={atStart || !mayDrive} onClick={() => syncStep(safe - 1)}>
            ◀
          </button>
          <button
            className="play-btn"
            title={mayDrive ? 'Play / pause' : 'Only editors can run or move the trace'}
            disabled={!mayDrive}
            onClick={() => {
              if (!mayDrive) return;
              if (atEnd) setIndex(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? '❙❙' : '▶'}
          </button>
          <button className="icon-btn" title="Next step" disabled={atEnd || !mayDrive} onClick={() => syncStep(safe + 1)}>
            ▶
          </button>
          <button
            className="icon-btn"
            title="Run to next breakpoint"
            onClick={runToBreakpoint}
            disabled={atEnd || !mayDrive}
          >
            ⏭
          </button>
          <input
            className="scrub"
            type="range"
            min={0}
            max={Math.max(total - 1, 0)}
            value={safe}
            disabled={!mayDrive}
            onChange={(e) => syncStep(Number(e.target.value))}
          />
          <label className="speed">
            <span>speed</span>
            <select className="minimal-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.5, 1, 1.5, 2, 3].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <aside className={`rail ${rightHidden ? 'is-collapsed' : ''}`}>
        {rightHidden ? (
          <button className="panel-stub" onClick={toggleRight} title="Show inspector">
            <span>‹</span>
            <i>Inspector</i>
          </button>
        ) : (
          <>
        <div className="rail-bar">
          <span className="eyebrow">Inspector</span>
          <button className="panel-collapse" onClick={toggleRight} title="Collapse inspector">
            ›
          </button>
        </div>
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Inputs</span>
            <button
              className="link-btn"
              disabled={!canType}
              onClick={() => {
                if (!canType) return;
                const next = inputsFor(lang, code);
                setInputsDirty(false);
                remember(lang, { inputs: next });
                if (inRoom) rooms.push({ inputs: next });
              }}
            >
              detect
            </button>
          </div>
          <textarea
            className="inputs-box"
            value={inputs}
            spellCheck={false}
            readOnly={!canType}
            onChange={(e) => {
              if (!canType) return;
              setInputsDirty(true);
              remember(lang, { inputs: e.target.value });
              if (inRoom) rooms.push({ inputs: e.target.value });
            }}
            placeholder={'nums = [3, 1, 2]\ncall sortValues(nums)'}
            rows={4}
          />
          <p className="rail-hint inputs-hint">
            Any name, any value — <code>[1, 2]</code>, <code>2.5</code>, <code>true</code>, or an expression in this
            language. A <code>call f(args)</code> line runs inside your program and prints the result.
          </p>
          <div className="inputs-actions">
            <button className="btn-gold" onClick={() => run(code, lang)} disabled={!mayRun}>
              Run with inputs
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Output</span>
            <span className="eyebrow soft">{step?.stdout ? `${step.stdout.split('\n').length - 1} lines` : 'console'}</span>
          </div>
          <pre className="console" ref={outputRef}>
            {step?.stdout ? step.stdout : 'System.out output appears here as it happens.'}
          </pre>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">History</span>
            <span className="eyebrow soft">{logEntries.length} steps</span>
          </div>
          <StepLog entries={logEntries} empty="Run your code: every comparison and assignment lands here." />
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Breakpoints</span>
            <span className="eyebrow soft">{breakpoints.size || 'none'}</span>
          </div>
          {breakpoints.size === 0 ? (
            <p className="rail-hint">Click a line number to pause the trace there, then press ⏭.</p>
          ) : (
            <div className="bp-list">
              {[...breakpoints].sort((a, b) => a - b).map((line) => (
                <button key={line} className="bp-chip" onClick={() => toggleBreakpoint(line)}>
                  <span className="bp-dot" /> line {line} ×
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Selection</span>
            {selected && <button className="link-btn" onClick={() => setSelected(null)}>clear</button>}
          </div>
          {selected ? (
            <div className="insp-body">
              <div className="insp-title">{selected.title}</div>
              {selected.meta.map(([key, value]) => (
                <div className="insp-row" key={key}>
                  <span>{key}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="rail-hint">Click a cell or block in the scene to read its value.</p>
          )}
        </div>

        <div className="panel legend-panel">
          <span className="eyebrow">Legend</span>
          <div className="legend-rows">
            <span><i className="sw sw-gold" />value changing</span>
            <span><i className="sw sw-ink" />reference</span>
            <span><i className="sw sw-sage" />settled</span>
          </div>
        </div>
          </>
        )}
      </aside>

      {!leftHidden && (
        <div
          className="splitter"
          style={{ left: left - 3 }}
          onPointerDown={(event) => startResize(event, { dir: 1, width: left, min: 260, max: 640, onWidth: setLeft })}
        />
      )}
      {!rightHidden && (
        <div
          className="splitter"
          style={{ right: right - 3 }}
          onPointerDown={(event) => startResize(event, { dir: -1, width: right, min: 240, max: 560, onWidth: setRight })}
        />
      )}
      <SavedDrawer
        open={savesOpen}
        onClose={() => setSavesOpen(false)}
        current={{ language: lang, code, inputs }}
        onLoad={openSave}
        onDeleted={(id) => {
          // the star in the footer must not point at a row that is gone
          setLoaded((prev) => (prev?.id === id ? null : prev));
        }}
      />
      </main>
    </>
  );
}
