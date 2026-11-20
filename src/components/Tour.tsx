import { useCallback, useEffect, useRef, useState } from 'react';

export type TourMode = 'code' | 'library' | 'board';

type Step = {
  /** element to spotlight; without one the card is centred */
  target?: string;
  /** the section this step lives in, so the tour can take you there */
  mode?: TourMode;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    title: 'Welcome to Algo3D',
    body: 'Write a program, press Run, and watch it step through a three-dimensional scene. This tour points at each part of the app — it takes about half a minute, and you can leave at any time.',
  },
  {
    mode: 'code',
    target: '[data-tour="modes"]',
    title: 'Three sections',
    body: 'Your code is the lab where you write and trace a program. The algorithm library has ready-made topics to explore. The whiteboard is for sketching ideas by hand.',
  },
  {
    target: '[data-tour="editor"]',
    title: 'The source',
    body: 'Pick a language here — Java, Python, JavaScript or C++ — or load a sample. Python, JS and C++ are translated to Java before tracing, so the hint under the editor lists exactly what runs.',
  },
  {
    target: '[data-tour="saves"]',
    title: 'Keep your work',
    body: 'Sign in to save a program with a name and description, star the ones you come back to, and search the lot. Saved codes open straight back into the editor.',
  },
  {
    target: '[data-tour="run"]',
    title: 'Run it',
    body: 'Run traces the program without executing anything on a real machine — no compiler, no container. Use the Inputs panel for values your program reads.',
  },
  {
    target: '[data-tour="playback"]',
    title: 'Step through the trace',
    body: 'Play, pause, scrub, or jump a step at a time. Click a line number to set a breakpoint, then Shift + → runs to it. Space plays and the arrow keys step.',
  },
  {
    target: '[data-tour="inspector"]',
    title: 'The inspector',
    body: 'The call stack, heap and every changed value live here, alongside the console and the step history. Click a block in the scene to read what it holds.',
  },
  {
    mode: 'library',
    target: '[data-tour="library"]',
    title: 'Algorithm library',
    body: 'Seven topics — arrays, matrices, stacks, queues, linked lists, trees and graphs — each with its own 3D view, typed controls and step history.',
  },
  {
    mode: 'board',
    target: '[data-tour="board"]',
    title: 'Whiteboard',
    body: 'Sketch an approach before you code it. Your drawing is saved in this browser, and a saved program can keep a copy of it.',
  },
  {
    target: '[data-tour="help"]',
    title: 'Never stuck',
    body: 'Press ? at any time — or open the ☰ menu on a phone — for the full keyboard reference, and to replay this tour whenever you want.',
  },
];

const STORAGE_KEY = 'algo3d:tour';

/** the tour shows itself once; afterwards only from the shortcut sheet */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    // storage blocked: better to stay quiet than to greet every reload
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    /* storage can be blocked */
  }
}

type Props = {
  onClose: () => void;
  onMode: (mode: TourMode) => void;
  /** the section the reader was in before the tour started */
  returnMode: TourMode;
};

export function Tour({ onClose, onMode, returnMode }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  // the callbacks are recreated by the shell on every render; keep them stable
  const modeRef = useRef(onMode);
  modeRef.current = onMode;

  const finish = useCallback(() => {
    markTourSeen();
    modeRef.current(returnMode);
    onClose();
  }, [onClose, returnMode]);

  const next = useCallback(() => {
    if (last) finish();
    else setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [finish, last]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // take the reader to the section a step belongs to
  useEffect(() => {
    if (step.mode) modeRef.current(step.mode);
  }, [step.mode]);

  // lazy panes mount a moment after the mode changes, so keep looking
  useEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }

    let live = true;
    let tries = 0;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(step.target!);
      const box = el?.getBoundingClientRect();
      if (!box || box.width < 2 || box.height < 2) return false;
      setRect(box);
      return true;
    };

    if (!measure()) {
      setRect(null);
      const timer = window.setInterval(() => {
        if (!live) return;
        tries += 1;
        if (measure() || tries > 30) window.clearInterval(timer);
      }, 100);
      return () => {
        live = false;
        window.clearInterval(timer);
      };
    }

    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      live = false;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [index, step.target, step.mode]);

  // capture phase, so the lab does not also react to Space / arrows
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        // Space would otherwise play the trace behind the dialog
        event.preventDefault();
        event.stopPropagation();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [finish, next, back]);

  const width = Math.min(352, window.innerWidth - 24);
  let left = (window.innerWidth - width) / 2;
  let top = Math.max(16, window.innerHeight / 2 - 110);

  if (rect) {
    left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    const below = rect.bottom + 14;
    top = window.innerHeight - below > 210 ? below : Math.max(12, rect.top - 14 - 200);
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Algo3D tour">
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tour-scrim" />
      )}

      <div className="tour-card" style={{ left, top, width }}>
        <span className="eyebrow">
          Tour · {index + 1} of {STEPS.length}
        </span>
        <h2>{step.title}</h2>
        <p>{step.body}</p>

        <div className="tour-actions">
          <button className="link-btn" onClick={finish}>
            {last ? 'Close' : 'Skip the tour'}
          </button>
          <div className="tour-nav">
            {index > 0 ? (
              <button className="btn" onClick={back}>
                Back
              </button>
            ) : null}
            <button className="btn-gold" onClick={next} autoFocus>
              {last ? 'Start coding' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
