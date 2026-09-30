import { createHash } from "node:crypto";
import type { Feed } from "./feed";
import type { Day, Link, Profile } from "./github";
import { BAND, HALF, INSET, Ink, PAD, TEXT, baseline, piece, type Chrome, type Drawn, type Span } from "./pane";
import type { YearStats } from "./stats";
import { columns, escapeXml, fit, wrap } from "./text";
import type { Palette } from "./theme";
import { RAMP, renderTorus, type TorusFrame } from "./torus";

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

/** Places a piece at a size and binds everything its SVG needs. */
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

export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 8);

function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

function monthYear(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** Content columns of a pane `width` px wide. */
function textCols(width: number): number {
  return Math.floor((width - PAD * 2) / TEXT.advance);
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

const TORUS_FULL = { size: 10, width: 6, height: 10, baseline: 8 } as const;
/** Compact trades size for resolution: finer cells, so a smaller torus keeps its detail. */
const TORUS_COMPACT = { size: 7, width: 4.2, height: 7, baseline: 5.6 } as const;
type Cell = typeof TORUS_FULL | typeof TORUS_COMPACT;
const TORUS_FRAMES = 120;
const TORUS_PERIOD = 15;
const torusCache = new Map<string, TorusFrame[]>();

/**
 * The year as a donut.c torus. Every frame is drawn once and a shared CSS
 * keyframe shows each for one slot, offset per frame; no script, so GitHub's
 * image proxy serves it as is. Like a phosphor screen, a frame lingers two
 * more slots at the palette's afterglow, which also smooths 8 fps motion.
 */
export function yearPane(profile: Profile, href: string, compact: boolean): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const span = days.length ? `${monthYear(days[0]!.date)} – ${monthYear(days.at(-1)!.date)}` : "";
  const cell: Cell = compact ? TORUS_COMPACT : TORUS_FULL;
  const legend = compact ? 0 : 1;
  const destination = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "year-compact" : "year",
        alt: `A spinning ASCII torus made of ${profile.login}'s contributions over the last year: weeks around the ring, days around the tube, busier days raised and brighter. Opens ${destination}.`,
        href,
        bands: compact ? 8 : 13,
        chrome: { top: { title: "year", meta: span }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          const area = (bands - 2 - legend) * BAND;
          const cols = Math.floor((width - INSET * 2 - 16) / cell.width);
          const rows = Math.floor((area - 8) / cell.height);
          const key = `${cols}x${rows}`;
          let frames = torusCache.get(key);
          if (!frames) {
            frames = renderTorus(profile, { cols, rows, frames: TORUS_FRAMES, cellAspect: cell.width / cell.height });
            torusCache.set(key, frames);
          }
          ink.regular += RAMP;
          const left = (width - cols * cell.width) / 2;
          const top = BAND + (area - rows * cell.height) / 2;
          const body = torusFrames(frames, cols, rows, left, top, cell);

          // The legend, in GitHub's own words: less to more.
          let legendMarkup = "";
          if (legend) {
            const y = baseline(bands - 2);
            const swatchX = PAD + 5 * TEXT.advance;
            legendMarkup =
              ink.line(PAD, y, [{ text: "less", tone: "muted" }]) +
              palette.levels.map((color, level) => `<rect x="${swatchX + level * 13}" y="${y - 10}" width="10" height="10" rx="2" fill="${color}"/>`).join("") +
              ink.line(swatchX + 5 * 13 + 4, y, [{ text: "more", tone: "muted" }]) +
              ink.lineEnd(width - PAD, y, [{ text: `${profile.weeks.length} weeks × 7 days`, tone: "muted" }]);
          }

          const slot = TORUS_PERIOD / frames.length;
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
              `.t{font-size:${cell.size}px}` +
              palette.levels.map((color, level) => `.l${level}{fill:${color}}`).join("") +
              `.frame{visibility:hidden;animation:frame ${TORUS_PERIOD}s step-end infinite}` +
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

function torusFrames(frames: TorusFrame[], cols: number, rows: number, left: number, top: number, cell: Cell): string {
  // Reduced motion holds the pose that shows the most of the year.
  const lit = frames.map((frame) => frame.glyph.reduce((n, g) => n + (g >= 0 ? 1 : 0), 0));
  const poster = lit.indexOf(Math.max(...lit));
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
        const x = +(left + first * cell.width).toFixed(2);
        const y = +(top + r * cell.height + cell.baseline).toFixed(2);
        tspans += `<tspan x="${x}" y="${y}">${escapeXml(run)}</tspan>`;
      }
      if (tspans) layers += `<text class="t l${level}" xml:space="preserve">${tspans}</text>`;
    }
    body += `<g class="frame${index === poster ? " poster" : ""}" id="f${index}">${layers}</g>`;
  });
  return body;
}

// ── whoami ──────────────────────────────────────────────────────────────────

export function whoamiPane(profile: Profile, stats: YearStats, who: string[], href: string | undefined, compact: boolean): Pane {
  const name = who[0] ?? profile.name ?? profile.login;
  const identity = who.length > 1 ? who.slice(1) : defaultIdentity(profile);
  const figure = (text: string): Span => ({ text, tone: "accent" });

  const figures: [string, Span[]][] = [];
  if (stats.total > 0) figures.push(["contributions", [figure(stats.total.toLocaleString("en-US")), { text: " in the last year" }]]);
  else figures.push(["contributions", [{ text: "none in the last year", tone: "muted" }]]);
  if (stats.peak) figures.push(["peak", [figure(stats.peak.count.toLocaleString("en-US")), { text: ` on ${dayMonthYear(stats.peak.date)}` }]]);
  if (stats.busiestWeekday !== null) figures.push(["busiest", [figure(WEEKDAYS[stats.busiestWeekday]!)]]);
  if (stats.streak >= 2) figures.push(["streak", [figure(`${stats.streak} days`)]]);

  const alt = `${[name, identity.filter(Boolean).join(" ")].filter(Boolean).join(" — ")} ${figures
    .map(([key, spans]) => `${key}: ${spans.map((span) => span.text).join("")}`)
    .join("; ")}.`;
  const chrome: Chrome = { top: { title: "whoami", meta: `@${profile.login}` }, bottom: true };

  if (compact) {
    // Identity runs on as prose; the figures fold into two lines.
    const prose = identity.filter(Boolean).join(" ");
    const proseLines = prose ? wrap(prose, textCols(HALF), 3) : [];
    const first: Span[] = [figure(stats.total.toLocaleString("en-US")), { text: " contributions" }];
    if (stats.peak) first.push({ text: " · peak ", tone: "muted" }, figure(stats.peak.count.toLocaleString("en-US")));
    const second: Span[] = [];
    if (stats.busiestWeekday !== null) second.push({ text: "busiest ", tone: "muted" }, figure(WEEKDAYS[stats.busiestWeekday]!));
    if (stats.streak >= 2) second.push({ text: second.length ? " · " : "", tone: "muted" }, figure(`${stats.streak}-day`), { text: " streak" });
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
          draw: ({ ink, width, bands }) => {
            let band = 1 + Math.floor((bands - natural) / 2);
            const nameSize = Math.min(20, Math.floor((width - PAD * 2) / (columns(name) * 0.6)));
            let body = ink.line(PAD, band * BAND + 20, [{ text: name, bold: true }], nameSize);
            band++;
            for (const line of prose ? wrap(prose, textCols(width), 3) : []) body += ink.line(PAD, baseline(band++), [{ text: line }]);
            for (const spans of figureLines) body += ink.line(PAD, baseline(band++), spans);
            return { body };
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
        draw: ({ ink, width, bands }) => {
          const cols = textCols(width);
          let band = 1 + Math.floor((bands - natural) / 2);
          const nameSize = Math.min(26, Math.floor((width - PAD * 2) / (columns(name) * 0.6)));
          let body = ink.line(PAD, band * BAND + 37, [{ text: name, bold: true }], nameSize);
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
          return { body };
        },
      },
    ],
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
 * a time. The newest day enters on the right; after today the year replays
 * from the start, past a marker. Reduced motion holds the newest window.
 */
export function graphPane(profile: Profile, href: string, compact: boolean): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const peak = Math.max(1, ...days.map((day) => day.count));
  return {
    kind: "single",
    pieces: [
      {
        name: compact ? "graph-compact" : "graph",
        alt: `Contributions per day over the last year as a scrolling dot-matrix graph; the busiest day had ${peak}. Opens ${href.replace(/^https?:\/\//, "").replace(/\/$/, "")}.`,
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
          // Where today meets the start of the replay.
          const seam = +(x0 + total * DOT).toFixed(2);
          const marker =
            `<path d="M${seam} ${y0}V${floor}" stroke="${palette.accent}" stroke-width="1" stroke-dasharray="2 3"/>` +
            ink.line(seam + 4, y0 + 10, [{ text: "now", tone: "accent" }], 11);

          const shift = (total - visible) * DOT;
          const period = total / 4; // four days a second
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
              `.strip{transform:translateX(-${+shift.toFixed(2)}px);animation:scroll ${+period.toFixed(2)}s steps(${total}) infinite;animation-delay:-${+((period * (total - visible)) / total).toFixed(2)}s}` +
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
  const now = new Date();
  const dates = shown.map((post) => {
    if (!post.date) return "";
    const short = `${MONTHS[post.date.getUTCMonth()]} ${String(post.date.getUTCDate()).padStart(2, " ")}`;
    return post.date.getUTCFullYear() === now.getUTCFullYear() ? short : `${MONTHS[post.date.getUTCMonth()]} ${post.date.getUTCFullYear()}`;
  });
  const gutter = Math.max(0, ...dates.map(columns)) + 2;
  const host = options.source.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const archiveShown = options.archive?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Compact drops the note and holds every title to one line.
  const note = compact ? [] : options.note;

  const head: Piece = {
    name: `posts-head-${hash(host, ...note)}`,
    alt: note.length ? `Posts from ${host}: ${note.join(" ")}` : `Posts from ${host}`,
    href: options.archive ?? undefined,
    bands: 1 + note.length,
    chrome: { top: { title: "posts", meta: host } },
    draw: ({ ink }) => ({ body: note.map((line, i) => ink.line(PAD, baseline(1 + i), [{ text: `# ${line}`, tone: "muted" }])).join("") }),
  };

  const rows: Piece[] = shown.map((post, i) => ({
    name: `post-${hash(post.url, post.title, dates[i]!, compact ? "compact" : "")}`,
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
    name: `posts-foot-${hash(options.archive ?? "")}`,
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
    alt: `Public repositories ${profile.login} committed to most in the last year`,
    href: `https://github.com/${profile.login}?tab=repositories`,
    bands: compact ? 1 : 2,
    chrome: { top: { title: "top", meta: "public · last year" } },
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
    name: `top-${hash(repo.url)}`,
    alt: `${repo.name}: ${repo.commits} commit${repo.commits === 1 ? "" : "s"} in the last year${repo.language ? `, ${repo.language}` : ""}`,
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

// ── langs ───────────────────────────────────────────────────────────────────

export function langsPane(profile: Profile, href: string, compact: boolean): Pane | null {
  const byLanguage: Record<string, number> = {};
  for (const repo of profile.repos) if (repo.language) byLanguage[repo.language] = (byLanguage[repo.language] ?? 0) + repo.commits;
  const sorted = Object.entries(byLanguage).sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((n, [, commits]) => n + commits, 0);
  if (sum === 0) return null;
  const shown = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((n, [, commits]) => n + commits, 0);
  if (rest > 0) shown.push(["other", rest]);
  const share = (commits: number) => `${Math.round((commits / sum) * 100)}%`;
  const alt = `Languages of ${profile.login}'s public commits in the last year: ${shown.map(([language, commits]) => `${language} ${share(commits)}`).join(", ")}`;
  const chrome: Chrome = { top: { title: "langs", meta: "by public commits" }, bottom: true };
  // Brightest ink for the biggest share, down the ramp from there.
  const ink = (palette: Palette, i: number) => palette.levels[Math.max(0, 4 - i)]!;

  if (compact) {
    // One bar split by share, GitHub-style, with a flowing legend under it.
    const legendLines = (cols: number) => {
      const lines: [string, number, number][][] = [[]];
      let used = 0;
      shown.forEach(([language, commits], i) => {
        const width = 2 + columns(language) + 1 + share(commits).length + 2;
        if (used + width - 2 > cols && used > 0) {
          lines.push([]);
          used = 0;
        }
        lines.at(-1)!.push([language, commits, i]);
        used += width;
      });
      return lines;
    };
    const natural = 2 + 1 + legendLines(textCols(HALF)).length;
    return {
      kind: "single",
      pieces: [
        {
          name: "langs-compact",
          alt,
          href,
          bands: natural,
          chrome,
          draw: ({ ink: pen, width, bands, palette }) => {
            const cols = textCols(width);
            const lines = legendLines(cols);
            let band = 1 + Math.floor((bands - (2 + 1 + lines.length)) / 2);
            const dots = Math.floor((width - PAD * 2) / DOT);
            const y = baseline(band) - 9;
            // Cumulative rounding, so the segments always add up to the whole bar.
            let counted = 0;
            let segments = "";
            shown.forEach(([, commits], i) => {
              const from = Math.round((counted / sum) * dots);
              counted += commits;
              const to = Math.round((counted / sum) * dots);
              if (to > from) segments += `<rect x="${+(PAD + from * DOT).toFixed(2)}" y="${y}" width="${+((to - from) * DOT).toFixed(2)}" height="${DOT * 2}" fill="${ink(palette, i)}" mask="url(#leds)"/>`;
            });
            let body = segments;
            band++;
            for (const line of lines) {
              let x = PAD;
              const by = baseline(band);
              for (const [language, commits, i] of line) {
                body += `<rect x="${x}" y="${by - 9}" width="9" height="9" rx="2" fill="${ink(palette, i)}"/>`;
                body += pen.line(x + 2 * TEXT.advance, by, [{ text: language }, { text: ` ${share(commits)}`, tone: "muted" }]);
                x += (2 + columns(language) + 1 + share(commits).length + 2) * TEXT.advance;
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
        name: "langs",
        alt,
        href,
        bands: 2 + shown.length,
        chrome,
        draw: ({ ink: pen, width, bands, palette }) => {
          const cols = textCols(width);
          const nameCols = Math.min(14, Math.max(...shown.map(([language]) => columns(language))) + 2);
          const barX = PAD + nameCols * TEXT.advance;
          const dots = Math.floor(((cols - nameCols - 5) * TEXT.advance) / DOT);
          let band = 1 + Math.floor((bands - 2 - shown.length) / 2);
          let defs = "";
          let body = "";
          shown.forEach(([language, commits], i) => {
            const y = baseline(band);
            const bar = ledBar(`leds${i}`, barX, y - 9, dots, Math.max(1, Math.round((commits / shown[0]![1]) * dots)), ink(palette, i), palette);
            defs += bar.defs;
            body += pen.line(PAD, y, [{ text: fit(language, nameCols - 2) }]) + bar.body + pen.lineEnd(width - PAD, y, [{ text: share(commits), tone: "muted" }]);
            band++;
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
  const segment = (name: string, width: number, alt: string, href: string | undefined, draw: (ink: Ink, palette: Palette) => string): Image => ({
    name,
    width,
    alt,
    href,
    render: (palette) => piece({ width, bands: 1, palette, chrome: { sides: false }, title: alt, draw: (ink) => ({ body: draw(ink, palette) }) }),
  });
  const rect = (x: number, width: number, fill: string) => `<rect x="${+x.toFixed(2)}" y="${top}" width="${+width.toFixed(2)}" height="${bottom - top}" fill="${fill}"/>`;

  const sessionWidth = Math.ceil(INSET + pad + columns(session) * TEXT.advance + pad + arrow);
  const images: Image[] = [
    segment(`bar-session-${hash(session)}`, sessionWidth, `Session ${session}`, home, (ink, palette) =>
      rect(sessionWidth - arrow, arrow, palette.border) +
      rect(INSET, sessionWidth - arrow - INSET, palette.accent) +
      `<path d="M${sessionWidth - arrow} ${top}L${sessionWidth} ${middle}L${sessionWidth - arrow} ${bottom}Z" fill="${palette.accent}"/>` +
      ink.line(INSET + pad, TEXT.baseline, [{ text: session, tone: "onAccent", bold: true }]),
    ),
    ...links.map((link, i) => {
      const last = i === links.length - 1;
      const width = Math.ceil(pad + columns(link.label) * TEXT.advance + pad + (last ? 0 : 6));
      const shown = link.url.replace(/^mailto:/, "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      return segment(`bar-${hash(link.label, link.url)}`, width, `${link.label}: ${shown}`, link.url, (ink, palette) =>
        rect(0, width, palette.border) +
        ink.line(pad, TEXT.baseline, [{ text: link.label }]) +
        (last ? "" : `<path d="M${width - 6} ${top + 3}L${width - 1} ${middle}L${width - 6} ${bottom - 3}" fill="none" stroke="${palette.muted}" stroke-width="1.2"/>`),
      );
    }),
  ];

  // The base runs out to the right edge, where the date sits in its own accent segment.
  const label = `drawn ${drawn}`;
  const clock = Math.ceil(pad + columns(label) * TEXT.advance + pad + INSET);
  const used = images.reduce((n, image) => n + image.width, 0);
  const width = Math.max(clock + arrow + pad * 2, fullWidth - used);
  images.push(
    segment("bar-clock", width, `Drawn by afterglow on ${drawn}`, credit, (ink, palette) =>
      rect(0, width - clock, palette.border) +
      `<path d="M${width - clock} ${top}L${width - clock - arrow} ${middle}L${width - clock} ${bottom}Z" fill="${palette.accent}"/>` +
      rect(width - clock, clock - INSET, palette.accent) +
      ink.lineEnd(width - INSET - pad, TEXT.baseline, [{ text: label, tone: "onAccent" }]),
    ),
  );
  return images;
}
