import { FAMILY, fontFaces } from "./font";
import { columns, escapeXml } from "./text";
import type { Palette } from "./theme";

/**
 * Every image sits on a 28px band grid. 28 is the smallest pitch that a phone
 * still shows without a gap: GitHub scales a 400px pane to its ~308px column,
 * and 28px lands on the 21px line box its paragraphs impose.
 */
export const BAND = 28;
/** A pane in a two-column row. Two of them plus GitHub's 20px image padding fill the 846px README column. */
export const HALF = 400;
export const GUTTER = 20;
export const FULL = HALF * 2 + GUTTER;
/** Boxes sit 4px inside their image, so the 20px gutter plus 8 makes 28 between columns, the same as between rows. */
export const INSET = 4;
/** Where text starts inside an image. */
export const PAD = INSET + 12;
export const TEXT = { size: 14, advance: 8.4, baseline: 19 } as const;
export const FONT_STACK = `${FAMILY},ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

export type Tone = "fg" | "muted" | "accent" | "onAccent";

export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  /** Dotted underline: the terminal's mark for a hyperlink. */
  link?: boolean;
}

/** Collects every character drawn, so the embedded font carries exactly those. */
export class Ink {
  regular = "";
  bold = "";

  /** One line of spans from x at baseline y, `size` px type. */
  line(x: number, y: number, spans: Span[], size: number = TEXT.size): string {
    const advance = size * 0.6;
    let col = 0;
    let tspans = "";
    let marks = "";
    for (const span of spans) {
      const left = +(x + col * advance).toFixed(2);
      const width = columns(span.text) * advance;
      tspans += `<tspan x="${left}" class="${span.tone ?? "fg"}${span.bold ? " b" : ""}">${escapeXml(span.text)}</tspan>`;
      if (span.link && span.text.trim()) marks += `<path class="link" d="M${left + 1} ${y + 4.5}h${+(width - 2).toFixed(2)}"/>`;
      if (span.bold) this.bold += span.text;
      else this.regular += span.text;
      col += columns(span.text);
    }
    // A style, not an attribute: the stylesheet's text rule would beat an attribute.
    const sizeAttr = size === TEXT.size ? "" : ` style="font-size:${size}px"`;
    return `${marks}<text y="${y}"${sizeAttr} xml:space="preserve">${tspans}</text>`;
  }

  /** Same, but the line ends at x. */
  lineEnd(x: number, y: number, spans: Span[], size: number = TEXT.size): string {
    const width = spans.reduce((n, span) => n + columns(span.text), 0) * size * 0.6;
    return this.line(x - width, y, spans, size);
  }
}

/** Which box edges a piece draws. A pane cut into several images draws its top
 *  in the first and its bottom in the last; the pieces between draw the sides. */
export interface Chrome {
  top?: { title: string; meta?: string };
  bottom?: boolean;
  /** False for an image that is not part of a box at all. */
  sides?: boolean;
}

export interface Drawn {
  body: string;
  defs?: string;
  css?: string;
}

/** Baseline of content band `n`, counting the top border's band as 0. */
export function baseline(band: number): number {
  return band * BAND + TEXT.baseline;
}

/** One image: box chrome, whatever `draw` puts inside, and the font subset for both. */
export function piece(options: { width: number; bands: number; palette: Palette; chrome: Chrome; title: string; draw: (ink: Ink) => Drawn }): string {
  const { width, bands, palette, chrome } = options;
  const height = bands * BAND;
  const ink = new Ink();
  const drawn = options.draw(ink);

  const left = INSET + 0.5;
  const right = width - INSET - 0.5;
  const top = BAND / 2 - 0.5;
  const bottom = height - BAND / 2 + 0.5;
  const r = 6;
  let path = "";
  let labels = "";

  if (chrome.top) {
    // The title and the meta sit in gaps cut into the top edge.
    const gaps: [number, number][] = [];
    const titleX = left + 14;
    labels += ink.line(titleX, top + 5, [{ text: chrome.top.title, tone: "accent", bold: true }]);
    gaps.push([titleX - 6, titleX + columns(chrome.top.title) * TEXT.advance + 6]);
    if (chrome.top.meta) {
      const metaEnd = right - 14;
      labels += ink.lineEnd(metaEnd, top + 5, [{ text: chrome.top.meta, tone: "muted" }]);
      gaps.push([metaEnd - columns(chrome.top.meta) * TEXT.advance - 6, metaEnd + 6]);
    }
    const start = chrome.bottom ? bottom - r : height;
    path += `M${left} ${start}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}`;
    for (const [from, to] of gaps) path += `H${from}M${to} ${top}`;
    path += `H${right - r}A${r} ${r} 0 0 1 ${right} ${top + r}V${chrome.bottom ? bottom - r : height}`;
    if (chrome.bottom) path += `A${r} ${r} 0 0 1 ${right - r} ${bottom}H${left + r}A${r} ${r} 0 0 1 ${left} ${bottom - r}`;
  } else if (chrome.bottom) {
    path += `M${left} 0V${bottom - r}A${r} ${r} 0 0 0 ${left + r} ${bottom}H${right - r}A${r} ${r} 0 0 0 ${right} ${bottom - r}V0`;
  } else if (chrome.sides !== false) {
    path += `M${left} 0V${height}M${right} 0V${height}`;
  }

  const css =
    fontFaces(ink.regular, ink.bold) +
    `text{font-family:${FONT_STACK};font-size:${TEXT.size}px}.b{font-weight:700}` +
    `.fg{fill:${palette.fg}}.muted{fill:${palette.muted}}.accent{fill:${palette.accent}}.onAccent{fill:${palette.onAccent}}` +
    `.box{fill:none;stroke:${palette.border};stroke-width:1}` +
    `.link{fill:none;stroke:${palette.muted};stroke-width:1.2;stroke-dasharray:0 3;stroke-linecap:round}` +
    (drawn.css ?? "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>${escapeXml(options.title)}</title><style>${css}</style>${drawn.defs ? `<defs>${drawn.defs}</defs>` : ""}` +
    `${path ? `<path class="box" d="${path}"/>` : ""}${labels}${drawn.body}</svg>\n`
  );
}
