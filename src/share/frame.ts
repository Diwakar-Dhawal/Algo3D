/**
 * Sharing a step means sharing a picture of it: the stage is the only artefact
 * this product makes that other people see, so it has to leave the page intact.
 */

export type FrameInput = {
  /** the step note that explains what just happened */
  note: string;
  /** `line 12 · step 8/41 · Main.bubbleSort` */
  meta: string;
  /** used for the download name */
  file: string;
};

export type FrameResult = 'copied' | 'downloaded' | 'unavailable' | 'blocked';

const WIDTH = 1200;
const PAD = 44;

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** the 3D canvas currently on screen, or null when the stage has nothing to show */
function stageCanvas(): HTMLCanvasElement | null {
  const node = document.querySelector('.stage canvas');
  return node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0 ? node : null;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, limit = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === limit) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < limit) lines.push(line);
  if (lines.length === limit && words.join(' ').length > lines.join(' ').length) {
    lines[limit - 1] = `${lines[limit - 1].replace(/[.,;:]?$/, '')}…`;
  }
  return lines;
}

function download(sheet: HTMLCanvasElement, file: string): void {
  const url = sheet.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `algo3d-${file.replace(/\.[a-z]+$/i, '')}-frame.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyFrame(input: FrameInput): Promise<FrameResult> {
  const source = stageCanvas();
  if (!source) return 'unavailable';

  const shotW = WIDTH - PAD * 2;
  const shotH = Math.round((source.height / source.width) * shotW);

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return 'unavailable';
  const noteFont = '600 30px system-ui, -apple-system, "Segoe UI", sans-serif';
  const metaFont = '500 21px system-ui, -apple-system, "Segoe UI", sans-serif';
  probe.font = noteFont;
  const noteLines = wrapLines(probe, input.note || 'Step', shotW);

  const captionTop = PAD + shotH + 26;
  const metaTop = captionTop + noteLines.length * 40 + 10;
  const height = metaTop + 28 + PAD;

  const sheet = document.createElement('canvas');
  sheet.width = WIDTH;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  if (!ctx) return 'unavailable';

  ctx.fillStyle = token('--card', '#fffdf8');
  ctx.fillRect(0, 0, WIDTH, height);

  try {
    ctx.drawImage(source, PAD, PAD, shotW, shotH);
  } catch {
    return 'blocked';
  }
  ctx.strokeStyle = token('--line', '#e6ddcd');
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, PAD, shotW, shotH);

  ctx.textBaseline = 'top';
  ctx.font = noteFont;
  ctx.fillStyle = token('--ink', '#1d1a15');
  noteLines.forEach((line, i) => ctx.fillText(line, PAD, captionTop + i * 40));

  ctx.font = metaFont;
  ctx.fillStyle = token('--muted', '#7a6f5f');
  ctx.fillText(input.meta, PAD, metaTop);

  ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = token('--gold', '#b8862f');
  const brand = 'Algo3D';
  ctx.fillText(brand, WIDTH - PAD - ctx.measureText(brand).width, metaTop);

  const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'));
  if (!blob) return 'unavailable';

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      // the permission prompt can hang instead of refusing, so give it a deadline
      // the same way the text copy does; a stuck button is worse than a download
      await Promise.race([
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('clipboard timeout')), 1500)),
      ]);
      return 'copied';
    } catch {
      // permission denied, unsupported or slow: fall through to a download
    }
  }

  download(sheet, input.file);
  return 'downloaded';
}
