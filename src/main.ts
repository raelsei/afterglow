import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchFeed } from "./feed";
import { fetchCommits, fetchProfile, type Link } from "./github";
import { loadHistory, record } from "./history";
import { DEFAULT_LAYOUT, parseLayout, placeFull, placeRow, type Cell, type PaneId, type PlacedRow } from "./layout";
import { FULL } from "./pane";
import {
  clockPane,
  contribsPane,
  dayMonthYear,
  graphPane,
  gridPane,
  langsPane,
  logPane,
  neofetchPane,
  pinnedPane,
  postsPane,
  prsPane,
  releasesPane,
  statusBar,
  topPane,
  trendsPane,
  whoamiPane,
  yearPane,
  type Pane,
} from "./panes";
import { injectBlock, previewPage, readmeBlock, referencedImages } from "./readme";
import { SHAPES, type Shape } from "./shapes";
import { yearStats } from "./stats";
import { wrap } from "./text";
import { EFFECTS, THEMES, withAccent, type Effect } from "./theme";

const REPO = "https://github.com/raelsei/afterglow";

/** An action input (`INPUT_<NAME>`), or `--name value` on the command line. */
function input(name: string): string {
  const flag = process.argv.indexOf(`--${name.replace(/_/g, "-")}`);
  if (flag > 1 && flag + 1 < process.argv.length) return process.argv[flag + 1]!.trim();
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

/** Multi-line input as lines, inner blank lines kept as spacing. */
function inputLines(name: string): string[] {
  const value = input(name);
  return value ? value.split(/\r?\n/).map((line) => line.trimEnd()) : [];
}

async function main(): Promise<void> {
  const login = input("user") || process.env.GITHUB_REPOSITORY_OWNER || "";
  if (!login) throw new Error("Set `user` to the GitHub login to draw");
  const token = input("token") || process.env.GITHUB_TOKEN || "";
  if (!token) throw new Error("Set `token` or GITHUB_TOKEN; the contribution calendar needs an authenticated GraphQL call");
  const themeName = input("theme") || "phosphor";
  if (!Object.hasOwn(THEMES, themeName)) throw new Error(`theme: "${themeName}" is not one of ${Object.keys(THEMES).join(", ")}`);
  const accent = input("accent");
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error(`accent: "${accent}" is not a #rrggbb colour`);
  const theme = accent ? withAccent(THEMES[themeName]!, accent) : THEMES[themeName]!;
  const shapeName = input("shape") || "torus";
  if (!Object.hasOwn(SHAPES, shapeName)) throw new Error(`shape: "${shapeName}" is not one of ${Object.keys(SHAPES).join(", ")}`);
  const shape = shapeName as Shape; // checked just above
  const yearInput = input("year");
  const year = yearInput ? Number(yearInput) : null;
  if (year !== null && !(Number.isInteger(year) && year >= 2008 && year <= new Date().getUTCFullYear())) {
    throw new Error(`year: "${yearInput}" is not a year from 2008 to this one`);
  }
  const density = input("density") || "full";
  if (density !== "full" && density !== "compact") throw new Error(`density: "${density}" is neither full nor compact`);
  const layout = parseLayout(input("layout") || DEFAULT_LAYOUT, density);
  const timezone = input("timezone") || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`timezone: "${timezone}" is not an IANA time zone name like Europe/Istanbul`);
  }
  const outDir = input("out") || "afterglow";
  const readmePath = input("readme");
  const repository = process.env.GITHUB_REPOSITORY;
  const baseUrl = input("base_url") || (repository ? `https://raw.githubusercontent.com/${repository}/output` : "");
  if (readmePath && !baseUrl) throw new Error("Set `base_url`: where the README should load the images from");
  const count = (name: string, fallback: number) => Math.min(20, Math.max(1, Number.parseInt(input(name) || String(fallback), 10) || fallback));
  const feedUrl = input("feed");
  const effectNames = input("effects").split(/[\s,]+/).filter(Boolean);
  const unknownEffect = effectNames.find((name) => !(EFFECTS as readonly string[]).includes(name));
  if (unknownEffect) throw new Error(`effects: "${unknownEffect}" is not one of ${EFFECTS.join(", ")}`);
  const effects = new Set(effectNames as Effect[]); // checked just above

  const historyPath = join(outDir, "history.json");
  const [profile, feed, previous] = await Promise.all([
    fetchProfile(login, token, year),
    feedUrl ? fetchFeed(feedUrl) : Promise.resolve(null),
    loadHistory(historyPath, baseUrl),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const history = record(previous, { date: today, stars: profile.stars, followers: profile.followers, total: profile.total });
  // Commits cost a second request, made only for the panes that read them.
  const placed = layout.flatMap((row) => ("full" in row ? [row.full] : "left" in row ? [...row.left, ...row.right] : []));
  const commits = placed.some((cell) => cell.id === "log" || cell.id === "clock") ? await fetchCommits(profile, token) : [];
  const stats = yearStats(profile);
  const links: Link[] = inputLines("links").length
    ? inputLines("links")
        .filter((line) => line.trim())
        .map((line) => {
          const [label, url] = line.trim().split(/\s+/);
          if (!label || !url) throw new Error(`links: "${line}" needs a label and a URL`);
          return { label, url };
        })
    : profile.links;
  const archive = input("posts_url") || feed?.home || null;
  // The biggest things on the page lead to the writing when there is some.
  const home = (feed && archive) || links[0]?.url || `https://github.com/${profile.login}`;

  const builders: Record<PaneId, (compact: boolean) => Pane | null> = {
    year: (compact) => yearPane(profile, home, compact, shape),
    whoami: (compact) => whoamiPane(profile, stats, inputLines("whoami"), links[0]?.url, compact),
    activity: (compact) => graphPane(profile, home, compact),
    posts: (compact) => {
      if (!feed) return null;
      const note = inputLines("feed_note").flatMap((line) => (line ? wrap(line, 40, 3) : []));
      return postsPane(feed, { count: count("posts", 5), note, archive, source: archive ?? feedUrl, compact });
    },
    langs: (compact) => langsPane(profile, `https://github.com/${profile.login}?tab=repositories`, compact),
    top: (compact) => topPane(profile, count("repos", 5), compact),
    contribs: (compact) => contribsPane(profile, `https://github.com/${profile.login}`, compact),
    pinned: (compact) => pinnedPane(profile, compact),
    prs: (compact) => prsPane(profile, compact),
    grid: (compact) => gridPane(profile, stats, compact),
    neofetch: (compact) => neofetchPane(profile, compact, shape, history),
    releases: (compact) => releasesPane(profile, compact),
    log: (compact) => logPane(profile, commits, compact),
    clock: (compact) => clockPane(profile, commits, timezone, compact),
    trends: (compact) => trendsPane(history, compact),
  };

  const drawn = dayMonthYear(today);
  const rows: PlacedRow[] = [];
  let panes = 0;
  // A pane with nothing to show (posts without a feed) drops out; the rest of its row closes up.
  const built = (cells: Cell[]) => cells.map((cell) => builders[cell.id](cell.compact)).filter((pane): pane is Pane => pane !== null);
  for (const row of layout) {
    if ("bar" in row) {
      rows.push({ lines: [statusBar(input("session") || profile.login, links, drawn, FULL, REPO, links[0]?.url)] });
      continue;
    }
    if ("full" in row) {
      const [pane] = built([row.full]);
      if (pane) rows.push(placeFull(pane));
      panes += pane ? 1 : 0;
      continue;
    }
    const left = built(row.left);
    const right = built(row.right);
    if (left.length && right.length) rows.push(placeRow(left, right));
    else for (const pane of [...left, ...right]) rows.push(placeFull(pane));
    panes += left.length + right.length;
  }

  // Every image is named by its content. GitHub's raw CDN keeps a file for
  // five minutes and ignores query strings, so a drawing that changes under a
  // fixed name reaches visitors late and unevenly; a new name reaches them with
  // the README that points to it.
  mkdirSync(outDir, { recursive: true });
  let files = 0;
  const written: Record<string, true> = {};
  for (const row of rows) {
    for (const image of [...(row.float ? [row.float] : []), ...row.lines.flat()]) {
      const dark = image.render({ ...theme.dark, effects });
      const light = image.render({ ...theme.light, effects });
      image.name = `${image.name}-${createHash("sha1").update(dark).update("\0").update(light).digest("hex").slice(0, 8)}`;
      writeFileSync(join(outDir, `${image.name}-dark.svg`), dark);
      writeFileSync(join(outDir, `${image.name}-light.svg`), light);
      written[`${image.name}-dark.svg`] = true;
      written[`${image.name}-light.svg`] = true;
      files += 2;
    }
  }

  const block = readmeBlock(rows, baseUrl || ".");
  writeFileSync(join(outDir, "README.block.md"), `${block}\n`);
  writeFileSync(join(outDir, "preview.html"), previewPage(readmeBlock(rows, ".")));
  // Not referenced by the README: it rides on the published branch for the next run to read.
  writeFileSync(historyPath, `${JSON.stringify(history)}\n`);
  if (readmePath) {
    const before = readFileSync(readmePath, "utf8");
    const after = injectBlock(before, block);
    // The published branch is replaced on every run, and the README is
    // committed a moment after it. Carry the images the old README still
    // points to, so that moment shows the old dashboard instead of holes.
    if (/^https?:\/\//.test(baseUrl)) {
      const base = baseUrl.replace(/\/+$/, "");
      for (const file of referencedImages(before, base).filter((file) => !written[file])) {
        const res = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (res?.ok) writeFileSync(join(outDir, file), Buffer.from(await res.arrayBuffer()));
        else console.warn(`afterglow: could not carry over ${base}/${file}; the README it belongs to is being replaced anyway`);
      }
    }
    if (after !== before) writeFileSync(readmePath, after);
    console.log(after === before ? `${readmePath}: unchanged` : `${readmePath}: block updated`);
  }
  console.log(`afterglow: ${profile.login}, ${stats.total} contributions, ${panes} panes, ${files} files in ${outDir}/`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(process.env.GITHUB_ACTIONS ? `::error title=afterglow::${message}` : `afterglow: ${message}`);
  process.exit(1);
});
