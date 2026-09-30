import { createHash } from "node:crypto";
import type { Feed } from "./feed";
import type { Day, Link, Profile } from "./github";
import { BAND, INSET, Ink, PAD, TEXT, baseline, piece, type Chrome, type Drawn, type Span } from "./pane";
import type { YearStats } from "./stats";
import { columns, escapeXml, fit, wrap } from "./text";
import type { Palette } from "./theme";
import { RAMP, renderTorus, type TorusFrame } from "./torus";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** LED pitch of the dot-matrix graphs: two dots per character cell. */
const DOT = TEXT.advance / 2;

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
  /** Height in 28px bands before the layout stretches it. */
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
export function place(item: Piece, width: number, bands: number): Image {
  return {
    name: item.name,
    width,
    alt: item.alt,
    href: item.href,
    render: (palette) =>
      piece({ width, bands, palette, chrome: item.chrome, title: item.alt, draw: (ink) => item.draw({ ink, width, bands, palette }) }),
  };
}

export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 8);

function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
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

// ── year ────────────────────────────────────────────────────────────────────

const TORUS_CELL = { size: 10, width: 6, height: 10, baseline: 8 } as const;
const TORUS_FRAMES = 120;
const TORUS_PERIOD = 15;
const torusCache = new Map<string, TorusFrame[]>();

/**
 * The year as a donut.c torus. Every frame is drawn once and a shared CSS
 * keyframe shows each for one slot, offset per frame; no script, so GitHub's
 * image proxy serves it as is. Like a phosphor screen, a frame lingers two
 * more slots at the palette's afterglow, which also smooths 8 fps motion.
 */
export function yearPane(profile: Profile, href: string): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const span = days.length ? `${monthYear(days[0]!.date)} – ${monthYear(days.at(-1)!.date)}` : "";
  return {
    kind: "single",
    pieces: [
      {
        name: "year",
        alt: `A spinning ASCII torus made of ${profile.login}'s contributions over the last year: weeks around the ring, days around the tube, busier days raised and brighter`,
        href,
        bands: 13,
        chrome: { top: { title: "year", meta: span }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          const cols = Math.floor((width - INSET * 2 - 16) / TORUS_CELL.width);
          const rows = Math.floor(((bands - 3) * BAND - 8) / TORUS_CELL.height);
          const key = `${cols}x${rows}`;
          let frames = torusCache.get(key);
          if (!frames) {
            frames = renderTorus(profile, { cols, rows, frames: TORUS_FRAMES, cellAspect: TORUS_CELL.width / TORUS_CELL.height });
            torusCache.set(key, frames);
          }
          ink.regular += RAMP;
          const left = (width - cols * TORUS_CELL.width) / 2;
          const top = BAND + ((bands - 3) * BAND - rows * TORUS_CELL.height) / 2;
          const body = torusFrames(frames, cols, rows, left, top);

          // Legend, in GitHub's own words: less to more.
          const legendY = baseline(bands - 2);
          let legend = ink.line(PAD, legendY, [{ text: "less", tone: "muted" }]);
          const swatchX = PAD + 5 * TEXT.advance;
          legend += palette.levels
            .map((color, level) => `<rect x="${swatchX + level * 13}" y="${legendY - 10}" width="10" height="10" rx="2" fill="${color}"/>`)
            .join("");
          legend += ink.line(swatchX + 5 * 13 + 4, legendY, [{ text: "more", tone: "muted" }]);
          legend += ink.lineEnd(width - PAD, legendY, [{ text: `${profile.weeks.length} weeks × 7 days`, tone: "muted" }]);

          const slot = TORUS_PERIOD / frames.length;
          const step = 100 / frames.length;
          const [trail, fade] = palette.afterglow;
          const glow = palette.glow
            ? `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.2" result="blur"/>` +
              `<feComponentTransfer in="blur" result="halo"><feFuncA type="linear" slope="0.7"/></feComponentTransfer>` +
              `<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
            : "";
          return {
            defs: glow,
            body: (palette.glow ? `<g filter="url(#glow)">${body}</g>` : body) + legend,
            css:
              `.t{font-size:${TORUS_CELL.size}px}` +
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

function monthYear(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

function torusFrames(frames: TorusFrame[], cols: number, rows: number, left: number, top: number): string {
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
        const x = +(left + first * TORUS_CELL.width).toFixed(2);
        const y = +(top + r * TORUS_CELL.height + TORUS_CELL.baseline).toFixed(2);
        tspans += `<tspan x="${x}" y="${y}">${escapeXml(run)}</tspan>`;
      }
      if (tspans) layers += `<text class="t l${level}" xml:space="preserve">${tspans}</text>`;
    }
    body += `<g class="frame${index === poster ? " poster" : ""}" id="f${index}">${layers}</g>`;
  });
  return body;
}

// ── whoami ──────────────────────────────────────────────────────────────────

export function whoamiPane(profile: Profile, stats: YearStats, who: string[], href: string | undefined): Pane {
  const name = who[0] ?? profile.name ?? profile.login;
  const figures: [string, Span[]][] = [];
  const figure = (text: string): Span => ({ text, tone: "accent" });
  if (stats.total > 0) {
    figures.push(["contributions", [figure(stats.total.toLocaleString("en-US")), { text: " in the last year" }]]);
  } else figures.push(["contributions", [{ text: "none in the last year", tone: "muted" }]]);
  if (stats.peak) figures.push(["peak", [figure(stats.peak.count.toLocaleString("en-US")), { text: ` on ${dayMonthYear(stats.peak.date)}` }]]);
  if (stats.busiestWeekday !== null) figures.push(["busiest", [figure(WEEKDAYS[stats.busiestWeekday]!)]]);
  if (stats.streak >= 2) figures.push(["streak", [figure(`${stats.streak} days`)]]);

  const identity = who.length > 1 ? who.slice(1) : defaultIdentity(profile);
  const alt = `${[name, identity.filter(Boolean).join(" ")].filter(Boolean).join(" — ")} ${figures
    .map(([key, spans]) => `${key}: ${spans.map((span) => span.text).join("")}`)
    .join("; ")}.`;

  return {
    kind: "single",
    pieces: [
      {
        name: "whoami",
        alt,
        href,
        // Borders, a two-band name, the identity lines, a gap, the figures.
        bands: 2 + 2 + identity.length + 1 + figures.length,
        chrome: { top: { title: "whoami", meta: `@${profile.login}` }, bottom: true },
        draw: ({ ink, width, bands }) => {
          const cols = textCols(width);
          const natural = 2 + 2 + identity.length + 1 + figures.length;
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
export function graphPane(profile: Profile, href: string): Pane {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const peak = Math.max(1, ...days.map((day) => day.count));
  return {
    kind: "single",
    pieces: [
      {
        name: "graph",
        alt: `Contributions per day over the last year as a scrolling dot-matrix graph; the busiest day had ${peak}`,
        href,
        bands: 7,
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
              `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${floor - y0}" fill="${palette.border}" opacity="0.55" mask="url(#leds)"/>` +
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

export function postsPane(feed: Feed, options: { count: number; note: string[]; archive: string | null; source: string }): Pane {
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

  const head: Piece = {
    name: `posts-head-${hash(host, ...options.note)}`,
    alt: options.note.length ? `Posts from ${host}: ${options.note.join(" ")}` : `Posts from ${host}`,
    href: options.archive ?? undefined,
    bands: 1 + options.note.length,
    chrome: { top: { title: "posts", meta: host } },
    draw: ({ ink }) => ({ body: options.note.map((line, i) => ink.line(PAD, baseline(1 + i), [{ text: `# ${line}`, tone: "muted" }])).join("") }),
  };

  const rows: Piece[] = shown.map((post, i) => {
    return {
      name: `post-${hash(post.url, post.title, dates[i]!)}`,
      alt: post.title,
      href: post.url,
      bands: 0,
      chrome: {},
      draw: ({ ink, width }) => {
        const lines = wrap(post.title, textCols(width) - gutter, 2);
        return {
          body: lines
            .map((line, row) => ink.line(PAD, baseline(row), [{ text: (row === 0 ? dates[i]! : "").padEnd(gutter), tone: "muted" }, { text: line, link: true }]))
            .join(""),
        };
      },
    };
  });

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

/** Post rows know their height only once the column width is known. */
export function measureStack(pane: Pane, width: number): Pane {
  return {
    ...pane,
    pieces: pane.pieces.map((item) => (item.bands > 0 ? item : { ...item, bands: measure(item, width) })),
  };
}

function measure(item: Piece, width: number): number {
  // Rows draw one band per line; count the lines they would draw.
  const ink = new Ink();
  const { body } = item.draw({ ink, width, bands: 2, palette: {} as Palette });
  return Math.max(1, (body.match(/<text /g) ?? []).length);
}

// ── top ─────────────────────────────────────────────────────────────────────

export function topPane(profile: Profile, count: number): Pane | null {
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

  const head: Piece = {
    name: "top-head",
    alt: `Public repositories ${profile.login} committed to most in the last year`,
    href: `https://github.com/${profile.login}?tab=repositories`,
    bands: 2,
    chrome: { top: { title: "top", meta: "public · last year" } },
    draw: ({ ink, width }) => {
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
      const lit = Math.max(1, Math.round((repo.commits / most) * dots));
      return {
        defs: dotMask("leds", barX, y - 9, dots * DOT, DOT * 2, y - 9 + DOT * 2),
        body:
          ink.line(PAD, y, [
            { text: fit(repo.name, c.name), link: true },
            { text: "".padEnd(c.name + 1 - columns(fit(repo.name, c.name))) },
            { text: fit(repo.language ?? "–", c.lang).padEnd(c.lang + 1), tone: "muted" },
            { text: "".padEnd(c.bar + 1) },
            { text: String(repo.commits).padStart(c.commits), tone: "accent" },
          ]) +
          `<rect x="${barX}" y="${y - 9}" width="${dots * DOT}" height="${DOT * 2}" fill="${palette.border}" opacity="0.55" mask="url(#leds)"/>` +
          `<rect class="grow" x="${barX}" y="${y - 9}" width="${+(lit * DOT).toFixed(2)}" height="${DOT * 2}" fill="${palette.accent}" mask="url(#leds)"/>`,
        css: growCss(0),
      };
    },
  }));

  const foot: Piece = { name: "top-foot", alt: "End of repositories", bands: 1, chrome: { bottom: true }, draw: () => ({ body: "" }) };
  return { kind: "stack", pieces: [head, ...rows, foot] };
}

/** Bars fill once when the image loads, then hold. */
function growCss(delay: number): string {
  return (
    `.grow{transform-box:fill-box;transform-origin:left;animation:grow 1.2s cubic-bezier(.2,.8,.2,1) ${delay}s both}` +
    `@keyframes grow{from{transform:scaleX(0)}}@media (prefers-reduced-motion:reduce){.grow{animation:none}}`
  );
}

// ── langs ───────────────────────────────────────────────────────────────────

export function langsPane(profile: Profile, href: string): Pane | null {
  const byLanguage: Record<string, number> = {};
  for (const repo of profile.repos) if (repo.language) byLanguage[repo.language] = (byLanguage[repo.language] ?? 0) + repo.commits;
  const sorted = Object.entries(byLanguage).sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((n, [, commits]) => n + commits, 0);
  if (sum === 0) return null;
  const shown = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((n, [, commits]) => n + commits, 0);
  if (rest > 0) shown.push(["other", rest]);
  const share = (commits: number) => `${Math.round((commits / sum) * 100)}%`;

  return {
    kind: "single",
    pieces: [
      {
        name: "langs",
        alt: `Languages of ${profile.login}'s public commits in the last year: ${shown.map(([language, commits]) => `${language} ${share(commits)}`).join(", ")}`,
        href,
        bands: 2 + shown.length,
        chrome: { top: { title: "langs", meta: "by public commits" }, bottom: true },
        draw: ({ ink, width, bands, palette }) => {
          const cols = textCols(width);
          const nameCols = Math.min(14, Math.max(...shown.map(([language]) => columns(language))) + 2);
          const barX = PAD + nameCols * TEXT.advance;
          const dots = Math.floor(((cols - nameCols - 5) * TEXT.advance) / DOT);
          let band = 1 + Math.floor((bands - 2 - shown.length) / 2);
          let defs = "";
          let body = "";
          let css = "";
          shown.forEach(([language, commits], i) => {
            const y = baseline(band);
            const lit = Math.max(1, Math.round((commits / shown[0]![1]) * dots));
            defs += dotMask(`leds${i}`, barX, y - 9, dots * DOT, DOT * 2, y - 9);
            body +=
              ink.line(PAD, y, [{ text: fit(language, nameCols - 2) }]) +
              `<rect x="${barX}" y="${y - 9}" width="${dots * DOT}" height="${DOT * 2}" fill="${palette.border}" opacity="0.55" mask="url(#leds${i})"/>` +
              `<rect class="grow g${i}" x="${barX}" y="${y - 9}" width="${+(lit * DOT).toFixed(2)}" height="${DOT * 2}" fill="${palette.levels[Math.max(1, 4 - i)]}" mask="url(#leds${i})"/>` +
              ink.lineEnd(width - PAD, y, [{ text: share(commits), tone: "muted" }]);
            css += `.g${i}{animation-delay:${(i * 0.08).toFixed(2)}s}`;
            band++;
          });
          return { defs, body, css: growCss(0) + css };
        },
      },
    ],
  };
}

// ── status bar ──────────────────────────────────────────────────────────────

/**
 * tmux's status line: the session, one window per link, and the date the
 * dashboard was drawn, filling out to the grid's full width.
 */
export function statusBar(session: string, links: Link[], drawn: string, fullWidth: number, credit: string): Image[] {
  const chip = (name: string, text: Span[], alt: string, href: string | undefined, inset: { left?: number; right?: number; width?: number }): Image => {
    const cols = text.reduce((n, span) => n + columns(span.text), 0);
    const left = inset.left ?? 0;
    const width = inset.width ?? Math.ceil(left + (cols + 2) * TEXT.advance + (inset.right ?? 0));
    return {
      name,
      width,
      alt,
      href,
      render: (palette) => {
        const ink = new Ink();
        const body =
          `<rect x="${left}" y="3" width="${width - left - (inset.right ?? 0)}" height="${BAND - 6}" fill="${palette.accent}"/>` +
          (inset.width ? ink.lineEnd(width - (inset.right ?? 0) - TEXT.advance, TEXT.baseline, text) : ink.line(left + TEXT.advance, TEXT.baseline, text));
        return piece({ width, bands: 1, palette, chrome: { sides: false }, title: alt, draw: () => ({ body }) });
      },
    };
  };

  const images: Image[] = [
    chip(`bar-session-${hash(session)}`, [{ text: `[${session}]`, tone: "onAccent", bold: true }], `tmux session ${session}`, undefined, { left: INSET }),
    ...links.map((link, i) =>
      chip(`bar-${hash(link.label, link.url)}`, [{ text: `${i}:${link.label}${i === 0 ? "*" : ""}`, tone: "onAccent" }], `${link.label}: ${link.url.replace(/^mailto:/, "").replace(/^https?:\/\//, "")}`, link.url, {}),
    ),
  ];
  const used = images.reduce((n, image) => n + image.width, 0);
  const clockText: Span[] = [{ text: `drawn ${drawn}`, tone: "onAccent" }];
  const clockMin = Math.ceil((columns(clockText[0]!.text) + 2) * TEXT.advance + INSET);
  images.push(chip("bar-clock", clockText, `Drawn by afterglow on ${drawn}`, credit, { right: INSET, width: Math.max(clockMin, fullWidth - used) }));
  return images;
}
