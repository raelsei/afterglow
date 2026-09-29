import { FAMILY, fontFaces } from "./font";
import { RAMP, type TorusFrame } from "./torus";

export interface Palette {
  fg: string;
  muted: string;
  accent: string;
  /** Torus ink for contribution levels 0 to 4. */
  levels: readonly [string, string, string, string, string];
  /** Phosphor bloom around the torus. Ink on paper does not glow. */
  glow: boolean;
  /** Opacity of a torus frame one and two slots after it was drawn. */
  afterglow: readonly [number, number];
}

/** koray.dev's Phosphor palette. Text tones clear 4.5:1 on GitHub's own
 *  grounds: #0d1117 in dark mode, #ffffff in light. */
export const PHOSPHOR: { dark: Palette; light: Palette } = {
  dark: {
    fg: "#d9dedb",
    muted: "#8f9c97",
    accent: "#b6ff3d",
    levels: ["#55605b", "#6f9a2a", "#94cf36", "#b6ff3d", "#eaffc4"],
    glow: true,
    afterglow: [0.3, 0.12],
  },
  light: {
    fg: "#171c1a",
    muted: "#5c6662",
    accent: "#4c7100",
    levels: ["#c6cfcb", "#9db766", "#6d9419", "#4c7100", "#263a00"],
    glow: false,
    afterglow: [0.18, 0.07],
  },
};

/** Terminal text: 16px on a 26px line. Google Sans Code advances 0.6em. */
export const TEXT = { size: 16, line: 26, baseline: 18, advance: 9.6 } as const;
const DISPLAY = { size: 36, line: 48, baseline: 36, advance: 21.6 } as const;
const FONT_STACK = `${FAMILY},ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

export type Tone = "fg" | "muted" | "accent";

export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  /** Dotted underline: the terminal's mark for a hyperlink. */
  link?: boolean;
  /** Blinks like a waiting prompt. */
  cursor?: boolean;
}

export interface Line {
  spans: Span[];
  display?: boolean;
}

/** Terminal cells a string occupies: East Asian wide characters and emoji take two. */
export function columns(text: string): number {
  let n = 0;
  for (const char of text) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u.test(char) ? 2 : 1;
  return n;
}

/** Word wrap to `width` columns. Lines that fit are balanced, so a title
 *  never leaves one word stranded on its second line; text past `maxLines`
 *  ends in an ellipsis. */
export function wrap(text: string, width: number, maxLines: number): string[] {
  // A word wider than a whole line is cut where the line ends.
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const pieces: string[] = [];
    let piece = "";
    for (const char of word) {
      if (columns(piece + char) > width) {
        pieces.push(piece);
        piece = "";
      }
      piece += char;
    }
    return piece ? [...pieces, piece] : pieces;
  });
  const greedy = (limit: number): string[] => {
    const lines: string[] = [];
    for (const word of words) {
      const line = lines.at(-1);
      if (line !== undefined && columns(`${line} ${word}`) <= limit) lines[lines.length - 1] = `${line} ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  const lines = greedy(width);
  if (lines.length <= maxLines) {
    // The narrowest measure that still needs no extra line.
    let narrow = Math.max(...words.map(columns));
    while (narrow < width && greedy(narrow).length > lines.length) narrow++;
    return greedy(narrow);
  }

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (columns(last) + 1 > width) last = Array.from(last).slice(0, -1).join("");
  kept[maxLines - 1] = `${last.replace(/[\s,.;:–—-]+$/, "")}…`;
  return kept;
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Lines of terminal output on a transparent ground, so GitHub's own page is
 * the screen. `height` pads the block and centres it vertically.
 */
export function terminal(lines: Line[], options: { width: number; height?: number; palette: Palette; title: string }): string {
  const { palette } = options;
  const contentHeight = lines.reduce((sum, line) => sum + (line.display ? DISPLAY.line : TEXT.line), 0);
  const height = Math.max(options.height ?? contentHeight, contentHeight);
  let y = Math.round((height - contentHeight) / 2);

  let regular = "";
  let bold = "";
  let text = "";
  let marks = "";
  for (const line of lines) {
    const metrics = line.display ? DISPLAY : TEXT;
    const baseline = y + metrics.baseline;
    let col = 0;
    let tspans = "";
    for (const span of line.spans) {
      const x = +(col * metrics.advance).toFixed(2);
      const width = columns(span.text) * metrics.advance;
      const classes = [span.tone ?? "fg", span.bold || line.display ? "b" : "", span.cursor ? "cursor" : ""].filter(Boolean).join(" ");
      tspans += `<tspan x="${x}" class="${classes}">${escapeXml(span.text)}</tspan>`;
      if (span.link) marks += `<path class="link" d="M${x + 1} ${baseline + 5}h${+(width - 2).toFixed(2)}"/>`;
      if (span.bold || line.display) bold += span.text;
      else regular += span.text;
      col += columns(span.text);
    }
    if (tspans) text += `<text y="${baseline}"${line.display ? ` class="display"` : ""} xml:space="preserve">${tspans}</text>`;
    y += metrics.line;
  }

  const css =
    fontFaces(regular, bold) +
    `text{font-family:${FONT_STACK};font-size:${TEXT.size}px}.display{font-size:${DISPLAY.size}px;letter-spacing:-0.02em}.b{font-weight:700}` +
    `.fg{fill:${palette.fg}}.muted{fill:${palette.muted}}.accent{fill:${palette.accent}}` +
    `.link{fill:none;stroke:${palette.muted};stroke-width:1.25;stroke-dasharray:0 3;stroke-linecap:round}` +
    `.cursor{animation:blink 1.1s step-end infinite}@keyframes blink{50%{opacity:0}}` +
    `@media (prefers-reduced-motion:reduce){.cursor{animation:none}}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${height}" viewBox="0 0 ${options.width} ${height}" role="img">` +
    `<title>${escapeXml(options.title)}</title><style>${css}</style>${marks}${text}</svg>\n`
  );
}

/** Size of one torus character: 10px type, one cell 6 by 10. */
export const YEAR_CELL = { size: 10, width: 6, height: 10, baseline: 8 } as const;

/**
 * The spinning year. Every frame is drawn once and shown for one slot of the
 * loop by a shared CSS keyframe, offset per frame; no script, so GitHub's
 * image proxy serves it as is. Like a phosphor screen, a frame does not go
 * dark the moment the next one lands: it lingers for two slots at the
 * palette's afterglow, which also smooths the eight-frames-a-second motion.
 */
export function yearSvg(
  frames: TorusFrame[],
  options: { cols: number; rows: number; width: number; height: number; period: number; palette: Palette; title: string },
): string {
  const { cols, rows, palette, period } = options;
  const left = (options.width - cols * YEAR_CELL.width) / 2;
  const top = (options.height - rows * YEAR_CELL.height) / 2;
  const slot = period / frames.length;
  // Reduced motion holds the pose that shows the most of the year.
  const lit = frames.map((frame) => frame.glyph.reduce((n, g) => n + (g >= 0 ? 1 : 0), 0));
  const poster = lit.indexOf(Math.max(...lit));

  let body = "";
  frames.forEach((frame, index) => {
    const layers: string[] = [];
    for (let level = 0; level < 5; level++) {
      let tspans = "";
      for (let r = 0; r < rows; r++) {
        let first = -1;
        let last = -1;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (frame.glyph[i]! >= 0 && frame.level[i] === level) {
            if (first < 0) first = c;
            last = c;
          }
        }
        if (first < 0) continue;
        let run = "";
        for (let c = first; c <= last; c++) {
          const i = r * cols + c;
          run += frame.glyph[i]! >= 0 && frame.level[i] === level ? RAMP[frame.glyph[i]!] : " ";
        }
        tspans += `<tspan x="${+(left + first * YEAR_CELL.width).toFixed(2)}" y="${+(top + r * YEAR_CELL.height + YEAR_CELL.baseline).toFixed(2)}">${escapeXml(run)}</tspan>`;
      }
      if (tspans) layers.push(`<text class="l${level}" xml:space="preserve">${tspans}</text>`);
    }
    body += `<g class="frame"${index === poster ? ` id="poster"` : ""} style="animation-delay:${+(index * slot).toFixed(4)}s">${layers.join("")}</g>`;
  });

  const glow = palette.glow
    ? `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.2" result="blur"/>` +
      `<feComponentTransfer in="blur" result="halo"><feFuncA type="linear" slope="0.7"/></feComponentTransfer>` +
      `<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : "";

  const step = 100 / frames.length;
  const [trail, fade] = palette.afterglow;
  const css =
    fontFaces(RAMP) +
    `text{font-family:${FONT_STACK};font-size:${YEAR_CELL.size}px}` +
    palette.levels.map((ink, level) => `.l${level}{fill:${ink}}`).join("") +
    `.frame{visibility:hidden;animation:frame ${period}s step-end infinite}` +
    `@keyframes frame{0%{visibility:visible;opacity:1}${+step.toFixed(4)}%{opacity:${trail}}` +
    `${+(step * 2).toFixed(4)}%{opacity:${fade}}${+(step * 3).toFixed(4)}%{visibility:hidden;opacity:0}}` +
    `@media (prefers-reduced-motion:reduce){.frame{animation:none}#poster{visibility:visible}}`;

  const content = palette.glow ? `<defs>${glow}</defs><g filter="url(#glow)">${body}</g>` : body;
  const { width, height } = options;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>${escapeXml(options.title)}</title><style>${css}</style>${content}</svg>\n`
  );
}
