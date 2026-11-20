import { useEffect, useRef } from 'react';
import type { LangId } from '../lang/types';
import { tokenize } from './JavaCode';

export const EDITOR_LINE_HEIGHT = 21;

type Props = {
  code: string;
  onChange: (code: string) => void;
  activeLine: number;
  /** the line a failed run points at, marked in the gutter */
  errorLine?: number;
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
  errorLine = 0,
  breakpoints,
  onToggleBreakpoint,
  lang = 'java',
  readOnly = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = code.split('\n');

  /** write the new buffer, then put the caret or selection back where it belongs */
  const replace = (next: string, caret: number | [number, number]) => {
    onChange(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (Array.isArray(caret)) {
        ta.selectionStart = caret[0];
        ta.selectionEnd = caret[1];
      } else {
        ta.selectionStart = caret;
        ta.selectionEnd = caret;
      }
    });
  };

  /** the lines the selection touches */
  const selectedLines = (start: number, end: number) => {
    const from = code.lastIndexOf('\n', start - 1) + 1;
    const found = code.indexOf('\n', end);
    const to = found === -1 ? code.length : found;
    return { from, to, lines: code.slice(from, to).split('\n') };
  };

  /** Tab indents every touched line, Shift+Tab takes two spaces back */
  const indentLines = (ta: HTMLTextAreaElement, outdent: boolean) => {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (!outdent && start === end) {
      replace(`${code.slice(0, start)}  ${code.slice(end)}`, start + 2);
      return;
    }

    const { from, to, lines } = selectedLines(start, end);
    let first = 0;
    let total = 0;
    const body = lines
      .map((line, i) => {
        const updated = outdent ? line.replace(/^ {1,2}/, '') : `  ${line}`;
        const delta = updated.length - line.length;
        if (i === 0) first = delta;
        total += delta;
        return updated;
      })
      .join('\n');

    const next = `${code.slice(0, from)}${body}${code.slice(to)}`;
    const caret = Math.max(from, start + first);
    replace(next, start === end ? caret : [caret, Math.max(caret, end + total)]);
  };

  /** Ctrl/Cmd + / comments the touched lines, and uncomments them again */
  const comment = (ta: HTMLTextAreaElement) => {
    const token = lang === 'python' ? '# ' : '// ';
    const bare = token.trimEnd();
    const { from, to, lines } = selectedLines(ta.selectionStart, ta.selectionEnd);
    const filled = lines.filter((line) => line.trim().length > 0);
    const allCommented = filled.length > 0 && filled.every((line) => line.trimStart().startsWith(bare));

    const body = lines
      .map((line) => {
        if (!line.trim()) return line;
        const pad = (line.match(/^ */) ?? [''])[0];
        const text = line.slice(pad.length);
        if (!allCommented) return `${pad}${token}${text}`;
        return `${pad}${text.slice(bare.length).replace(/^ /, '')}`;
      })
      .join('\n');

    replace(`${code.slice(0, from)}${body}${code.slice(to)}`, [from, from + body.length]);
  };

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
          const isError = line === errorLine;
          return (
            <button
              key={line}
              className={`gln ${isBreak ? 'bp' : ''} ${isError ? 'err' : ''} ${line === activeLine ? 'on' : ''}`}
              onClick={() => onToggleBreakpoint(line)}
              title={isError ? 'This line failed' : isBreak ? 'Remove breakpoint' : 'Set breakpoint'}
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
            <div key={i} className={`hl-line ${i + 1 === activeLine ? 'on' : ''} ${i + 1 === errorLine ? 'err' : ''}`}>
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
              indentLines(ta, e.shiftKey);
              return;
            }
            if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.code === 'Slash')) {
              e.preventDefault();
              comment(ta);
              return;
            }
            if (e.key === 'Enter') {
              const start = ta.selectionStart;
              const currentLine = code.slice(0, start).split('\n').pop() ?? '';
              const base = (currentLine.match(/^ */) ?? [''])[0];
              // a line that closes a block ends the indentation one level up
              const closing = /^[}\]\);]+$/.test(currentLine.trim());
              const indent = closing ? base.slice(0, Math.max(0, base.length - 2)) : base;
              const extra = closing
                ? ''
                : lang === 'python'
                  ? /\:\s*$/.test(currentLine)
                    ? '  '
                    : ''
                  : /\{\s*$/.test(currentLine)
                    ? '  '
                    : '';
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
