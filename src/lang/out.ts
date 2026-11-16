import type { Translated } from './types';

/**
 * Builds the Java source while remembering, for every generated line, which
 * line of the user's original program it came from. The trace then reports the
 * line the user actually wrote instead of a line of the translation.
 */
export class Out {
  private parts = '';
  /** map[i] = source line of generated line i + 1 */
  map: number[] = [1];
  private cur = 1;

  constructor(startLine = 1) {
    this.cur = startLine;
    this.map = [startLine];
  }

  write(text: string, line: number): void {
    if (line !== this.cur) {
      this.parts += '\n';
      this.map.push(line);
      this.cur = line;
    }
    this.parts += text + ' ';
  }

  /** a full line (headers, closing braces) with nothing after it */
  line(text: string, line: number): void {
    this.parts += text + '\n';
    this.map.push(line);
    this.cur = line;
  }

  /** hard newline, used after a statement that shares its source line */
  brk(line: number): void {
    this.parts += '\n';
    this.map.push(line);
    this.cur = line;
  }

  done(): Translated {
    return { code: this.parts.replace(/\s+$/, ''), map: this.map };
  }
}

export function atLine(map: number[], line: number): number {
  if (!map.length) return line;
  const index = Math.max(0, Math.min(map.length - 1, line - 1));
  return map[index] ?? line;
}
