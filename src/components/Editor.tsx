import { useEffect, useRef } from 'react';
import type { LangId } from '../lang/types';
import { tokenize } from './JavaCode';

export const EDITOR_LINE_HEIGHT = 21;

type Props = {
  code: string;
  onChange: (code: string) => void;
  activeLine: number;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  lang?: LangId;
  /** viewers in a room can read and set their own breakpoints, but not type */
  readOnly?: boolean;
};

export function Editor({
  code,
  onChange,
  activeLine,
  breakpoints,
  onToggleBreakpoint,
  lang = 'java',
  readOnly = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = code.split('\n');

  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  useEffect(syncScroll, [code]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !activeLine) return;
    const y = (activeLine - 1) * EDITOR_LINE_HEIGHT;
    if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - EDITOR_LINE_HEIGHT * 2) {
      ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
      syncScroll();
    }
  }, [activeLine]);

  return (
    <div className="editor">
      <div className="gutter" ref={gutterRef}>
        {lines.map((_, i) => {
          const line = i + 1;
          const isBreak = breakpoints.has(line);
          return (
            <button
              key={line}
              className={`gln ${isBreak ? 'bp' : ''} ${line === activeLine ? 'on' : ''}`}
              onClick={() => onToggleBreakpoint(line)}
              title={isBreak ? 'Remove breakpoint' : 'Set breakpoint'}
              tabIndex={-1}
            >
              <span className="bp-dot" />
              {line}
            </button>
          );
        })}
      </div>

      <div className="editor-body">
        <pre className="editor-highlight" ref={highlightRef} aria-hidden>
          {lines.map((line, i) => (
            <div key={i} className={`hl-line ${i + 1 === activeLine ? 'on' : ''}`}>
              {tokenize(line, lang).map((token, k) => (
                <span key={k} className={`t-${token.kind}`}>
                  {token.text}
                </span>
              ))}
            </div>
          ))}
        </pre>

        <textarea
          ref={textareaRef}
          className={`editor-input ${readOnly ? 'is-readonly' : ''}`}
          value={code}
          spellCheck={false}
          wrap="off"
          readOnly={readOnly}
          aria-readonly={readOnly}
          onChange={(e) => {
            if (!readOnly) onChange(e.target.value);
          }}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (readOnly) return;
            const ta = e.currentTarget;
            if (e.key === 'Tab') {
              e.preventDefault();
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              onChange(`${code.slice(0, start)}  ${code.slice(end)}`);
              requestAnimationFrame(() => {
                ta.selectionStart = start + 2;
                ta.selectionEnd = start + 2;
              });
            }
            if (e.key === 'Enter') {
              const start = ta.selectionStart;
              const currentLine = code.slice(0, start).split('\n').pop() ?? '';
              const indent = (currentLine.match(/^ */) ?? [''])[0];
              const extra = lang === 'python' ? (/\:\s*$/.test(currentLine) ? '  ' : '') : /\{\s*$/.test(currentLine) ? '  ' : '';
              if (indent || extra) {
                e.preventDefault();
                const insert = `\n${indent}${extra}`;
                onChange(`${code.slice(0, start)}${insert}${code.slice(ta.selectionEnd)}`);
                requestAnimationFrame(() => {
                  const pos = start + insert.length;
                  ta.selectionStart = pos;
                  ta.selectionEnd = pos;
                });
              }
            }
          }}
        />
      </div>
    </div>
  );
}
