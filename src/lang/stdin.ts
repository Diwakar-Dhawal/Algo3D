/**
 * Standard input, shared by every language mode.
 *
 * The Java tracer reads it through `Scanner`. Python, JavaScript and C++ are
 * translated to Java, so they can be wired onto this same reader later —
 * `input()` is `nextLine()`, `cin >> x` is `next()` — which is why the buffer
 * lives outside the interpreter.
 *
 * The cursor deliberately behaves like `java.util.Scanner`: `next()` skips
 * whitespace and stops before the delimiter, so a `nextInt()` followed by
 * `nextLine()` returns the rest of that line (usually the empty string). That
 * gotcha bites real Java programmers, so reproducing it is the point.
 */
export class Stdin {
  private text: string;
  private at = 0;

  constructor(text = '') {
    this.text = text.replace(/\r\n?/g, '\n');
  }

  /** how much of the buffer has been read — used for the panel's progress hint */
  get consumed(): number {
    return this.at;
  }

  get length(): number {
    return this.text.length;
  }

  private afterSpace(from: number): number {
    let i = from;
    while (i < this.text.length && /\s/.test(this.text[i])) i++;
    return i;
  }

  private tokenEnd(start: number): number {
    let i = start;
    while (i < this.text.length && !/\s/.test(this.text[i])) i++;
    return i;
  }

  hasNext(): boolean {
    return this.afterSpace(this.at) < this.text.length;
  }

  /** the next token, without consuming it */
  peek(): string | null {
    const start = this.afterSpace(this.at);
    if (start >= this.text.length) return null;
    return this.text.slice(start, this.tokenEnd(start));
  }

  /** the next whitespace-delimited token */
  next(): string | null {
    const start = this.afterSpace(this.at);
    if (start >= this.text.length) return null;
    const end = this.tokenEnd(start);
    this.at = end;
    return this.text.slice(start, end);
  }

  hasNextLine(): boolean {
    return this.at < this.text.length;
  }

  /** the rest of the current line, without its terminator */
  nextLine(): string | null {
    if (this.at >= this.text.length) return null;
    let end = this.text.indexOf('\n', this.at);
    if (end < 0) end = this.text.length;
    const line = this.text.slice(this.at, end);
    this.at = end < this.text.length ? end + 1 : end;
    return line;
  }
}
