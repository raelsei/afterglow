import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchFeed } from "./feed";
import { fetchProfile, type Link } from "./github";
import { DEFAULT_LAYOUT, parseLayout, placeFull, placeRow, type Cell, type PlacedRow } from "./layout";
import { FULL } from "./pane";
import { graphPane, langsPane, postsPane, statusBar, topPane, whoamiPane, yearPane, type Pane } from "./panes";
import { injectBlock, readmeBlock } from "./readme";
import { yearStats } from "./stats";
import { wrap } from "./text";
import { THEMES } from "./theme";

const REPO = "https://github.com/raelsei/afterglow";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  const theme = THEMES[themeName];
  if (!theme) throw new Error(`theme: "${themeName}" is not one of ${Object.keys(THEMES).join(", ")}`);
  const density = input("density") || "full";
  if (density !== "full" && density !== "compact") throw new Error(`density: "${density}" is neither full nor compact`);
  const layout = parseLayout(input("layout") || DEFAULT_LAYOUT, density);
  const outDir = input("out") || "afterglow";
  const readmePath = input("readme");
  const repository = process.env.GITHUB_REPOSITORY;
  const baseUrl = input("base_url") || (repository ? `https://raw.githubusercontent.com/${repository}/output` : "");
  if (readmePath && !baseUrl) throw new Error("Set `base_url`: where the README should load the images from");
  const count = (name: string, fallback: number) => Math.min(20, Math.max(1, Number.parseInt(input(name) || String(fallback), 10) || fallback));
  const feedUrl = input("feed");

  const [profile, feed] = await Promise.all([fetchProfile(login, token), feedUrl ? fetchFeed(feedUrl) : Promise.resolve(null)]);
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

  const build = (id: string, compact: boolean): Pane | null => {
    if (id === "year") return yearPane(profile, home, compact);
    if (id === "whoami") return whoamiPane(profile, stats, inputLines("whoami"), links[0]?.url, compact);
    if (id === "activity") return graphPane(profile, home, compact);
    if (id === "posts") {
      if (!feed) return null;
      const note = inputLines("feed_note").flatMap((line) => (line ? wrap(line, 40, 3) : []));
      return postsPane(feed, { count: count("posts", 5), note, archive, source: archive ?? feedUrl, compact });
    }
    if (id === "langs") return langsPane(profile, `https://github.com/${profile.login}?tab=repositories`, compact);
    return topPane(profile, count("repos", 5), compact);
  };

  const now = new Date();
  const drawn = `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  const rows: PlacedRow[] = [];
  let panes = 0;
  // A pane with nothing to show (posts without a feed) drops out; the rest of its row closes up.
  const built = (cells: Cell[]) => cells.map((cell) => build(cell.id, cell.compact)).filter((pane): pane is Pane => pane !== null);
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

  mkdirSync(outDir, { recursive: true });
  let files = 0;
  for (const row of rows) {
    for (const image of [...(row.float ? [row.float] : []), ...row.lines.flat()]) {
      for (const mode of ["dark", "light"] as const) {
        writeFileSync(join(outDir, `${image.name}-${mode}.svg`), image.render(theme[mode]));
        files++;
      }
    }
  }

  const block = readmeBlock(rows, baseUrl || ".");
  writeFileSync(join(outDir, "README.block.md"), `${block}\n`);
  if (readmePath) {
    const before = readFileSync(readmePath, "utf8");
    const after = injectBlock(before, block);
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
