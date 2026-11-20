import { useEffect, useMemo, useRef, useState } from 'react';
import { TOPICS } from './topics';
import type { Program, Selected } from './topics/types';
import { Scene } from './three/Scene';
import { JavaCode } from './components/JavaCode';
import { StepLog, type LogEntry } from './components/StepLog';
import { panelVars, startResize, syncCanvases } from './components/panels';

const BASE_MS = 820;

export function Library() {
  const [topicId, setTopicId] = useState(TOPICS[0].id);
  const topic = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];

  const [paramsMap, setParamsMap] = useState<Record<string, any>>(() =>
    Object.fromEntries(TOPICS.map((t) => [t.id, t.defaults]))
  );
  const params = paramsMap[topic.id];

  const program = useMemo<Program>(() => topic.build(params), [topic, params]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [right, setRight] = useState(() => (window.innerWidth < 1440 ? 320 : 372));
  const [rightHidden, setRightHidden] = useState(false);
  const lastProgram = useRef<Program | null>(null);

  // the canvas must mount once the stage has a real size, otherwise the
  // renderer keeps the browser default 300×150 buffer
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageReady, setStageReady] = useState(false);
  const [stageW, setStageW] = useState(() => window.innerWidth);

  const toggleRight = () => {
    setRightHidden((value) => !value);
    syncCanvases();
  };

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const check = () => {
      if (node.clientWidth > 0 && node.clientHeight > 0) setStageReady(true);
      if (node.clientWidth > 0) setStageW(node.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // R3F builds its root from a measured rect; nudge it once the stage is real
  useEffect(() => {
    if (!stageReady) return;
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(id);
  }, [stageReady, topic.id]);

  useEffect(() => {
    if (lastProgram.current === program) return;
    lastProgram.current = program;
    setIndex(0);
    setPlaying(program.steps.length > 1);
    setSelected(null);
  }, [program]);

  useEffect(() => {
    if (!playing) return;
    if (index >= program.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setIndex((i) => Math.min(i + 1, program.steps.length - 1)),
      BASE_MS / speed
    );
    return () => clearTimeout(timer);
  }, [playing, index, speed, program]);

  const total = program.steps.length;
  const safe = Math.min(index, total - 1);
  const step = program.steps[safe] ?? { note: '', line: 0, state: null };
  const atStart = safe <= 0;
  const atEnd = safe >= total - 1;

  // animation timing follows playback speed so swaps finish before the next step
  const animMs = Math.round(Math.max(200, Math.min(560, (BASE_MS / speed) * 0.62)));

  const logEntries = useMemo<LogEntry[]>(
    () => program.steps.slice(0, safe + 1).map((entry) => ({ note: entry.note, line: entry.line })),
    [program, safe]
  );

  // pull the camera back on narrow screens, where the scene would run off both edges
  const fit = Math.min(2.6, Math.max(1, 860 / Math.max(320, stageW)));
  const camera: [number, number, number] = [topic.camera[0], topic.camera[1], topic.camera[2] * fit];

  const View = topic.View;
  const Controls = topic.Controls;
  const setParams = (next: any) => setParamsMap((m) => ({ ...m, [topic.id]: next }));

  return (
    <>
      <nav className="topic-tabs">
        {TOPICS.map((t) => (
          <button key={t.id} className={`tab ${t.id === topic.id ? 'on' : ''}`} onClick={() => setTopicId(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="lib-toolbar">
        <div className="lib-toolbar-head">
          <span className="eyebrow">{topic.tag}</span>
          <h2 className="lib-toolbar-title">{topic.label}</h2>
          <p className="lib-toolbar-blurb">{topic.blurb}</p>
        </div>
        <Controls params={params} setParams={setParams} />
      </div>

      <main className="main" style={panelVars({ '--right-w': `${rightHidden ? 44 : right}px` })}>
        <section className="stage-wrap">
          <div className="stage" ref={stageRef}>
            {stageReady && (
              <Scene key={`${topic.id}-${Math.round(fit * 10)}`} camera={camera}>
                <View state={step.state} onInspect={setSelected} animMs={animMs} />
              </Scene>
            )}

            <div className="stage-note">
              <div className="note-top">
                <span className="pill">{topic.tag}</span>
                <span className="pill soft">
                  {safe + 1} / {total}
                </span>
              </div>
              <p>{step.note}</p>
            </div>

            <div className="hint-float">drag to orbit · scroll to zoom · click a block</div>
          </div>

          <div className="playbar">
            <button className="icon-btn" title="Restart" onClick={() => { setPlaying(false); setIndex(0); }}>
              ↺
            </button>
            <button
              className="icon-btn"
              title="Previous"
              disabled={atStart}
              onClick={() => { setPlaying(false); setIndex(Math.max(0, safe - 1)); }}
            >
              ◀
            </button>
            <button
              className="play-btn"
              title="Play / pause"
              onClick={() => { if (atEnd) setIndex(0); setPlaying((p) => !p); }}
            >
              {playing ? '❙❙' : '▶'}
            </button>
            <button
              className="icon-btn"
              title="Next"
              disabled={atEnd}
              onClick={() => { setPlaying(false); setIndex(Math.min(total - 1, safe + 1)); }}
            >
              ▶
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

        <aside className={`side ${rightHidden ? 'is-collapsed' : ''}`}>
          {rightHidden ? (
            <button className="panel-stub" onClick={toggleRight} title="Show inspector">
              <span>‹</span>
              <i>Inspector</i>
            </button>
          ) : (
            <>
          <div className="side-bar">
            <span className="eyebrow">Inspector</span>
            <button className="panel-collapse" onClick={toggleRight} title="Collapse inspector">
              ›
            </button>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{topic.label}</h2>
              <span className="eyebrow">{topic.tag}</span>
            </div>
            <p className="blurb">{topic.blurb}</p>
          </div>

          <div className="panel code-card">
            <JavaCode code={program.java} activeLine={step.line} />
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
              <p className="rail-hint">Click a block in the scene to inspect it.</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">History</span>
              <span className="eyebrow soft">
                {safe + 1} / {total}
              </span>
            </div>
            <StepLog entries={logEntries} />
          </div>
            </>
          )}
        </aside>

        {!rightHidden && (
          <div
            className="splitter"
            style={{ right: right - 3 }}
            onPointerDown={(event) => startResize(event, { dir: -1, width: right, min: 260, max: 620, onWidth: setRight })}
          />
        )}
      </main>
    </>
  );
}
