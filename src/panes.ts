import type { Feed } from "./feed";
import type { Commit, Day, Link, Profile } from "./github";
import { change, dayNumber, type Metric, type Snapshot } from "./history";
import { BAND, HALF, INSET, Ink, PAD, TEXT, baseline, piece, type Chrome, type Drawn, type Span } from "./pane";
import type { YearStats } from "./stats";
import { bare, columns, escapeXml, fit, wrap } from "./text";
import type { Palette } from "./theme";
import { RAMP, SHAPES, renderShape, shapeWeeks, type Frame, type Shape } from "./shapes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** LED pitch of the dot-matrix graphs: two dots per character cell. */
const DOT = TEXT.advance / 2;
/** Unlit LEDs: present enough to read as a panel, quiet enough not to crowd it. */
const UNLIT = 0.3;

export interface DrawContext {
  ink: Ink;
  width: number;
  bands: number;
  palette: Palette;
}

/** One image of a pane. */
export interface Piece {
  /** File stem: `<name>-dark.svg`, `<name>-light.svg`. */
  name: string;
  alt: string;
  href?: string;
  /** Height in 28px bands before the layout stretches it; 0 until measured. */
  bands: number;
  chrome: Chrome;
  draw(context: DrawContext): Drawn;
}

/** A single pane is one image and stretches to its neighbour's height. A stack
 *  is one image per line, so each line can be its own link; its last image
 *  takes up any extra height. */
export interface Pane {
  kind: "single" | "stack";
  pieces: Piece[];
}

export interface Image {
  name: string;
  width: number;
  alt: string;
  href?: string;
  render(palette: Palette): string;
}

/** Places a piece at a size and binds everything its SVG needs. main.ts adds
 *  a content hash to the name when it writes the files. */
export function place(item: Piece, width: number, bands: number, margin = 0): Image {
  return {
    name: item.name,
    width: width + margin,
    alt: item.alt,
    href: item.href,
    render: (palette) =>
      piece({ width, bands, margin, palette, chrome: item.chrome, title: item.alt, draw: (ink) => item.draw({ ink, width, bands, palette }) }),
  };
}

export function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

function monthYear(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** "Sep  4" within `year`, "Sep 2025" outside it, so a column of dates lines up. */
function shortDate(date: Date, year: number): string {
  const month = MONTHS[date.getUTCMonth()];
  return date.getUTCFullYear() === year ? `${month} ${String(date.getUTCDate()).padStart(2, " ")}` : `${month} ${date.getUTCFullYear()}`;
}

/** The window the figures cover, as prose: "the last year", or the calendar year asked for. */
function period(profile: Profile): string {
  return profile.year ? String(profile.year) : "the last year";
}

/** Content columns of a pane `width` px wide. */
function textCols(width: number): number {
  return Math.floor((width - PAD * 2) / TEXT.advance);
}

/** A change with its sign: "+3", "-2", "±0". */
function signed(n: number): string {
  return `${n > 0 ? "+" : n === 0 ? "±" : ""}${n.toLocaleString("en-US")}`;
}

/** A dot-matrix mask: one lit LED per DOT square, aligned so bars rising from `floor` fill whole dots. */
function dotMask(id: string, x: number, y: number, width: number, height: number, floor: number): string {
  return (
    `<pattern id="${id}-dots" x="${x}" y="${floor}" width="${DOT}" height="${DOT}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${DOT / 2}" cy="${DOT / 2}" r="1.4" fill="#fff"/></pattern>` +
    `<mask id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#${id}-dots)"/></mask>`
  );
}

/** A row of LEDs: the unlit panel, then `lit` of them in `color` from the left. */
function ledBar(id: string, x: number, y: number, dots: number, lit: number, color: string, palette: Palette): Drawn {
  return {
    defs: dotMask(id, x, y, dots * DOT, DOT * 2, y),
    body:
      `<rect x="${x}" y="${y}" width="${+(dots * DOT).toFixed(2)}" height="${DOT * 2}" fill="${palette.border}" opacity="${UNLIT}" mask="url(#${id})"/>` +
      `<rect x="${x}" y="${y}" width="${+(lit * DOT).toFixed(2)}" height="${DOT * 2}" fill="${color}" mask="url(#${id})"/>`,
  };
}

// ── year ────────────────────────────────────────────────────────────────────

/** Character cells of the year's frames, in px. */
const GLYPH_FULL = { size: 10, width: 6, height: 10, baseline: 8 } as const;
/** Compact trades size for resolution: finer cells, so a smaller shape keeps its detail. */
const GLYPH_COMPACT = { size: 7, width: 4.2, height: 7, baseline: 5.6 } as const;
type Glyph = typeof GLYPH_FULL | typeof GLYPH_COMPACT;
const FRAMES = 120;
const PERIOD = 15;
const frameCache = new Map<string, Frame[]>();

/**
 * The year as a spinning shape (shapes.ts). Every frame is drawn once and a
 * shared CSS keyframe shows each for one slot, offset per frame; no script, so
 * GitHub's image proxy serves it as is. Like a phosphor screen, a frame lingers
 * two more slots at the palette's afterglow, which also smooths 8 fps motion.
 */
export function yearPane(profile: Profile, href: string, compact: boolean, shape: Shape): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const span = days.length ? `${monthYear(days[0]!.date)} – ${monthYear(days.at(-1)!.date)}` : "";
  const glyph: Glyph = compact ? GLYPH_COMPACT : GLYPH_FULL;
  const { title, how } = SHAPES[shape];
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "year-compact" : "year",
        alt: `${title} made of ${profile.login}'s contributions over ${period(profile)}: ${how}. Opens ${bare(href)}.`,
        href,
        bands: compact ? 8 : 13,
        chrome: { top: { title: "year", meta: span }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          // Compact drops the legend line to save a band, unless the pane was
          // stretched tall beside other panes and has the room anyway.
          const legend = !compact || bands >= 12 ? 1 : 0;
          const area = (bands - 2 - legend) * BAND;
          const cols = Math.floor((width - INSET * 2 - 16) / glyph.width);
          // The canvas stops at a square: a pane stretched tall beside others
          // keeps its shape the size a square pane would draw it.
          const rows = Math.min(Math.floor((area - 8) / glyph.height), Math.floor((cols * glyph.width) / glyph.height));
          const key = `${shape} ${cols}x${rows}`;
          let frames = frameCache.get(key);
          if (!frames) {
            frames = renderShape(shape, profile, { cols, rows, frames: FRAMES, cellAspect: glyph.width / glyph.height });
            frameCache.set(key, frames);
          }
          ink.regular += RAMP;
          const left = (width - cols * glyph.width) / 2;
          const top = BAND + (area - rows * glyph.height) / 2;
          const body = frameMarkup(frames, cols, rows, left, top, glyph);

          // The legend, in GitHub's own words: less to more.
          let legendMarkup = "";
          if (legend) {
            const y = baseline(bands - 2);
            const swatchX = PAD + 5 * TEXT.advance;
            legendMarkup =
              ink.line(PAD, y, [{ text: "less", tone: "muted" }]) +
              palette.levels.map((color, level) => `<rect x="${swatchX + level * 13}" y="${y - 10}" width="10" height="10" rx="2" fill="${color}"/>`).join("") +
              ink.line(swatchX + 5 * 13 + 4, y, [{ text: "more", tone: "muted" }]) +
              ink.lineEnd(width - PAD, y, [{ text: `${shapeWeeks(shape, profile)} weeks × 7 days`, tone: "muted" }]);
          }

          const slot = PERIOD / frames.length;
          const step = 100 / frames.length;
          const [trail, fade] = palette.afterglow;
          return {
            defs: palette.glow
              ? `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${compact ? 1.6 : 2.2}" result="blur"/>` +
                `<feComponentTransfer in="blur" result="halo"><feFuncA type="linear" slope="0.7"/></feComponentTransfer>` +
                `<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
              : "",
            body: (palette.glow ? `<g filter="url(#glow)">${body}</g>` : body) + legendMarkup,
            css:
              `.t{font-size:${glyph.size}px}` +
              palette.levels.map((color, level) => `.l${level}{fill:${color}}`).join("") +
              `.frame{visibility:hidden;animation:frame ${PERIOD}s step-end infinite}` +
              `@keyframes frame{0%{visibility:visible;opacity:1}${+step.toFixed(4)}%{opacity:${trail}}` +
              `${+(step * 2).toFixed(4)}%{opacity:${fade}}${+(step * 3).toFixed(4)}%{visibility:hidden;opacity:0}}` +
              `@media (prefers-reduced-motion:reduce){.frame{animation:none}.frame.poster{visibility:visible}}` +
              frames.map((_, index) => `#f${index}{animation-delay:${+(index * slot).toFixed(4)}s}`).join(""),
          };
        },
      },
    ],
  };
}

/** The pose that shows the most of the year: what reduced motion holds. */
function poster(frames: Frame[]): number {
  const lit = frames.map((frame) => frame.glyph.reduce((n, g) => n + (g >= 0 ? 1 : 0), 0));
  return lit.indexOf(Math.max(...lit));
}

function frameMarkup(frames: Frame[], cols: number, rows: number, left: number, top: number, glyph: Glyph): string {
  const still = poster(frames);
  let body = "";
  frames.forEach((frame, index) => {
    let layers = "";
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
        const x = +(left + first * glyph.width).toFixed(2);
        const y = +(top + r * glyph.height + glyph.baseline).toFixed(2);
        tspans += `<tspan x="${x}" y="${y}">${escapeXml(run)}</tspan>`;
      }
      if (tspans) layers += `<text class="t l${level}" xml:space="preserve">${tspans}</text>`;
    }
    body += `<g class="frame${index === still ? " poster" : ""}" id="f${index}">${layers}</g>`;
  });
  return body;
}

// ── whoami ──────────────────────────────────────────────────────────────────

export function whoamiPane(profile: Profile, stats: YearStats, who: string[], href: string | undefined, compact: boolean): Pane {
  const name = who[0] ?? profile.name ?? profile.login;
  const identity = who.length > 1 ? who.slice(1) : defaultIdentity(profile);
  const figure = (text: string): Span => ({ text, tone: "accent" });

  const figures: [string, Span[]][] = [];
  const streak = profile.live ? "streak" : "best streak";
  if (stats.total > 0) figures.push(["contributions", [figure(stats.total.toLocaleString("en-US")), { text: ` in ${period(profile)}` }]]);
  else figures.push(["contributions", [{ text: `none in ${period(profile)}`, tone: "muted" }]]);
  if (stats.peak) figures.push(["peak", [figure(stats.peak.count.toLocaleString("en-US")), { text: ` on ${dayMonthYear(stats.peak.date)}` }]]);
  if (stats.busiestWeekday !== null) figures.push(["busiest", [figure(WEEKDAYS[stats.busiestWeekday]!)]]);
  if (stats.streak >= 2) figures.push([streak, [figure(`${stats.streak} days`)]]);

  const alt = `${[name, identity.filter(Boolean).join(" ")].filter(Boolean).join(" — ")} ${figures
    .map(([key, spans]) => `${key}: ${spans.map((span) => span.text).join("")}`)
    .join("; ")}.`;
  const chrome: Chrome = { top: { title: "whoami", meta: `@${profile.login}` }, bottom: true };

  if (compact) {
    // Identity runs on as prose; the figures fold into two lines.
    const prose = identity.filter(Boolean).join(" ");
    const proseLines = prose ? wrap(prose, textCols(HALF), 3) : [];
    const first: Span[] =
      stats.total > 0
        ? [figure(stats.total.toLocaleString("en-US")), { text: " contributions" }]
        : [{ text: `no contributions in ${period(profile)}`, tone: "muted" }];
    if (stats.peak) first.push({ text: " · peak ", tone: "muted" }, figure(stats.peak.count.toLocaleString("en-US")));
    const second: Span[] = [];
    if (stats.busiestWeekday !== null) second.push({ text: "busiest ", tone: "muted" }, figure(WEEKDAYS[stats.busiestWeekday]!));
    if (stats.streak >= 2) second.push({ text: second.length ? " · " : "", tone: "muted" }, figure(`${stats.streak}-day`), { text: ` ${streak}` });
    const figureLines = second.length ? [first, second] : [first];
    const natural = 2 + 1 + proseLines.length + figureLines.length;
    return {
      kind: "single",
      pieces: [
        {
          name: "whoami-compact",
          alt,
          href,
          bands: natural,
          chrome,
          draw: ({ ink, width, bands, palette }) => {
            const typing = palette.effects?.has("typing") ?? false;
            let band = 1 + Math.floor((bands - natural) / 2);
            const nameSize = Math.min(20, Math.floor((width - PAD * 2) / ((columns(name) + (typing ? 1 : 0)) * 0.6)));
            const named = nameLine(ink, band * BAND + 20, name, nameSize, typing);
            let body = named.body;
            band++;
            for (const line of prose ? wrap(prose, textCols(width), 3) : []) body += ink.line(PAD, baseline(band++), [{ text: line }]);
            for (const spans of figureLines) body += ink.line(PAD, baseline(band++), spans);
            return { ...named, body };
          },
        },
      ],
    };
  }

  const natural = 2 + 2 + identity.length + 1 + figures.length;
  return {
    kind: "single",
    pieces: [
      {
        name: "whoami",
        alt,
        href,
        // Borders, a two-band name, the identity lines, a gap, the figures.
        bands: natural,
        chrome,
        draw: ({ ink, width, bands, palette }) => {
          const typing = palette.effects?.has("typing") ?? false;
          const cols = textCols(width);
          let band = 1 + Math.floor((bands - natural) / 2);
          const nameSize = Math.min(26, Math.floor((width - PAD * 2) / ((columns(name) + (typing ? 1 : 0)) * 0.6)));
          const named = nameLine(ink, band * BAND + 37, name, nameSize, typing);
          let body = named.body;
          band += 2;
          for (const line of identity) {
            if (line) body += ink.line(PAD, baseline(band), [{ text: fit(line, cols) }]);
            band++;
          }
          band++;
          for (const [key, spans] of figures) {
            body += ink.line(PAD, baseline(band), [{ text: key.padEnd(15), tone: "muted" }, ...spans]);
            band++;
          }
          return { ...named, body };
        },
      },
    ],
  };
}

/**
 * The name at baseline y. With the `typing` effect it types itself in, a
 * character a step, behind a block cursor that keeps blinking once it is
 * done: a clip that widens in steps and a cursor that moves with it.
 */
function nameLine(ink: Ink, y: number, name: string, size: number, typing: boolean): Drawn {
  const text = ink.line(PAD, y, [{ text: name, bold: true }], size);
  if (!typing) return { body: text };
  const chars = columns(name);
  const advance = size * 0.6;
  const width = +(chars * advance).toFixed(2);
  const typed = +(chars * 0.1).toFixed(2);
  const delay = 0.5;
  return {
    defs: `<clipPath id="typed"><rect class="type" width="${PAD + width}" height="${y + size}"/></clipPath>`,
    body:
      `<g clip-path="url(#typed)">${text}</g>` +
      `<rect class="type caret accent" x="${PAD + width}" y="${+(y - size * 0.8).toFixed(2)}" width="${+advance.toFixed(2)}" height="${size}"/>`,
    css:
      `.type{animation:type ${typed}s steps(${chars}) ${delay}s both}` +
      `.caret{animation:type ${typed}s steps(${chars}) ${delay}s both,blink 1s step-end ${delay + typed}s infinite}` +
      `@keyframes type{from{transform:translateX(-${width}px)}}@keyframes blink{50%{opacity:0}}` +
      `@media (prefers-reduced-motion:reduce){.type,.caret{animation:none}}`,
  };
}

function defaultIdentity(profile: Profile): string[] {
  const lines = profile.bio ? wrap(profile.bio, 43, 3) : [];
  const where = [profile.company, profile.location].filter(Boolean).join(" · ");
  return where ? [...lines, where] : lines;
}

// ── activity graph ──────────────────────────────────────────────────────────

/**
 * Contributions per day as a btop-style dot-matrix graph that scrolls a day at
 * a time. The newest day enters on the right; after the last one the year
 * replays from the start, past a marker. Reduced motion holds the newest window.
 */
export function graphPane(profile: Profile, href: string, compact: boolean): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const peak = Math.max(1, ...days.map((day) => day.count));
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "graph-compact" : "graph",
        alt: `Contributions per day over ${period(profile)} as a scrolling dot-matrix graph; the busiest day had ${peak}. Opens ${bare(href)}.`,
        href,
        bands: compact ? 5 : 7,
        chrome: { top: { title: "activity", meta: `per day · max ${peak}` }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          const x0 = PAD;
          const x1 = width - PAD;
          const y0 = BAND + 6;
          const floor = (bands - 2) * BAND - 2;
          const visible = Math.floor((x1 - x0) / DOT);
          const levels = Math.floor((floor - y0) / DOT);
          const total = days.length;

          let bars = "";
          let labels = "";
          for (let i = 0; i < total * 2; i++) {
            const day = days[i % total]!;
            const x = +(x0 + i * DOT).toFixed(2);
            // Square-root scale: one heavy day would otherwise flatten the rest of the year.
            const n = day.count > 0 ? Math.max(1, Math.round(Math.sqrt(day.count / peak) * levels)) : 0;
            if (n) bars += `M${x} ${+(floor - n * DOT).toFixed(2)}h${DOT}v${+(n * DOT).toFixed(2)}h${-DOT}z`;
            if (day.date.endsWith("-01")) labels += ink.line(x, baseline(bands - 2), [{ text: MONTHS[Number(day.date.slice(5, 7)) - 1]!, tone: "muted" }]);
          }
          // Where the last day meets the start of the replay: today, or the end of a year gone by.
          const seam = +(x0 + total * DOT).toFixed(2);
          const marker =
            `<path d="M${seam} ${y0}V${floor}" stroke="${palette.accent}" stroke-width="1" stroke-dasharray="2 3"/>` +
            ink.line(seam + 4, y0 + 10, [{ text: profile.live ? "now" : "end", tone: "accent" }], 11);

          const shift = (total - visible) * DOT;
          const cycle = total / 4; // four days a second
          return {
            defs:
              dotMask("leds", x0, y0, x1 - x0, floor - y0, floor) +
              dotMask("strip-leds", x0, y0, total * 2 * DOT, floor - y0, floor) +
              `<linearGradient id="heat" x1="0" y1="${floor}" x2="0" y2="${y0}" gradientUnits="userSpaceOnUse">` +
              `<stop offset="0" stop-color="${palette.levels[1]}"/><stop offset="0.5" stop-color="${palette.levels[3]}"/><stop offset="1" stop-color="${palette.levels[4]}"/></linearGradient>` +
              `<clipPath id="window"><rect x="${x0}" y="0" width="${x1 - x0}" height="${bands * BAND}"/></clipPath>`,
            body:
              `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${floor - y0}" fill="${palette.border}" opacity="${UNLIT}" mask="url(#leds)"/>` +
              `<g clip-path="url(#window)"><g class="strip">` +
              `<path d="${bars}" fill="url(#heat)" mask="url(#strip-leds)"/>${marker}${labels}</g></g>`,
            css:
              `.strip{transform:translateX(-${+shift.toFixed(2)}px);animation:scroll ${+cycle.toFixed(2)}s steps(${total}) infinite;animation-delay:-${+((cycle * (total - visible)) / total).toFixed(2)}s}` +
              `@keyframes scroll{from{transform:translateX(0)}to{transform:translateX(-${+(total * DOT).toFixed(2)}px)}}` +
              `@media (prefers-reduced-motion:reduce){.strip{animation:none}}`,
          };
        },
      },
    ],
  };
}

// ── posts ───────────────────────────────────────────────────────────────────

export function postsPane(feed: Feed, options: { count: number; note: string[]; archive: string | null; source: string; compact: boolean }): Pane {
  const { compact } = options;
  const shown = feed.posts.slice(0, options.count);
  const thisYear = new Date().getUTCFullYear();
  const dates = shown.map((post) => (post.date ? shortDate(post.date, thisYear) : ""));
  const gutter = Math.max(0, ...dates.map(columns)) + 2;
  const host = bare(options.source).replace(/\/.*$/, "");
  const archiveShown = options.archive ? bare(options.archive) : undefined;
  // Compact drops the note and holds every title to one line.
  const note = compact ? [] : options.note;

  const head: Piece = {
    name: "posts-head",
    alt: note.length ? `Posts from ${host}: ${note.join(" ")}` : `Posts from ${host}`,
    href: options.archive ?? undefined,
    bands: 1 + note.length,
    chrome: { top: { title: "posts", meta: host } },
    draw: ({ ink }) => ({ body: note.map((line, i) => ink.line(PAD, baseline(1 + i), [{ text: `# ${line}`, tone: "muted" }])).join("") }),
  };

  const rows: Piece[] = shown.map((post, i) => ({
    name: "post",
    alt: post.title,
    href: post.url,
    bands: compact ? 1 : 0,
    chrome: {},
    draw: ({ ink, width }) => {
      const room = textCols(width) - gutter;
      const lines = compact ? [fit(post.title, room)] : wrap(post.title, room, 2);
      return {
        body: lines
          .map((line, row) => ink.line(PAD, baseline(row), [{ text: (row === 0 ? dates[i]! : "").padEnd(gutter), tone: "muted" }, { text: line, link: true }]))
          .join(""),
      };
    },
  }));

  const foot: Piece = {
    name: "posts-foot",
    alt: archiveShown ? `All posts at ${archiveShown}` : "End of posts",
    href: options.archive ?? undefined,
    bands: options.archive ? 2 : 1,
    chrome: { bottom: true },
    draw: ({ ink }) => ({
      body: archiveShown
        ? ink.line(PAD, baseline(0), [{ text: "…".padEnd(gutter), tone: "muted" }, { text: "all of them at ", tone: "muted" }, { text: archiveShown, tone: "muted", link: true }])
        : "",
    }),
  };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

/** Wrapped rows know their height only once the column width is known. */
export function measureStack(pane: Pane, width: number): Pane {
  return {
    ...pane,
    pieces: pane.pieces.map((item) => {
      if (item.bands > 0) return item;
      // Rows draw one band per line; count the lines they would draw.
      const { body } = item.draw({ ink: new Ink(), width, bands: 2, palette: {} as Palette });
      return { ...item, bands: Math.max(1, (body.match(/<text /g) ?? []).length) };
    }),
  };
}

/**
 * A stack drawn as one image, for a row that already has a list on its other
 * side: two lists cannot flow beside each other on GitHub. Its lines stop being
 * separate links; the whole pane links where its heading did.
 */
export function flatten(pane: Pane): Pane {
  const first = pane.pieces[0]!;
  const natural = pane.pieces.reduce((n, item) => n + item.bands, 0);
  return {
    kind: "single",
    pieces: [
      {
        name: `${first.name}-flat`,
        alt: pane.pieces.map((item) => item.alt).join(". "),
        href: first.href ?? pane.pieces.find((item) => item.href)?.href,
        bands: natural,
        chrome: { top: first.chrome.top, bottom: true },
        draw: (context) => {
          let defs = "";
          let body = "";
          let css = "";
          let y = 0;
          pane.pieces.forEach((item, k) => {
            const drawn = item.draw({ ...context, bands: item.bands });
            // Each piece named its masks for an SVG of its own; keep them apart.
            const scope = (markup: string) => markup.replace(/id="([^"]+)"/g, `id="s${k}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#s${k}-$1)`);
            defs += scope(drawn.defs ?? "");
            body += `<g transform="translate(0 ${y})">${scope(drawn.body)}</g>`;
            css += drawn.css ?? "";
            y += item.bands * BAND;
          });
          return { defs, body, css };
        },
      },
    ],
  };
}

// ── top ─────────────────────────────────────────────────────────────────────

export function topPane(profile: Profile, count: number, compact: boolean): Pane | null {
  const repos = profile.repos.slice(0, count);
  if (repos.length === 0) return null;
  const most = repos[0]!.commits;
  const layout = (width: number) => {
    const cols = textCols(width);
    const lang = 10;
    const commits = 7;
    const bar = 8;
    return { name: cols - lang - commits - bar - 3, lang, commits, bar };
  };

  // Compact drops the column headings.
  const head: Piece = {
    name: compact ? "top-head-compact" : "top-head",
    alt: `Public repositories ${profile.login} committed to most in ${period(profile)}`,
    href: `https://github.com/${profile.login}?tab=repositories`,
    bands: compact ? 1 : 2,
    chrome: { top: { title: "top", meta: `public · ${profile.year ?? "last year"}` } },
    draw: ({ ink, width }) => {
      if (compact) return { body: "" };
      const c = layout(width);
      return {
        body: ink.line(PAD, baseline(1), [
          { text: "REPO".padEnd(c.name + 1), tone: "muted" },
          { text: "LANG".padEnd(c.lang + 1), tone: "muted" },
          { text: "".padEnd(c.bar + 1), tone: "muted" },
          { text: "COMMITS".padStart(c.commits), tone: "muted" },
        ]),
      };
    },
  };

  const rows: Piece[] = repos.map((repo) => ({
    name: "top-repo",
    alt: `${repo.name}: ${repo.commits} commit${repo.commits === 1 ? "" : "s"} in ${period(profile)}${repo.language ? `, ${repo.language}` : ""}`,
    href: repo.url,
    bands: 1,
    chrome: {},
    draw: ({ ink, width, palette }) => {
      const c = layout(width);
      const y = baseline(0);
      const barX = PAD + (c.name + 1 + c.lang + 1) * TEXT.advance;
      const dots = c.bar * 2;
      const bar = ledBar("leds", barX, y - 9, dots, Math.max(1, Math.round((repo.commits / most) * dots)), palette.accent, palette);
      const name = fit(repo.name, c.name);
      return {
        defs: bar.defs,
        body:
          ink.line(PAD, y, [
            { text: name, link: true },
            { text: "".padEnd(c.name + 1 - columns(name)) },
            { text: fit(repo.language ?? "–", c.lang).padEnd(c.lang + 1), tone: "muted" },
            { text: "".padEnd(c.bar + 1) },
            { text: String(repo.commits).padStart(c.commits), tone: "accent" },
          ]) + bar.body,
      };
    },
  }));

  const foot: Piece = { name: "top-foot", alt: "End of repositories", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

// ── pinned ──────────────────────────────────────────────────────────────────

/** The repositories pinned on the profile: name, language and stars, and the description under them unless compact. */
export function pinnedPane(profile: Profile, compact: boolean): Pane | null {
  if (profile.pinned.length === 0) return null;
  const head: Piece = {
    name: "pinned-head",
    alt: `Repositories ${profile.login} pinned`,
    href: `https://github.com/${profile.login}`,
    bands: 1,
    chrome: { top: { title: "pinned", meta: `@${profile.login}` } },
    draw: () => ({ body: "" }),
  };
  const rows: Piece[] = profile.pinned.map((repo) => {
    const stars = repo.stars ? `${repo.stars.toLocaleString("en-US")} star${repo.stars === 1 ? "" : "s"}` : "";
    const facts = [repo.language, stars].filter(Boolean).join(" · ");
    return {
      name: "pinned-repo",
      alt: [repo.name, repo.description, facts].filter(Boolean).join(": "),
      href: repo.url,
      bands: compact || !repo.description ? 1 : 2,
      chrome: {},
      draw: ({ ink, width }) => {
        const cols = textCols(width);
        const right = fit(facts, Math.floor(cols / 2));
        let body = ink.line(PAD, baseline(0), [{ text: fit(repo.name, cols - columns(right) - 2), link: true }]);
        body += ink.lineEnd(width - PAD, baseline(0), [{ text: right, tone: "muted" }]);
        if (!compact && repo.description) body += ink.line(PAD, baseline(1), [{ text: fit(repo.description, cols), tone: "muted" }]);
        return { body };
      },
    };
  });
  const foot: Piece = { name: "pinned-foot", alt: "End of pinned repositories", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

// ── prs ─────────────────────────────────────────────────────────────────────

/** The newest pull requests that were merged: the day, the title, and the repository under it unless compact. */
export function prsPane(profile: Profile, compact: boolean): Pane | null {
  const pulls = profile.pulls.slice(0, 5);
  if (pulls.length === 0) return null;
  const dates = pulls.map((pull) => shortDate(pull.merged, profile.year ?? new Date().getUTCFullYear()));
  const gutter = Math.max(...dates.map(columns)) + 2;
  const head: Piece = {
    name: "prs-head",
    alt: `Pull requests by ${profile.login} merged in ${period(profile)}`,
    href: `https://github.com/search?q=${encodeURIComponent(`is:pr is:merged author:${profile.login}`)}&type=pullrequests`,
    bands: 1,
    chrome: { top: { title: "prs", meta: `merged · ${profile.year ?? "last year"}` } },
    draw: () => ({ body: "" }),
  };
  const rows: Piece[] = pulls.map((pull, i) => ({
    name: "prs-pull",
    alt: `${pull.title}, merged into ${pull.repo} on ${dayMonthYear(pull.merged.toISOString().slice(0, 10))}`,
    href: pull.url,
    bands: compact ? 1 : 2,
    chrome: {},
    draw: ({ ink, width }) => {
      const room = textCols(width) - gutter;
      let body = ink.line(PAD, baseline(0), [{ text: dates[i]!.padEnd(gutter), tone: "muted" }, { text: fit(pull.title, room), link: true }]);
      if (!compact) body += ink.line(PAD, baseline(1), [{ text: "".padEnd(gutter) }, { text: fit(pull.repo, room), tone: "muted" }]);
      return { body };
    },
  }));
  const foot: Piece = { name: "prs-foot", alt: "End of pull requests", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

// ── releases ────────────────────────────────────────────────────────────────

/** The latest release of each repository, newest first: the day, the repository and tag, and the release's name under them unless compact or just the tag again. */
export function releasesPane(profile: Profile, compact: boolean): Pane | null {
  const releases = profile.releases.slice(0, 5);
  if (releases.length === 0) return null;
  const dates = releases.map((release) => shortDate(release.published, new Date().getUTCFullYear()));
  const gutter = Math.max(...dates.map(columns)) + 2;
  const head: Piece = {
    name: "releases-head",
    alt: `The latest releases in ${profile.login}'s public repositories`,
    href: `https://github.com/${profile.login}?tab=repositories`,
    bands: 1,
    chrome: { top: { title: "releases", meta: "latest" } },
    draw: () => ({ body: "" }),
  };
  const rows: Piece[] = releases.map((release, i) => {
    const name = release.name !== release.tag ? release.name : null;
    return {
      name: "releases-release",
      alt: `${release.repo} ${release.tag}${name ? `, ${name}` : ""}, released on ${dayMonthYear(release.published.toISOString().slice(0, 10))}`,
      href: release.url,
      bands: compact || !name ? 1 : 2,
      chrome: {},
      draw: ({ ink, width }) => {
        const room = textCols(width) - gutter;
        const tag = fit(release.tag, Math.floor(room / 2));
        let body = ink.line(PAD, baseline(0), [
          { text: dates[i]!.padEnd(gutter), tone: "muted" },
          { text: fit(release.repo, room - columns(tag) - 1), link: true },
          { text: " " },
          { text: tag, tone: "accent" },
        ]);
        if (!compact && name) body += ink.line(PAD, baseline(1), [{ text: "".padEnd(gutter) }, { text: fit(name, room), tone: "muted" }]);
        return { body };
      },
    };
  });
  const foot: Piece = { name: "releases-foot", alt: "End of releases", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

// ── log ─────────────────────────────────────────────────────────────────────

/** The newest commits across repositories, as `git log --oneline` prints them with the repository between. */
export function logPane(profile: Profile, commits: Commit[], compact: boolean): Pane | null {
  const shown = commits.slice(0, compact ? 4 : 8);
  if (shown.length === 0) return null;
  const longest = Math.max(...shown.map((commit) => columns(commit.repo)));
  const head: Piece = {
    name: "log-head",
    alt: `The newest public commits by ${profile.login} in ${period(profile)}`,
    href: `https://github.com/search?q=${encodeURIComponent(`author:${profile.login}`)}&type=commits&s=author-date&o=desc`,
    bands: 1,
    chrome: { top: { title: "log", meta: `public · ${profile.year ?? "last year"}` } },
    draw: () => ({ body: "" }),
  };
  const rows: Piece[] = shown.map((commit) => ({
    name: "log-commit",
    alt: `${commit.message}: commit ${commit.sha} to ${commit.repo} on ${dayMonthYear(commit.authored.toISOString().slice(0, 10))}`,
    href: commit.url,
    bands: 1,
    chrome: {},
    draw: ({ ink, width }) => {
      const cols = textCols(width);
      const repo = Math.min(longest, Math.floor(cols / 4));
      return {
        body: ink.line(PAD, baseline(0), [
          { text: `${commit.sha} `, tone: "accent" },
          { text: fit(commit.repo, repo).padEnd(repo + 1), tone: "muted" },
          { text: fit(commit.message, cols - columns(commit.sha) - repo - 2), link: true },
        ]),
      };
    },
  }));
  const foot: Piece = { name: "log-foot", alt: "End of commits", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

// ── langs, contribs ─────────────────────────────────────────────────────────

/** Public commits in the window by language, most first. */
function languageCommits(profile: Profile): [string, number][] {
  const byLanguage: Record<string, number> = {};
  for (const repo of profile.repos) if (repo.language) byLanguage[repo.language] = (byLanguage[repo.language] ?? 0) + repo.commits;
  return Object.entries(byLanguage).sort((a, b) => b[1] - a[1]);
}

export function langsPane(profile: Profile, href: string, compact: boolean): Pane | null {
  const sorted = languageCommits(profile);
  const sum = sorted.reduce((n, [, commits]) => n + commits, 0);
  if (sum === 0) return null;
  const parts = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((n, [, commits]) => n + commits, 0);
  if (rest > 0) parts.push(["other", rest]);
  const share = (commits: number) => `${Math.round((commits / sum) * 100)}%`;
  return breakdown({
    name: "langs",
    meta: "by public commits",
    alt: `Languages of ${profile.login}'s public commits in ${period(profile)}: ${parts.map(([language, commits]) => `${language} ${share(commits)}`).join(", ")}`,
    href,
    parts,
    label: share,
    compact,
  });
}

/** Contributions by kind. GitHub counts the ones in private repositories but does not say of what kind. */
export function contribsPane(profile: Profile, href: string, compact: boolean): Pane | null {
  const { commits, pullRequests, reviews, issues, restricted } = profile.kinds;
  const kinds: [string, number][] = [
    ["commits", commits],
    ["PRs", pullRequests],
    ["reviews", reviews],
    ["issues", issues],
    ["private", restricted],
  ];
  const parts = kinds.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return null;
  const count = (n: number) => n.toLocaleString("en-US");
  return breakdown({
    name: "contribs",
    meta: `${profile.year ?? "last year"}`,
    alt: `${profile.login}'s contributions in ${period(profile)} by kind: ${parts.map(([kind, n]) => `${kind} ${count(n)}`).join(", ")}`,
    href,
    parts,
    label: count,
    compact,
  });
}

/**
 * Parts of a whole as LED bars, one row each, the biggest first and brightest.
 * Compact draws one bar split by share, GitHub-style, with a legend flowing under it.
 */
function breakdown(options: { name: string; meta: string; alt: string; href: string; parts: [string, number][]; label: (n: number) => string; compact: boolean }): Pane {
  const { name, alt, href, parts, label, compact } = options;
  const sum = parts.reduce((n, [, value]) => n + value, 0);
  const chrome: Chrome = { top: { title: name, meta: options.meta }, bottom: true };
  const color = (palette: Palette, i: number) => palette.levels[Math.max(0, 4 - i)]!;

  if (compact) {
    const legendLines = (cols: number) => {
      const lines: [string, number, number][][] = [[]];
      let used = 0;
      parts.forEach(([part, value], i) => {
        const width = 2 + columns(part) + 1 + label(value).length + 2;
        if (used + width - 2 > cols && used > 0) {
          lines.push([]);
          used = 0;
        }
        lines.at(-1)!.push([part, value, i]);
        used += width;
      });
      return lines;
    };
    const natural = 2 + 1 + legendLines(textCols(HALF)).length;
    return {
      kind: "single",
      pieces: [
        {
          name: `${name}-compact`,
          alt,
          href,
          bands: natural,
          chrome,
          draw: ({ ink, width, bands, palette }) => {
            const cols = textCols(width);
            const lines = legendLines(cols);
            let band = 1 + Math.floor((bands - (2 + 1 + lines.length)) / 2);
            const dots = Math.floor((width - PAD * 2) / DOT);
            const y = baseline(band) - 9;
            // Cumulative rounding, so the segments always add up to the whole bar.
            let counted = 0;
            let segments = "";
            parts.forEach(([, value], i) => {
              const from = Math.round((counted / sum) * dots);
              counted += value;
              const to = Math.round((counted / sum) * dots);
              if (to > from) segments += `<rect x="${+(PAD + from * DOT).toFixed(2)}" y="${y}" width="${+((to - from) * DOT).toFixed(2)}" height="${DOT * 2}" fill="${color(palette, i)}" mask="url(#leds)"/>`;
            });
            let body = segments;
            band++;
            for (const line of lines) {
              let x = PAD;
              const by = baseline(band);
              for (const [part, value, i] of line) {
                body += `<rect x="${x}" y="${by - 9}" width="9" height="9" rx="2" fill="${color(palette, i)}"/>`;
                body += ink.line(x + 2 * TEXT.advance, by, [{ text: part }, { text: ` ${label(value)}`, tone: "muted" }]);
                x += (2 + columns(part) + 1 + label(value).length + 2) * TEXT.advance;
              }
              band++;
            }
            return { defs: dotMask("leds", PAD, y, dots * DOT, DOT * 2, y), body };
          },
        },
      ],
    };
  }

  return {
    kind: "single",
    pieces: [
      {
        name,
        alt,
        href,
        bands: 2 + parts.length,
        chrome,
        draw: ({ ink, width, bands, palette }) => {
          const cols = textCols(width);
          const nameCols = Math.min(14, Math.max(...parts.map(([part]) => columns(part))) + 2);
          const barX = PAD + nameCols * TEXT.advance;
          const dots = Math.floor(((cols - nameCols - 5) * TEXT.advance) / DOT);
          let band = 1 + Math.floor((bands - 2 - parts.length) / 2);
          let defs = "";
          let body = "";
          parts.forEach(([part, value], i) => {
            const y = baseline(band);
            const bar = ledBar(`leds${i}`, barX, y - 9, dots, Math.max(1, Math.round((value / parts[0]![1]) * dots)), color(palette, i), palette);
            defs += bar.defs;
            body += ink.line(PAD, y, [{ text: fit(part, nameCols - 2) }]) + bar.body + ink.lineEnd(width - PAD, y, [{ text: label(value), tone: "muted" }]);
            band++;
          });
          return { defs, body };
        },
      },
    ],
  };
}

// ── grid ────────────────────────────────────────────────────────────────────

/** Type size of the grid's month and weekday labels. */
const GRID_LABEL = 11;

/**
 * The contribution calendar as GitHub draws it: a column a week, Sunday on top,
 * a cell a day inked by its level. A cursor steps across the weeks; reduced
 * motion holds it on the newest. Compact draws the cells alone.
 */
export function gridPane(profile: Profile, stats: YearStats, compact: boolean): Pane | null {
  if (profile.weeks.length === 0) return null;
  const total = stats.total.toLocaleString("en-US");
  const href = `https://github.com/${profile.login}`;
  const weeks = profile.weeks.length;
  const labelWidth = compact ? 0 : 3 * GRID_LABEL * 0.6 + 6;
  const labelHeight = compact ? 0 : GRID_LABEL + 5;
  const natural = compact ? 4 : 6;
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "grid-compact" : "grid",
        alt: `${profile.login}'s contribution calendar for ${period(profile)}: ${total} contributions${stats.peak ? `, the busiest day ${dayMonthYear(stats.peak.date)} with ${stats.peak.count}` : ""}. Opens ${bare(href)}.`,
        href,
        bands: natural,
        chrome: { top: { title: "grid", meta: `${total} · ${profile.year ?? "last year"}` }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          // The pitch the width allows, held to what the natural height has
          // room for: a full-width grid keeps its bands, a half one is centred.
          const pitch = Math.min((width - PAD * 2 - labelWidth) / weeks, ((natural - 2) * BAND - labelHeight) / 7);
          const cell = pitch * 0.8;
          const r = cell * 0.2;
          const side = +(cell - 2 * r).toFixed(2);
          const left = (width - labelWidth - weeks * pitch) / 2;
          const x0 = left + labelWidth;
          const y0 = BAND + ((bands - 2) * BAND - labelHeight - 7 * pitch) / 2 + labelHeight;
          const inset = (pitch - cell) / 2 + r;

          // A square stroked round in its own colour is a rounded cell, at a
          // fraction of the markup of a rect per day.
          const paths: [string, string, string, string, string] = ["", "", "", "", ""];
          profile.weeks.forEach((week, w) =>
            week.forEach((day, d) => {
              if (day) paths[day.level] += `M${+(x0 + w * pitch + inset).toFixed(2)} ${+(y0 + d * pitch + inset).toFixed(2)}h${side}v${side}h${-side}z`;
            }),
          );
          let body = paths
            .map((d, level) => {
              const color = palette.levels[level]!;
              return d ? `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${+(2 * r).toFixed(2)}" stroke-linejoin="round"${level ? "" : ` opacity="${UNLIT}"`}/>` : "";
            })
            .join("");
          if (compact) return { body };

          // A month is named over the week of its first day, unless the
          // name would run into the previous one or past the last week.
          const labelSize = 3 * GRID_LABEL * 0.6;
          let free = x0;
          profile.weeks.forEach((week, w) => {
            const first = week.find((day) => day?.date.endsWith("-01"));
            const x = +(x0 + w * pitch).toFixed(2);
            if (!first || x < free || x + labelSize > x0 + weeks * pitch) return;
            body += ink.line(x, +(y0 - 6).toFixed(2), [{ text: MONTHS[Number(first.date.slice(5, 7)) - 1]!, tone: "muted" }], GRID_LABEL);
            free = x + labelSize + 4;
          });
          for (const d of [1, 3, 5]) {
            body += ink.line(+left.toFixed(2), +(y0 + (d + 0.5) * pitch + GRID_LABEL * 0.35).toFixed(2), [{ text: WEEKDAYS[d]!.slice(0, 3), tone: "muted" }], GRID_LABEL);
          }
          body += `<rect class="cursor" x="${+x0.toFixed(2)}" y="${+y0.toFixed(2)}" width="${+pitch.toFixed(2)}" height="${+(7 * pitch).toFixed(2)}" rx="${+(r + 1).toFixed(2)}" fill="none" stroke="${palette.accent}"/>`;
          return {
            body,
            css:
              `.cursor{animation:sweep ${weeks / 4}s steps(${weeks}) infinite}` +
              `@keyframes sweep{to{transform:translateX(${+(weeks * pitch).toFixed(2)}px)}}` +
              `@media (prefers-reduced-motion:reduce){.cursor{animation:none;transform:translateX(${+((weeks - 1) * pitch).toFixed(2)}px)}}`,
          };
        },
      },
    ],
  };
}

// ── clock ───────────────────────────────────────────────────────────────────

/** The hours the clock pane labels. */
const CLOCK_HOURS = [0, 6, 12, 18];

/** Counts per weekday (Sunday first) and hour, as a clock in `timeZone` reads each instant. */
export function punchCard(dates: Date[], timeZone: string): number[][] {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const card = WEEKDAYS.map(() => new Array<number>(24).fill(0));
  for (const date of dates) {
    const parts = format.formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")!.value;
    const hour = Number(parts.find((part) => part.type === "hour")!.value);
    card[WEEKDAYS.findIndex((day) => day.startsWith(weekday))]![hour]! += 1;
  }
  return card;
}

/**
 * When the commits were written, as GitHub's old punch card: a row a weekday,
 * a column an hour in `timeZone`, a dot per slot as big as its count. Compact
 * folds the week into one row of hourly LED bars.
 */
export function clockPane(profile: Profile, commits: Commit[], timeZone: string, compact: boolean): Pane | null {
  if (commits.length === 0) return null;
  const card = punchCard(
    commits.map((commit) => commit.authored),
    timeZone,
  );
  const hours = card[0]!.map((_, h) => card.reduce((n, row) => n + row[h]!, 0));
  const days = card.map((row) => row.reduce((n, count) => n + count, 0));
  const busiestDay = days.indexOf(Math.max(...days));
  const busiestHour = hours.indexOf(Math.max(...hours));
  const href = `https://github.com/${profile.login}`;
  const natural = compact ? 4 : 6;
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "clock-compact" : "clock",
        alt: `When ${profile.login} wrote ${commits.length} public commits sampled from ${period(profile)}, by weekday and hour in ${timeZone}: most on ${WEEKDAYS[busiestDay]}, most around ${String(busiestHour).padStart(2, "0")}:00. Opens ${bare(href)}.`,
        href,
        bands: natural,
        chrome: { top: { title: "clock", meta: timeZone }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          if (compact) {
            // Hourly bars a few LEDs wide, one dark column between, centred.
            const slot = Math.floor((width - PAD * 2) / DOT / 24);
            const bar = +((slot - 1) * DOT).toFixed(2);
            const x0 = PAD + (width - PAD * 2 - (24 * slot - 1) * DOT) / 2;
            const levels = 9;
            const y0 = BAND + 1 + Math.floor((bands - natural) / 2) * BAND;
            const floor = y0 + levels * DOT;
            const peak = Math.max(...hours);
            let unlit = "";
            const lit: string[] = ["", "", "", "", ""];
            let labels = "";
            hours.forEach((count, h) => {
              const x = +(x0 + h * slot * DOT).toFixed(2);
              unlit += `M${x} ${y0}h${bar}v${+(levels * DOT).toFixed(2)}h${-bar}z`;
              const n = count ? Math.max(1, Math.round((count / peak) * levels)) : 0;
              if (n) lit[Math.ceil((count / peak) * 4)] += `M${x} ${+(floor - n * DOT).toFixed(2)}h${bar}v${+(n * DOT).toFixed(2)}h${-bar}z`;
              // Hour labels are centred over the bar they name.
              if (CLOCK_HOURS.includes(h)) labels += ink.line(+(x + bar / 2 - String(h).length * GRID_LABEL * 0.3).toFixed(2), +(floor + 14).toFixed(2), [{ text: String(h), tone: "muted" }], GRID_LABEL);
            });
            return {
              defs: dotMask("leds", x0, y0, width - x0 - PAD, floor - y0, floor),
              body:
                `<path d="${unlit}" fill="${palette.border}" opacity="${UNLIT}" mask="url(#leds)"/>` +
                lit.map((d, level) => (d ? `<path d="${d}" fill="${palette.levels[level]}" mask="url(#leds)"/>` : "")).join("") +
                labels,
            };
          }

          // Rows keep the pitch the natural height allows; columns spread to the width.
          const labelWidth = 3 * GRID_LABEL * 0.6 + 6;
          const labelHeight = GRID_LABEL + 5;
          const pitchY = ((natural - 2) * BAND - labelHeight) / 7;
          const pitchX = (width - PAD * 2 - labelWidth) / 24;
          const x0 = PAD + labelWidth;
          const y0 = BAND + ((bands - 2) * BAND - labelHeight - 7 * pitchY) / 2 + labelHeight;
          const reach = Math.min(pitchX, pitchY) / 2 - 1;
          const most = Math.max(...card.flat());
          let unlit = "";
          let lit = "";
          card.forEach((row, d) =>
            row.forEach((count, h) => {
              const cx = +(x0 + (h + 0.5) * pitchX).toFixed(2);
              const cy = +(y0 + (d + 0.5) * pitchY).toFixed(2);
              unlit += `M${cx} ${cy}h0`;
              // Area for count, as GitHub drew it; the least is still bigger than an unlit dot.
              const r = +Math.max(2, reach * Math.sqrt(count / most)).toFixed(2);
              if (count) lit += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.levels[Math.ceil((count / most) * 4)]}"/>`;
            }),
          );
          // A round-capped stroke of no length is a dot: one path for the whole unlit panel.
          let body = `<path d="${unlit}" fill="none" stroke="${palette.border}" stroke-width="2.8" stroke-linecap="round" opacity="${UNLIT}"/>${lit}`;
          WEEKDAYS.forEach((day, d) => {
            body += ink.line(PAD, +(y0 + (d + 0.5) * pitchY + GRID_LABEL * 0.35).toFixed(2), [{ text: day.slice(0, 3), tone: "muted" }], GRID_LABEL);
          });
          for (const h of CLOCK_HOURS) {
            body += ink.line(+(x0 + (h + 0.5) * pitchX - String(h).length * GRID_LABEL * 0.3).toFixed(2), +(y0 - 6).toFixed(2), [{ text: String(h), tone: "muted" }], GRID_LABEL);
          }
          return { body };
        },
      },
    ],
  };
}

// ── neofetch ────────────────────────────────────────────────────────────────

/** The logo's character grid, in compact year cells: about 118 px square. */
const LOGO = { cols: 28, rows: 16 } as const;

/** Whole years and months from `since` to `now`; a month counts once its day of the month comes round. */
export function age(since: Date, now: Date): string {
  const months = Math.max(
    0,
    (now.getUTCFullYear() - since.getUTCFullYear()) * 12 + now.getUTCMonth() - since.getUTCMonth() - (now.getUTCDate() < since.getUTCDate() ? 1 : 0),
  );
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  if (years === 0) return count(months, "month");
  return months % 12 ? `${count(years, "year")}, ${count(months % 12, "month")}` : count(years, "year");
}

/**
 * The profile as neofetch prints a machine: the year's shape for a logo, held
 * in its fullest pose, `Key: value` lines, and the palette's colour blocks.
 * Compact drops the logo and the blocks and keeps four of the lines. Stars and
 * followers add the week's change once the history reaches a week back.
 */
export function neofetchPane(profile: Profile, compact: boolean, shape: Shape, history: Snapshot[]): Pane {
  const count = (n: number) => n.toLocaleString("en-US");
  const thisWeek = (metric: Metric) => {
    const delta = change(history, metric, 7);
    return delta ? ` (${signed(delta)} this week)` : "";
  };
  const followers = thisWeek("followers");
  const facts: [string, string][] = [
    ["Uptime", age(profile.since, new Date())],
    ["Packages", `${count(profile.repoCount)} (public repos)`],
    ["Shell", languageCommits(profile)[0]?.[0] ?? ""],
    ["Stars", `${count(profile.stars)}${thisWeek("stars")}`],
    // The week's change takes the room the following count had beside the logo.
    ["Followers", followers ? `${count(profile.followers)}${followers}` : `${count(profile.followers)} · ${count(profile.following)} following`],
    ["Contribs", `${count(profile.total)} (${profile.year ?? "last year"})`],
  ];
  const lines = facts.filter(([key, value]) => value && (!compact || ["Uptime", "Shell", "Stars", "Contribs"].includes(key)));
  let pose: Frame | null = null;
  if (!compact) {
    const frames = renderShape(shape, profile, { ...LOGO, frames: FRAMES, cellAspect: GLYPH_COMPACT.width / GLYPH_COMPACT.height });
    pose = frames[poster(frames)]!;
  }
  const href = `https://github.com/${profile.login}`;
  // The header and its rule, the lines, then a blank line and the colour blocks unless compact.
  const natural = 2 + 2 + lines.length + (compact ? 0 : 2);
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "neofetch-compact" : "neofetch",
        alt: `${profile.login}@github, as neofetch would print it: ${lines.map(([key, value]) => `${key} ${value}`).join("; ")}. Opens ${bare(href)}.`,
        href,
        bands: natural,
        chrome: { top: { title: "neofetch", meta: `@${profile.login}` }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          let band = 1 + Math.floor((bands - natural) / 2);
          const x = pose ? PAD + LOGO.cols * GLYPH_COMPACT.width + 2 * TEXT.advance : PAD;
          const cols = Math.floor((width - PAD - x) / TEXT.advance);
          let body = "";
          let css = "";
          if (pose) {
            ink.regular += RAMP;
            const top = band * BAND + ((natural - 2) * BAND - LOGO.rows * GLYPH_COMPACT.height) / 2;
            body += frameMarkup([pose], LOGO.cols, LOGO.rows, PAD, top, GLYPH_COMPACT);
            css = `.t{font-size:${GLYPH_COMPACT.size}px}` + palette.levels.map((color, level) => `.l${level}{fill:${color}}`).join("");
          }
          const login = fit(profile.login, cols - 7);
          body += ink.line(x, baseline(band++), [{ text: login, tone: "accent", bold: true }, { text: "@" }, { text: "github", tone: "accent", bold: true }]);
          body += ink.line(x, baseline(band++), [{ text: "-".repeat(columns(login) + 7) }]);
          for (const [key, value] of lines) {
            body += ink.line(x, baseline(band++), [{ text: key, tone: "accent", bold: true }, { text: `: ${fit(value, cols - columns(key) - 2)}` }]);
          }
          if (!compact) {
            // The accent is usually one of the levels already; a block each is enough.
            const colors: readonly string[] = palette.levels.includes(palette.accent) ? palette.levels : [...palette.levels, palette.accent];
            const block = 3 * TEXT.advance;
            body += colors.map((color, i) => `<rect x="${+(x + i * block).toFixed(2)}" y="${(band + 1) * BAND + 4}" width="${+block.toFixed(2)}" height="20" fill="${color}"/>`).join("");
          }
          return { body, css };
        },
      },
    ],
  };
}

// ── trends ──────────────────────────────────────────────────────────────────

/** Days the trends pane looks back over. */
const TREND_DAYS = 90;

/**
 * Stars, followers and contributions (the calendar's rolling count) over the
 * last 90 days, as btop draws them: a row each with the name, a dot-matrix
 * sparkline, the figure today and how far it moved across the sparkline. The
 * history fills a day at a time from the first run, so the pane waits for a
 * second day. Compact keeps the rows at one band instead of two, the sparklines shorter.
 */
export function trendsPane(history: Snapshot[], compact: boolean): Pane | null {
  const newest = history.at(-1);
  if (!newest || history[0]!.date === newest.date) return null;
  const end = dayNumber(newest.date);
  // The figures on each day, carried over the days no run recorded; null before the first.
  const days: (Snapshot | null)[] = [];
  let next = 0;
  let current: Snapshot | null = null;
  for (let day = end - TREND_DAYS + 1; day <= end; day++) {
    while (next < history.length && dayNumber(history[next]!.date) <= day) current = history[next++]!;
    days.push(current);
  }
  const first = days.findIndex((day) => day !== null);
  const start = days[first]!;
  const span = TREND_DAYS - first;
  const rows = (
    [
      ["stars", "stars"],
      ["followers", "followers"],
      ["contribs", "total"],
    ] as const
  ).map(([label, metric]) => ({ label, metric, value: newest[metric].toLocaleString("en-US"), delta: signed(newest[metric] - start[metric]) }));
  const rowBands = compact ? 1 : 2;
  const natural = 2 + rows.length * rowBands;
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "trends-compact" : "trends",
        alt: `Stars, followers and contributions in the calendar's rolling year over the last ${span} days, as dot-matrix sparklines: ${rows.map(({ label, value, delta }) => `${label} ${value} (${delta})`).join(", ")}.`,
        bands: natural,
        chrome: { top: { title: "trends", meta: `${span} days` }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          const band = 1 + Math.floor((bands - natural) / 2);
          const valueCols = Math.max(...rows.map((row) => row.value.length));
          const deltaCols = Math.max(...rows.map((row) => row.delta.length));
          // The longest name, "followers", and a space.
          const x = PAD + 10 * TEXT.advance;
          const valueEnd = width - PAD - (deltaCols + 1) * TEXT.advance;
          const room = Math.floor((valueEnd - (valueCols + 1) * TEXT.advance - x) / DOT);
          // A dot a day when there is room, else the newest of every few days.
          const per = Math.ceil(TREND_DAYS / room);
          const dots = Math.ceil(TREND_DAYS / per);
          const levels = Math.floor((rowBands * BAND - 8) / DOT);
          let defs = "";
          let body = "";
          rows.forEach(({ label, metric, value, delta }, i) => {
            const middle = (band + i * rowBands) * BAND + (rowBands * BAND) / 2;
            const floor = +(middle + (levels * DOT) / 2).toFixed(2);
            const top = +(floor - levels * DOT).toFixed(2);
            const values = days.flatMap((day) => (day ? [day[metric]] : []));
            const low = Math.min(...values);
            const high = Math.max(...values);
            let bars = "";
            for (let k = 0; k < dots; k++) {
              const day = days[TREND_DAYS - 1 - (dots - 1 - k) * per];
              if (!day) continue;
              // Scaled from the window's low to its high, as btop does, so one new star still shows.
              const n = high > low ? 1 + Math.round(((day[metric] - low) / (high - low)) * (levels - 1)) : 1;
              bars += `M${+(x + k * DOT).toFixed(2)} ${+(floor - n * DOT).toFixed(2)}h${DOT}v${+(n * DOT).toFixed(2)}h${-DOT}z`;
            }
            defs +=
              dotMask(`leds${i}`, x, top, dots * DOT, levels * DOT, floor) +
              `<linearGradient id="heat${i}" x1="0" y1="${floor}" x2="0" y2="${top}" gradientUnits="userSpaceOnUse">` +
              `<stop offset="0" stop-color="${palette.levels[1]}"/><stop offset="0.5" stop-color="${palette.levels[3]}"/><stop offset="1" stop-color="${palette.levels[4]}"/></linearGradient>`;
            const y = middle + 5;
            body +=
              ink.line(PAD, y, [{ text: label }]) +
              `<rect x="${x}" y="${top}" width="${+(dots * DOT).toFixed(2)}" height="${+(levels * DOT).toFixed(2)}" fill="${palette.border}" opacity="${UNLIT}" mask="url(#leds${i})"/>` +
              `<path d="${bars}" fill="url(#heat${i})" mask="url(#leds${i})"/>` +
              ink.lineEnd(valueEnd, y, [{ text: value }]) +
              ink.lineEnd(width - PAD, y, [{ text: delta, tone: "muted" }]);
          });
          return { defs, body };
        },
      },
    ],
  };
}

// ── status bar ──────────────────────────────────────────────────────────────

/**
 * A powerline status line, the way tmux and vim themes draw it: the session in
 * an accent segment with an arrow end, one quiet segment per link split by
 * thin chevrons, and the day it was drawn in an accent segment on the right,
 * the base filling the width between. Each link is its own image so it can
 * be its own link; each image paints the colour its neighbour needs behind
 * an arrow, so the segments meet as one line.
 */
export function statusBar(session: string, links: Link[], drawn: string, fullWidth: number, credit: string, home?: string): Image[] {
  const top = 3;
  const bottom = BAND - 3;
  const middle = BAND / 2;
  const arrow = 11;
  const pad = TEXT.advance;
  const segment = (name: string, width: number, alt: string, href: string | undefined, draw: (ink: Ink, palette: Palette) => string): Image =>
    place({ name, alt, href, bands: 1, chrome: { sides: false }, draw: ({ ink, palette }) => ({ body: draw(ink, palette) }) }, width, 1);
  const rect = (x: number, width: number, fill: string) => `<rect x="${+x.toFixed(2)}" y="${top}" width="${+width.toFixed(2)}" height="${bottom - top}" fill="${fill}"/>`;

  const label = `drawn ${drawn}`;
  const clock = Math.ceil(pad + columns(label) * TEXT.advance + pad + INSET);
  const clockLeast = clock + arrow + pad * 2;
  const sessionWidth = Math.ceil(INSET + pad + columns(session) * TEXT.advance + pad + arrow);
  // Every link but the last ends in a 6px chevron. Links that do not fit are
  // left out: GitHub would wrap them onto a second line, apart from the bar.
  let linkWidths = links.map((link) => Math.ceil(pad + columns(link.label) * TEXT.advance + pad) + 6);
  while (linkWidths.length && sessionWidth + linkWidths.reduce((n, w) => n + w, 0) - 6 + clockLeast > fullWidth) linkWidths.pop();
  if (linkWidths.length < links.length) {
    const out = links.slice(linkWidths.length).map((link) => link.label);
    console.warn(`afterglow: the status line has room for ${linkWidths.length} of ${links.length} links; left out: ${out.join(", ")}`);
    links = links.slice(0, linkWidths.length);
  }
  if (linkWidths.length) linkWidths[linkWidths.length - 1]! -= 6;

  // The base fills the line out to the date. No segment grows past a phone's
  // README column, or GitHub would shrink that one segment there: the spare
  // width goes to the date segment up to that limit, then evenly to the links.
  const phone = 300;
  let spare = fullWidth - sessionWidth - linkWidths.reduce((n, w) => n + w, 0) - clockLeast;
  let clockWidth = clockLeast + Math.max(0, Math.min(spare, phone - clockLeast));
  spare -= clockWidth - clockLeast;
  if (spare > 0 && links.length > 0) {
    const share = Math.floor(spare / links.length);
    linkWidths = linkWidths.map((w) => Math.min(phone, w + share));
  }
  const leftover = fullWidth - sessionWidth - linkWidths.reduce((n, w) => n + w, 0) - clockWidth;
  clockWidth += Math.max(0, Math.min(leftover, phone - clockWidth));
  // Rounding leaves a pixel or two; the last link takes them if it has room.
  const rest = fullWidth - sessionWidth - linkWidths.reduce((n, w) => n + w, 0) - clockWidth;
  if (rest > 0 && links.length > 0 && linkWidths.at(-1)! + rest <= phone) linkWidths[linkWidths.length - 1]! += rest;

  const homeShown = home ? bare(home) : undefined;
  const images: Image[] = [
    segment("bar-session", sessionWidth, homeShown ? `${session}. Opens ${homeShown}.` : session, home, (ink, palette) =>
      rect(sessionWidth - arrow, arrow, palette.border) +
      rect(INSET, sessionWidth - arrow - INSET, palette.accent) +
      `<path d="M${sessionWidth - arrow} ${top}L${sessionWidth} ${middle}L${sessionWidth - arrow} ${bottom}Z" fill="${palette.accent}"/>` +
      ink.line(INSET + pad, TEXT.baseline, [{ text: session, tone: "onAccent", bold: true }]),
    ),
    ...links.map((link, i) => {
      const last = i === links.length - 1;
      const width = linkWidths[i]!;
      const room = width - (last ? 0 : 6);
      const shown = bare(link.url);
      return segment("bar-link", width, `${link.label}: ${shown}`, link.url, (ink, palette) =>
        rect(0, width, palette.border) +
        // Centred, so a segment widened to fill the line reads as a tab, not a gap.
        ink.line((room - columns(link.label) * TEXT.advance) / 2, TEXT.baseline, [{ text: link.label }]) +
        (last ? "" : `<path d="M${width - 6} ${top + 3}L${width - 1} ${middle}L${width - 6} ${bottom - 3}" fill="none" stroke="${palette.muted}" stroke-width="1.2"/>`),
      );
    }),
    segment("bar-clock", clockWidth, `Drawn by afterglow on ${drawn}`, credit, (ink, palette) =>
      rect(0, clockWidth - clock, palette.border) +
      `<path d="M${clockWidth - clock} ${top}L${clockWidth - clock - arrow} ${middle}L${clockWidth - clock} ${bottom}Z" fill="${palette.accent}"/>` +
      rect(clockWidth - clock, clock - INSET, palette.accent) +
      ink.lineEnd(clockWidth - INSET - pad, TEXT.baseline, [{ text: label, tone: "onAccent" }]),
    ),
  ];
  return images;
}
