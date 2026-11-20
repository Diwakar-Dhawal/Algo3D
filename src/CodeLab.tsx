import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, langById, runIn, sampleCode } from './lang';
import { formatInputs, suggestInputs } from './lang/inputs';
import type { LangId } from './lang/types';
import type { Trace } from './jvm/types';
import { PaneBoundary } from './components/PaneBoundary';
import { ShortcutSheet } from './components/Shortcuts';
import { SampleGallery } from './components/SampleGallery';
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
import { hrefFor, onUrlChange, readUrl, writeUrl } from './urlstate';
import { copyFrame } from './share/frame';
import { addLocalSave, isLocalSave, updateLocalSave } from './saves/local';
import type { BoardElement } from './board/elements';
import { useRooms } from './rooms/RoomContext';
import { roleLabel } from './rooms/roles';
import { setRoomSeed } from './rooms/seed';

/** three.js is heavy, so the scene arrives after the editor is already usable */
const MemoryStage = lazy(() => import('./memory/MemoryStage').then((mod) => ({ default: mod.MemoryStage })));

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

type LabMemory = {
  code: Record<string, string>;
  inputs: Record<string, string>;
  sample: Record<string, string>;
  /** standard input, per language — only Java reads it today */
  stdin: Record<string, string>;
};
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
  const memory: LabMemory = { code: {}, inputs: {}, sample: {}, stdin: {} };
  for (const def of LANGS) {
    const source = saved?.code?.[def.id] ?? sampleCode(def.id, def.defaultSample);
    memory.code[def.id] = source;
    memory.sample[def.id] = saved?.sample?.[def.id] ?? def.defaultSample;
    memory.inputs[def.id] = saved?.inputs?.[def.id] ?? inputsFor(def.id, source);
    memory.stdin[def.id] = saved?.stdin?.[def.id] ?? '';
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
    const url = readUrl();
    const memory = freshMemory(saved);
    const lang = (LANGS.some((def) => def.id === url.lang) ? (url.lang as LangId) : saved?.lang) ?? ('java' as LangId);
    // a shared link can name a sample, so the visitor opens exactly what was sent
    const shared = url.sample ? langById(lang).samples.find((option) => option.id === url.sample) : undefined;
    if (shared) {
      memory.code[lang] = shared.code;
      memory.sample[lang] = shared.id;
      memory.inputs[lang] = shared.stdin ? '' : inputsFor(lang, shared.code);
      memory.stdin[lang] = shared.stdin ?? '';
    }
    const wantedStep = Number(url.step ?? '0');
    return {
      saved,
      narrow,
      memory,
      lang,
      view: saved?.view ?? ('visual' as LabView),
      step: Number.isFinite(wantedStep) && wantedStep > 0 ? Math.trunc(wantedStep) : 0,
    };
  });

  const [view, setView] = useState<LabView>(boot.view);

  // the tour asks for a pane, because below 1080 px only one is on screen
  useEffect(() => {
    const onShow = (event: Event) => {
      const wanted = (event as CustomEvent<string>).detail;
      if (wanted === 'code' || wanted === 'visual' || wanted === 'panels') setView(wanted);
    };
    window.addEventListener('algo3d:show-pane', onShow);
    return () => window.removeEventListener('algo3d:show-pane', onShow);
  }, []);

  const [memory, setMemory] = useState<LabMemory>(boot.memory);
  const [lang, setLang] = useState<LangId>(boot.lang);
  const langDef = langById(lang);
  const sampleId = memory.sample[lang];
  const code = memory.code[lang];
  const inputs = memory.inputs[lang];
  const stdins = memory.stdin[lang] ?? '';
  // once the buffer drifts from the picked sample the select must say so
  const chosenSample = langDef.samples.find((option) => option.id === sampleId);
  const isCustom = !chosenSample || chosenSample.code !== code;
  const [inputsDirty, setInputsDirty] = useState(false);
  const [trace, setTrace] = useState<Trace>(() =>
    runIn(boot.lang, boot.memory.code[boot.lang], boot.memory.inputs[boot.lang], boot.memory.stdin[boot.lang] ?? '')
  );
  const [index, setIndex] = useState(boot.step);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [left, setLeft] = useState(() => Math.max(360, boot.saved?.left ?? (window.innerWidth < 1440 ? 360 : 420)));
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
  const [copiedOut, setCopiedOut] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const copyCode = async () => {
    const text = code;
    const copiedOk = await writeClipboard(text);
    if (!copiedOk) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const copyOutput = async () => {
    const text = step?.stdout ?? '';
    if (!text) return;
    const copiedOk = await writeClipboard(text);
    if (!copiedOk) return;
    setCopiedOut(true);
    window.setTimeout(() => setCopiedOut(false), 1600);
  };

  const downloadTrace = () => {
    if (steps.length === 0) return;
    const payload = {
      language: lang,
      code,
      steps: steps.map((s) => ({
        line: s.line,
        kind: s.kind,
        note: s.note,
        stdout: s.stdout,
      })),
      stdout: trace.stdout,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `algo3d-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const STEP_KIND_HINT: Record<string, string> = {
    stmt: 'statement ran',
    call: 'function called',
    return: 'function returned',
    write: 'a value changed',
    error: 'runtime error',
    end: 'program finished',
  };

  const openQuickSave = () => {
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
    setQuickBusy(true);
    setQuickNote(null);
    const entry = {
      title: draftTitle.trim() || 'Untitled program',
      description: draftDesc.trim(),
      language: lang,
      code,
      inputs,
      favorite: favouriteNew,
    };
    // without an account the program stays in this browser — the popover says so
    if (!user) {
      const local = addLocalSave(entry);
      setQuickBusy(false);
      if (!local) {
        setQuickNote('This browser refused the save — storage may be full or blocked.');
        return;
      }
      setLoaded(local);
      setSaveOpen(false);
      return;
    }
    const result = await authApi.create({
      ...entry,
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
    if (isLocalSave(loaded)) {
      updateLocalSave(loaded.id, { favorite: next });
      return;
    }
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
    run(save.code, target, save.inputs, memory.stdin[target] ?? '');
    // the drawing that travelled with the program comes back onto the board
    if (save.board && save.board.length) {
      writePersonalBoard(user?.id ?? null, save.board);
      setBoardNote(`Drawing restored (${save.board.length} shapes)`);
    } else {
      setBoardNote(null);
    }
  };

  const remember = (
    language: LangId,
    patch: Partial<{ code: string; inputs: string; sample: string; stdin: string }>
  ) => {
    setMemory((prev) => ({
      code: patch.code === undefined ? prev.code : { ...prev.code, [language]: patch.code },
      inputs: patch.inputs === undefined ? prev.inputs : { ...prev.inputs, [language]: patch.inputs },
      sample: patch.sample === undefined ? prev.sample : { ...prev.sample, [language]: patch.sample },
      stdin: patch.stdin === undefined ? prev.stdin : { ...prev.stdin, [language]: patch.stdin },
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

    // The tab that holds the typing lease is the source of truth: its own save
    // coming back carries the text as of one round trip ago, and writing that
    // into the buffer is what put the caret back at the end of the last saved
    // line mid-sentence. A takeover hands the lease over, so the other tab is
    // adopted normally once it starts typing.
    const mine = shared.driver?.userId === meId;
    const target = (LANGS.some((def) => def.id === shared.language) ? shared.language : 'java') as LangId;
    const sameSource = target === lang && shared.code === code && shared.inputs === inputs;
    if (!mine && !sameSource) {
      setLang(target);
      setInputsDirty(true);
      remember(target, { code: shared.code, inputs: shared.inputs });
      setTrace(runIn(target, shared.code, shared.inputs));
      setSelected(null);
    }
    // the playhead is shared either way, so a joiner follows the editor's step
    if (shared.index !== index) setIndex(shared.index);
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
  // only the newest line is announced: reading the whole buffer again on every
  // step would bury a screen reader in output it has already heard
  const newestLine = step?.stdout ? (step.stdout.replace(/\n$/, '').split('\n').pop() ?? '') : '';

  // the address bar always names what is on screen, so a refresh — or a link
  // pasted into a study group — lands on the same program and step
  useEffect(() => {
    const id = window.setTimeout(() => {
      writeUrl({
        // the language you booted with is the default, so a plain visit keeps a
        // short URL while a shared link still carries the mode you sent
        lang: lang === boot.lang ? undefined : lang,
        sample: isCustom ? undefined : sampleId,
        step: safe > 0 ? String(safe) : undefined,
      });
    }, 220);
    return () => window.clearTimeout(id);
  }, [lang, isCustom, sampleId, safe, boot.lang]);

  // Back/Forward through the steps of a shared link
  useEffect(
    () =>
      onUrlChange((state) => {
        if (!state.step) return;
        const wanted = Number(state.step);
        if (Number.isFinite(wanted)) setIndex(Math.max(0, Math.trunc(wanted)));
      }),
    []
  );

  /** move the playhead; in a room the step is shared, so the change is pushed */
  const syncStep = (next: number) => {
    if (!mayDrive) return;
    const clamped = Math.max(0, Math.min(total - 1, next));
    setPlaying(false);
    setIndex(clamped);
    if (inRoom) rooms.push({ index: clamped });
  };

  /** one play button for the bar and the space bar, both guarded by the room role */
  const togglePlay = () => {
    if (!mayDrive) return;
    if (atEnd) setIndex(0);
    setPlaying((p) => !p);
  };

  const run = (source: string, language: LangId = lang, box = inputs, feed = stdins) => {
    if (!mayRun) return;
    recordRun();
    const next = runIn(language, source, box, feed);
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
      // the playhead is shared, so playing has to move it for everyone the same
      // way an arrow key does; without this a joiner sat on the first step until
      // the driver clicked or scrubbed
      if (inRoom && mayDrive) rooms.push({ index: nextIndex });
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
      if (e.key === 'Escape' && shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (!mayDrive) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        runToBreakpoint();
      } else if (e.key === 'ArrowRight') {
        syncStep(safe + 1);
      } else if (e.key === 'ArrowLeft') {
        syncStep(safe - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        syncStep(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        syncStep(Math.max(0, total - 1));
      } else if (e.key.toLowerCase() === 'b' && step) {
        e.preventDefault();
        toggleBreakpoint(step.line);
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

  /** the link to exactly this step, for pasting into chat */
  const copyStepLink = async () => {
    const link = `${window.location.origin}${hrefFor({
      lang,
      sample: isCustom ? undefined : sampleId,
      step: safe > 0 ? String(safe) : undefined,
    })}`;
    const ok = await writeClipboard(link);
    setShareNote(ok ? 'Link to this step copied' : 'Could not copy the link — copy it from the address bar');
    window.setTimeout(() => setShareNote(null), 2200);
  };

  /** the stage plus its step note, as a picture someone can paste */
  const copyPicture = async () => {
    if (!step || frameBusy) return;
    setFrameBusy(true);
    const result = await copyFrame({
      note: step.note,
      meta: `line ${step.line} · step ${safe + 1}/${total} · ${langDef.file}`,
      file: langDef.file,
    });
    setFrameBusy(false);
    setShareNote(
      result === 'copied'
        ? 'This step copied as an image'
        : result === 'downloaded'
          ? 'Image downloaded'
          : result === 'blocked'
            ? 'Could not read the scene — try again'
            : 'Run something first, then copy the frame'
    );
    window.setTimeout(() => setShareNote(null), 2600);
  };

  const pickSample = (id: string) => {
    if (!canType) return;
    const sample = langDef.samples.find((s) => s.id === id);
    if (!sample) return;
    // a sample that reads stdin starts with an empty values box, so nothing is
    // injected over the variables it declares
    const next = sample.stdin ? '' : inputsFor(lang, sample.code);
    const feed = sample.stdin ?? '';
    setInputsDirty(false);
    remember(lang, { code: sample.code, inputs: next, sample: id, stdin: feed });
    setBreakpoints(new Set());
    if (inRoom) rooms.push({ language: lang, code: sample.code, inputs: next });
    run(sample.code, lang, next, feed);
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
  /** the line the editor marks, so a mistake points at itself */
  const problemLine = trace.compileError?.line ?? (trace.error ? steps[steps.length - 1]?.line ?? 0 : 0);

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

      <section className={`editor-panel ${leftHidden ? 'is-collapsed' : ''}`} data-tour="editor">
        {leftHidden ? (
          <button className="panel-stub" onClick={toggleLeft} title="Show source">
            <span>›</span>
            <i>Source</i>
          </button>
        ) : (
          <PaneBoundary label="Source" resetKey={lang}>
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
            <button
              className="ghost-action sample-btn"
              disabled={!canType}
              onClick={() => setGalleryOpen(true)}
              title="Browse the sample programs"
            >
              <span>Samples</span>
              <i>{isCustom ? 'custom' : chosenSample?.label ?? ''}</i>
            </button>
            <div className="head-tools">
              <button
                className="ghost-action"
                data-tour="saves"
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
        </div>

        <p className="lang-note" title={langDef.subset}>
          <b>{langDef.file}</b> · {langDef.subset}
        </p>

        <Editor
          code={code}
          onChange={editCode}
          activeLine={step?.line ?? 0}
          errorLine={problemLine}
          breakpoints={breakpoints}
          onToggleBreakpoint={toggleBreakpoint}
          lang={lang}
          readOnly={!canType}
        />

        {problem ? (
          <div className="editor-error" role="alert">
            <b>{problem.title}</b>
            <span>{problem.message}</span>
          </div>
        ) : null}

        <div className="panel-foot">
          <button className="btn-gold" data-tour="run" onClick={() => run(code)}>
            Run ▸
          </button>

          <div className="save-wrap">
            <button
              className="ghost-action save-btn"
              onClick={() => (saveOpen ? setSaveOpen(false) : openQuickSave())}
              title={
                user
                  ? 'Save this code — name, description, drawing (⌘/Ctrl + S)'
                  : 'Save this code in this browser (⌘/Ctrl + S) — sign in to sync across devices'
              }
            >
              Save
            </button>
            {saveOpen ? (
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
                  {!user ? (
                    <p className="pop-note warn">Saved on this device only — sign in to sync across devices.</p>
                  ) : null}
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
          </PaneBoundary>
        )}
      </section>

      <section className="stage-wrap">
        <PaneBoundary label="Visualizer" resetKey={trace}>
        <div className="stage">
          <div className="stage-scroll">
            {steps.length > 0 && step ? (
              <Suspense
                fallback={
                  <div className="stage-loading">
                    <span className="spinner" aria-hidden="true" />
                    <span>Building the scene…</span>
                  </div>
                }
              >
                <MemoryStage
                  step={step}
                  stepIndex={safe}
                  onInspect={setSelected}
                  animMs={Math.round(Math.max(180, Math.min(520, (BASE_MS / speed) * 0.78)))}
                  resetKey={trace}
                />
              </Suspense>
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
        </PaneBoundary>

        <div className="playbar" data-tour="playback">
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
            onClick={togglePlay}
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
          <button
            className="icon-btn"
            title="Copy a link to this step"
            aria-label="Copy a link to this step"
            disabled={!step}
            onClick={() => void copyStepLink()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
              <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title="Copy this step as an image"
            aria-label="Copy this step as an image"
            disabled={!step || frameBusy}
            onClick={() => void copyPicture()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.2" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="m4 17 5-4 4 3 3-2 4 3" />
            </svg>
          </button>
          <button
            className="icon-btn help-btn"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            ?
          </button>
        </div>
        {shareNote ? (
          <div className="share-note" role="status">
            {shareNote}
          </div>
        ) : null}
      </section>

      <aside className={`rail ${rightHidden ? 'is-collapsed' : ''}`} data-tour="inspector">
        {rightHidden ? (
          <button className="panel-stub" onClick={toggleRight} title="Show inspector">
            <span>‹</span>
            <i>Inspector</i>
          </button>
        ) : (
          <PaneBoundary label="Inspector">
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

          {lang === 'java' ? (
            <label className="field stdin-field">
              <span>Standard input · Scanner</span>
              <textarea
                className="inputs-box inputs-stdin"
                value={stdins}
                spellCheck={false}
                readOnly={!canType}
                onChange={(event) => {
                  if (!canType) return;
                  remember(lang, { stdin: event.target.value });
                }}
                placeholder={'5\n4 8 1 9 3'}
                rows={3}
              />
            </label>
          ) : null}
          {lang === 'java' ? (
            <p className="rail-hint inputs-hint">
              What <code>Scanner</code> reads: <code>in.nextInt()</code> takes the next number,{' '}
              <code>in.nextLine()</code> the rest of the line.
            </p>
          ) : null}

          <div className="inputs-actions">
            <button className="btn-gold" onClick={() => run(code, lang)} disabled={!mayRun}>
              Run with inputs
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Output</span>
            <div className="panel-head-right">
              <span className="eyebrow soft">
                {step?.stdout ? `${step.stdout.split('\n').length - 1} lines` : 'console'}
              </span>
              {step?.stdout ? (
                <button className="link-btn" onClick={() => void copyOutput()} title="Copy the output so far">
                  {copiedOut ? 'copied ✓' : 'copy'}
                </button>
              ) : null}
              {steps.length > 0 ? (
                <button className="link-btn" onClick={downloadTrace} title="Download the full trace as JSON">
                  download
                </button>
              ) : null}
            </div>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {newestLine}
          </p>
          <pre className="console" ref={outputRef}>
            {step?.stdout ? step.stdout : 'System.out output appears here as it happens.'}
          </pre>
          {step ? (
            <p className="rail-hint" style={{ marginTop: 6, fontSize: 11 }}>
              Step {safe + 1} of {total} · {STEP_KIND_HINT[step.kind] ?? step.kind}
              {step.line ? ` · line ${step.line}` : ''}
            </p>
          ) : null}
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
          </PaneBoundary>
        )}
      </aside>

      {!leftHidden && (
        <div
          className="splitter"
          style={{ left: left - 3 }}
          onPointerDown={(event) => startResize(event, { dir: 1, width: left, min: 360, max: 640, onWidth: setLeft })}
        />
      )}
      {!rightHidden && (
        <div
          className="splitter"
          style={{ right: right - 3 }}
          onPointerDown={(event) => startResize(event, { dir: -1, width: right, min: 240, max: 560, onWidth: setRight })}
        />
      )}
      <SampleGallery
        open={galleryOpen}
        samples={langDef.samples}
        activeId={isCustom ? undefined : sampleId}
        onPick={pickSample}
        onClose={() => setGalleryOpen(false)}
      />
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
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
