type Group = { title: string; rows: [string, string][] };

const GROUPS: Group[] = [
  {
    title: 'Run',
    rows: [
      ['⌘/Ctrl + Enter', 'Run the program'],
      ['⌘/Ctrl + S', 'Save to your library'],
      ['⌘/Ctrl + /', 'Comment or uncomment the selection'],
    ],
  },
  {
    title: 'Step through the trace',
    rows: [
      ['Space', 'Play or pause'],
      ['← / →', 'Previous or next step'],
      ['Home / End', 'First or last step'],
      ['B', 'Breakpoint on the current line'],
      ['Shift + →', 'Run to the next breakpoint'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Tab / Shift + Tab', 'Indent or outdent'],
      ['Esc', 'Close the open panel'],
      ['?', 'This list'],
    ],
  },
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="shortcuts-scrim" onClick={onClose} role="presentation">
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">Faster</span>
            <h2>Keyboard shortcuts</h2>
          </div>
          <button className="drawer-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {GROUPS.map((group) => (
          <section className="shortcut-group" key={group.title}>
            <span className="eyebrow">{group.title}</span>
            <dl>
              {group.rows.map(([keys, what]) => (
                <div className="shortcut-row" key={keys}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <p className="shortcut-foot">
          Run and save work from inside the editor too; the rest apply anywhere on the lab.
        </p>
      </div>
    </div>
  );
}
