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

const BASE_MS = 620;

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

export function CodeLab() {
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
  /** the saved program behind the current buffer, so it can be starred in place */
  const [loaded, setLoaded] = useState<Save | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [favouriteNew, setFavouriteNew] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickNote, setQuickNote] = useState<string | null>(null);

  const openQuickSave = () => {
    if (!user) {
      setSavesOpen(true);
      return;
    }
    setDraftTitle(`${langDef.label} · ${new Date().toLocaleDateString()}`);
    setDraftDesc('');
    setFavouriteNew(loaded?.favorite ?? false);
    setQuickNote(null);
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
  };

  const remember = (language: LangId, patch: Partial<{ code: string; inputs: string; sample: string }>) => {
    setMemory((prev) => ({
      code: patch.code === undefined ? prev.code : { ...prev.code, [language]: patch.code },
      inputs: patch.inputs === undefined ? prev.inputs : { ...prev.inputs, [language]: patch.inputs },
      sample: patch.sample === undefined ? prev.sample : { ...prev.sample, [language]: patch.sample },
    }));
  };

  const editCode = (next: string) => {
    remember(lang, { code: next, ...(inputsDirty ? {} : { inputs: inputsFor(lang, next) }) });
  };

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

  const run = (source: string, language: LangId = lang, box = inputs) => {
    recordRun();
    const next = runIn(language, source, box);
    setTrace(next);
    setIndex(0);
    setPlaying(false);
    setSelected(null);
    // show the result straight away instead of leaving the user on the editor
    setView('visual');
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
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          run(code);
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        setPlaying(false);
        setIndex((i) => Math.min(i + 1, total - 1));
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false);
        setIndex((i) => Math.max(0, i - 1));
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run(code);
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
    for (let i = safe + 1; i < total; i++) {
      if (breakpoints.has(steps[i].line)) {
        setPlaying(false);
        setIndex(i);
        return;
      }
    }
    setPlaying(false);
    setIndex(Math.max(0, total - 1));
  };

  const pickSample = (id: string) => {
    const sample = langDef.samples.find((s) => s.id === id);
    if (!sample) return;
    const next = inputsFor(lang, sample.code);
    setInputsDirty(false);
    remember(lang, { code: sample.code, inputs: next, sample: id });
    setBreakpoints(new Set());
    run(sample.code, lang, next);
  };

  const pickLang = (id: LangId) => {
    // each language keeps its own buffer, so switching back restores your work
    const source = memory.code[id];
    const box = memory.inputs[id];
    setLang(id);
    setInputsDirty(false);
    setBreakpoints(new Set());
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
            <select className="minimal-select lang-select" value={lang} onChange={(e) => pickLang(e.target.value as LangId)} title="Language">
              {LANGS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="minimal-select"
              value={isCustom ? 'custom' : sampleId}
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
        />

        <div className="panel-foot">
          <button className="btn-gold" onClick={() => run(code)}>
            Run ▸
          </button>

          <div className="save-wrap">
            <button
              className="ghost-action save-btn"
              onClick={() => (saveOpen ? setSaveOpen(false) : openQuickSave())}
              title={user ? 'Save this code (name + description)' : 'Sign in to save codes'}
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

          {loaded ? (
            <button
              className={`save-star ${loaded.favorite ? 'on' : ''}`}
              onClick={() => void starLoaded()}
              title={loaded.favorite ? 'Remove the open program from favourites' : 'Favourite the open program'}
            >
              {loaded.favorite ? '★' : '☆'}
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
          <button className="icon-btn" title="Restart" onClick={() => { setPlaying(false); setIndex(0); }}>
            ↺
          </button>
          <button
            className="icon-btn"
            title="Previous step"
            disabled={atStart}
            onClick={() => { setPlaying(false); setIndex(Math.max(0, safe - 1)); }}
          >
            ◀
          </button>
          <button className="play-btn" title="Play / pause" onClick={() => { if (atEnd) setIndex(0); setPlaying((p) => !p); }}>
            {playing ? '❙❙' : '▶'}
          </button>
          <button
            className="icon-btn"
            title="Next step"
            disabled={atEnd}
            onClick={() => { setPlaying(false); setIndex(Math.min(total - 1, safe + 1)); }}
          >
            ▶
          </button>
          <button className="icon-btn" title="Run to next breakpoint" onClick={runToBreakpoint} disabled={atEnd}>
            ⏭
          </button>
          <input
            className="scrub"
            type="range"
            min={0}
            max={Math.max(total - 1, 0)}
            value={safe}
            onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
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
              onClick={() => {
                setInputsDirty(false);
                remember(lang, { inputs: inputsFor(lang, code) });
              }}
            >
              detect
            </button>
          </div>
          <textarea
            className="inputs-box"
            value={inputs}
            spellCheck={false}
            onChange={(e) => {
              setInputsDirty(true);
              remember(lang, { inputs: e.target.value });
            }}
            placeholder={'nums = [3, 1, 2]\ncall sortValues(nums)'}
            rows={4}
          />
          <p className="rail-hint inputs-hint">
            Any name, any value — <code>[1, 2]</code>, <code>2.5</code>, <code>true</code>, or an expression in this
            language. A <code>call f(args)</code> line runs inside your program and prints the result.
          </p>
          <div className="inputs-actions">
            <button className="btn-gold" onClick={() => run(code, lang)}>
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
      />
    </main>
  );
}
