import type { LangSample } from '../lang/types';

type Props = {
  open: boolean;
  samples: LangSample[];
  activeId?: string;
  onPick: (id: string) => void;
  onClose: () => void;
};

/** the first three lines that carry code, for the card's preview */
function preview(code: string): string {
  return code
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0)
    .slice(0, 3)
    .join('\n');
}

/**
 * A gallery instead of a dropdown: a blank editor is where a first visit dies,
 * and a dropdown hides the help behind a click.
 */
export function SampleGallery({ open, samples, activeId, onPick, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="gallery-scrim" onClick={onClose} role="presentation">
      <div
        className="gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Sample programs"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gallery-head">
          <div>
            <span className="eyebrow">Start from something that runs</span>
            <h2>Sample programs</h2>
          </div>
          <button className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <p className="gallery-note">
          Each card loads the program and traces it, so the scene is already there on step 1 — no typing first.
        </p>

        <ul className="gallery-grid">
          {samples.map((sample) => (
            <li key={sample.id}>
              <button
                className={`sample-card ${sample.id === activeId ? 'on' : ''}`}
                onClick={() => {
                  onPick(sample.id);
                  onClose();
                }}
              >
                <span className="sample-label">
                  {sample.label}
                  {sample.id === activeId ? <b className="sample-on">open</b> : null}
                </span>
                <code className="sample-code">{preview(sample.code)}</code>
                {sample.stdin ? <span className="sample-badge">reads console input</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
