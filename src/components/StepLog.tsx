import { useEffect, useRef } from 'react';

export type LogChange = { label: string; from?: string; to: string };
export type LogEntry = { note: string; line: number; changes?: LogChange[] };

type Props = {
  entries: LogEntry[];
  empty?: string;
};

/** Running history of every step so far, newest at the bottom. */
export function StepLog({ entries, empty }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length]);

  if (entries.length === 0) {
    return <p className="rail-hint">{empty ?? 'Nothing has happened yet.'}</p>;
  }

  return (
    <div className="step-log" ref={scroller}>
      {entries.map((entry, index) => (
        <div className={`log-row ${index === entries.length - 1 ? 'on' : ''}`} key={index}>
          <span className="log-idx">{index + 1}</span>
          <div className="log-body">
            <p>{entry.note}</p>
            {entry.changes && entry.changes.length > 0 && (
              <div className="log-changes">
                {entry.changes.map((change, k) => (
                  <span className="chg" key={k}>
                    <i>{change.label}</i>
                    {change.from !== undefined && change.from !== change.to && <s>{change.from}</s>}
                    <b>{change.to}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
