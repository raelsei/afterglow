// Draws one dashboard per shape and serves them side by side, for a look
// before committing to flags: `bun run preview -- --user <login> [flags]`.
// The flags go to main.ts as they are; the token comes from GITHUB_TOKEN.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHAPES } from "./shapes";
import { escapeXml } from "./text";

const OUT = "preview";
const flags = process.argv.slice(2);
const shapes = Object.keys(SHAPES);

rmSync(OUT, { recursive: true, force: true });
// The shape and the folder come first: main.ts reads the first of a repeated flag.
const runs = shapes.map((shape) =>
  Bun.spawn([process.execPath, join(import.meta.dir, "main.ts"), "--shape", shape, "--out", join(OUT, shape), ...flags], { stdout: "inherit", stderr: "inherit" }).exited,
);
if ((await Promise.all(runs)).some((code) => code !== 0)) process.exit(1);

const links = shapes.map((shape, i) => `<a href="${shape}/preview.html" target="view"${i ? "" : ' class="on"'}>${shape}</a>`).join("\n");
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>afterglow previews</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 15px/1.5 ui-monospace, Menlo, monospace; background: #0d1117; color: #d1d9e0; display: grid; grid-template-columns: 240px 1fr; height: 100vh; }
  nav { padding: 20px; border-right: 1px solid #30363d; }
  nav h1 { font-size: 15px; margin: 0 0 12px; color: #b6ff3d; }
  nav a { display: block; padding: 6px 10px; color: inherit; text-decoration: none; border-radius: 6px; }
  nav a:hover, nav a.on { background: #21262d; }
  nav small { display: block; margin-top: 16px; color: #8b949e; }
  iframe { border: 0; width: 100%; height: 100vh; }
</style>
<nav>
<h1>afterglow</h1>
${links}
<small>${escapeXml(flags.join(" "))}</small>
<small>Light or dark follows your system theme. Make the window narrow to see the phone layout.</small>
</nav>
<iframe name="view" src="${shapes[0]}/preview.html"></iframe>
<script>
  for (const a of document.querySelectorAll("nav a"))
    a.addEventListener("click", () => {
      document.querySelector("nav a.on")?.classList.remove("on");
      a.classList.add("on");
    });
</script>
`,
);

// Local only. The URL parser folds "..", and nothing decodes an escaped "/", so a path cannot leave the folder.
const server = Bun.serve({
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = Bun.file(join(OUT, path === "/" ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`afterglow: ${shapes.length} previews at ${server.url}`);
