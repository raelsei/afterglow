import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchFeed } from "./feed";
import { fetchProfile } from "./github";
import { injectBlock, readmeBlock, type Group, type Image } from "./readme";
import { yearStats } from "./stats";
import { PHOSPHOR, TEXT, columns, terminal, wrap, yearSvg, type Line, type Palette, type Span } from "./svg";
import { renderTorus } from "./torus";

const REPO = "https://github.com/raelsei/afterglow";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** The torus canvas: 73 by 42 cells of 6 by 10 px. */
const YEAR = { cols: 73, rows: 42, width: 440, height: 420, frames: 120, period: 15 };
/** Post and link lines are 56 columns wide. */
const LIST_COLS = 56;
const LIST_WIDTH = Math.ceil(LIST_COLS * TEXT.advance);

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

function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

async function main(): Promise<void> {
  const login = input("user") || process.env.GITHUB_REPOSITORY_OWNER || "";
  if (!login) throw new Error("Set `user` to the GitHub login to draw");
  const token = input("token") || process.env.GITHUB_TOKEN || "";
  if (!token) throw new Error("Set `token` or GITHUB_TOKEN; the contribution calendar needs an authenticated GraphQL call");
  const outDir = input("out") || "afterglow";
  const readmePath = input("readme");
  const repository = process.env.GITHUB_REPOSITORY;
  const baseUrl = input("base_url") || (repository ? `https://raw.githubusercontent.com/${repository}/output` : "");
  if (readmePath && !baseUrl) throw new Error("Set `base_url`: where the README should load the images from");
  const postCount = Math.min(20, Math.max(1, Number.parseInt(input("posts") || "5", 10) || 5));

  const [profile, feed] = await Promise.all([
    fetchProfile(login, token),
    input("feed") ? fetchFeed(input("feed")) : Promise.resolve(null),
  ]);
  const stats = yearStats(profile);
  const now = new Date();
  const prompt = input("prompt") || `${profile.login} ~ %`;
  const command = (text: string): Line => ({ spans: [{ text: prompt, tone: "accent" }, { text: ` ${text}` }] });
  const links = inputLines("links")
    .filter(Boolean)
    .map((line) => {
      const [label, url] = line.trim().split(/\s+/);
      if (!label || !url) throw new Error(`links: "${line}" needs a label and a URL`);
      return { label, url, shown: url.replace(/^mailto:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "") };
    });

  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const emit = (name: string, render: (palette: Palette) => string): void => {
    for (const theme of ["dark", "light"] as const) {
      const file = join(outDir, `${name}-${theme}.svg`);
      writeFileSync(file, render(PHOSPHOR[theme]));
      written.push(file);
    }
  };
  const hash = (...parts: string[]) => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 8);
  const groups: Group[] = [];

  // The year, beside whoami.
  const frames = renderTorus(profile, { cols: YEAR.cols, rows: YEAR.rows, frames: YEAR.frames, cellAspect: 0.6 });
  const yearAlt = `A spinning ASCII torus drawn from ${profile.login}'s GitHub contributions over the last year, busier days raised and brighter`;
  emit("year", (palette) => yearSvg(frames, { ...YEAR, palette, title: yearAlt }));

  const who = inputLines("whoami");
  if (who.length === 0) who.push(profile.name ?? profile.login, ...(profile.bio ? wrap(profile.bio, 34, 3) : []));
  const figure = (text: string): Span => ({ text, tone: "accent" });
  const statLines: Span[][] = [];
  if (stats.total > 0) {
    statLines.push([figure(stats.total.toLocaleString("en-US")), { text: ` contribution${stats.total === 1 ? "" : "s"} in the last year` }]);
  } else statLines.push([{ text: "no contributions in the last year", tone: "muted" }]);
  if (stats.peak) statLines.push([{ text: "peak " }, figure(stats.peak.count.toLocaleString("en-US")), { text: ` on ${dayMonthYear(stats.peak.date)}` }]);
  if (stats.busiestWeekday !== null) statLines.push([{ text: "most active on " }, figure(WEEKDAYS[stats.busiestWeekday]!)]);
  if (stats.streak >= 2) statLines.push([figure(`${stats.streak}-day`), { text: " streak" }]);

  const whoLines: Line[] = [
    command("whoami"),
    { display: true, spans: [{ text: who[0]! }] },
    ...who.slice(1).map((text): Line => ({ spans: text ? [{ text }] : [] })),
    { spans: [] },
    command("afterglow --year"),
    ...statLines.map((spans): Line => ({ spans })),
  ];
  // Sized by who you are, not by today's figures, so the README's width
  // attribute stays put; 38 columns fit "999,999 contributions in the last year".
  const whoCols = Math.max(
    38,
    ...whoLines.slice(0, -statLines.length).map((line) => line.spans.reduce((n, span) => n + columns(span.text), 0) * (line.display ? 2.25 : 1)),
  );
  const whoWidth = Math.ceil(whoCols * TEXT.advance);
  const identity = [who[0], who.slice(1).filter(Boolean).join(" ")].filter(Boolean).join(" — ");
  const figures = statLines.map((spans) => spans.map((span) => span.text).join("")).join("; ");
  emit("whoami", (palette) => terminal(whoLines, { width: whoWidth, height: YEAR.height, palette, title: `${identity} ${figures}.` }));
  // The README's alt text stays free of the daily figures: they change every
  // run, and the README should only change when the post list does. The
  // figures are in the image's own <title>.
  groups.push({
    layout: "row",
    images: [
      { name: "year", width: YEAR.width, alt: yearAlt, href: REPO },
      { name: "whoami", width: whoWidth, alt: `${identity} Contribution figures for the last year.`, href: links[0]?.url },
    ],
  });

  // Latest posts, newest first, each line its own link.
  if (feed) {
    const shown = feed.posts.slice(0, postCount);
    const dates = shown.map((post) => {
      if (!post.date) return "";
      const short = `${MONTHS[post.date.getUTCMonth()]} ${String(post.date.getUTCDate()).padStart(2, " ")}`;
      return post.date.getUTCFullYear() === now.getUTCFullYear() ? short : `${short} ${post.date.getUTCFullYear()}`;
    });
    const dateCols = Math.max(0, ...dates.map(columns));
    const gutter = dateCols ? dateCols + 2 : 0;

    const note = inputLines("feed_note").flatMap((line) => (line ? wrap(line, LIST_COLS - 2, 3) : [""]));
    const headLines: Line[] = [...note.map((text): Line => ({ spans: [{ text: `# ${text}`.trimEnd(), tone: "muted" }] })), command(`ls -t posts | head -${shown.length}`)];
    emit("posts", (palette) => terminal(headLines, { width: LIST_WIDTH, palette, title: headLines.map((l) => l.spans.map((s) => s.text).join("")).join("\n") }));
    const images: Image[] = [
      { name: "posts", width: LIST_WIDTH, alt: [...note, `ls -t posts | head -${shown.length}`].join(" ") },
    ];

    shown.forEach((post, i) => {
      const title = wrap(post.title, LIST_COLS - gutter, 2);
      const lines: Line[] = title.map((text, row) => ({
        spans: [
          { text: row === 0 ? dates[i]!.padEnd(gutter) : " ".repeat(gutter), tone: "muted" },
          { text, link: true },
        ],
      }));
      const name = `post-${hash(post.url, post.title, dates[i]!)}`;
      emit(name, (palette) => terminal(lines, { width: LIST_WIDTH, palette, title: post.title }));
      images.push({ name, width: LIST_WIDTH, alt: post.title, href: post.url });
    });

    const archive = input("posts_url") || feed.home;
    if (archive) {
      const shownUrl = archive.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const more: Line[] = [{ spans: [{ text: "…".padEnd(gutter), tone: "muted" }, { text: "all of them at ", tone: "muted" }, { text: shownUrl, tone: "muted", link: true }] }];
      emit(`posts-more-${hash(archive)}`, (palette) => terminal(more, { width: LIST_WIDTH, palette, title: `All posts at ${shownUrl}` }));
      images.push({ name: `posts-more-${hash(archive)}`, width: LIST_WIDTH, alt: `All posts at ${shownUrl}`, href: archive });
    }
    groups.push({ layout: "stack", images });
  }

  // Where to find the person, as `cat links` output.
  if (links.length > 0) {
    const labelCols = Math.max(...links.map((link) => columns(link.label)));
    emit("links", (palette) => terminal([command("cat links")], { width: LIST_WIDTH, palette, title: `${prompt} cat links` }));
    const images: Image[] = [{ name: "links", width: LIST_WIDTH, alt: "cat links" }];
    for (const link of links) {
      const name = `link-${hash(link.label, link.url)}`;
      const line: Line = { spans: [{ text: `${link.label.padEnd(labelCols)}  `, tone: "muted" }, { text: link.shown, link: true }] };
      emit(name, (palette) => terminal([line], { width: LIST_WIDTH, palette, title: `${link.label}: ${link.shown}` }));
      images.push({ name, width: LIST_WIDTH, alt: `${link.label}: ${link.shown}`, href: link.url });
    }
    groups.push({ layout: "stack", images });
  }

  // The prompt waits.
  const today = now.toISOString().slice(0, 10);
  const footer: Line[] = [
    { spans: [{ text: `# drawn by afterglow on ${dayMonthYear(today)}`, tone: "muted" }] },
    { spans: [{ text: prompt, tone: "accent" }, { text: " " }, { text: "_", tone: "accent", cursor: true }] },
  ];
  emit("prompt", (palette) => terminal(footer, { width: LIST_WIDTH, palette, title: `Drawn by afterglow on ${dayMonthYear(today)}` }));
  groups.push({ layout: "stack", images: [{ name: "prompt", width: LIST_WIDTH, alt: "Drawn by afterglow", href: REPO }] });

  const block = readmeBlock(groups, baseUrl || ".");
  writeFileSync(join(outDir, "README.block.md"), `${block}\n`);
  if (readmePath) {
    const before = readFileSync(readmePath, "utf8");
    const after = injectBlock(before, block);
    if (after !== before) writeFileSync(readmePath, after);
    console.log(after === before ? `${readmePath}: unchanged` : `${readmePath}: block updated`);
  }
  console.log(`afterglow: ${profile.login}, ${stats.total} contributions, ${feed ? Math.min(postCount, feed.posts.length) : 0} posts, ${written.length} files in ${outDir}/`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(process.env.GITHUB_ACTIONS ? `::error title=afterglow::${message}` : `afterglow: ${message}`);
  process.exit(1);
});
