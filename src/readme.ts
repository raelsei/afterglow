import { COLUMN } from "./pane";
import { escapeXml } from "./text";

export const START = "<!-- afterglow:start -->";
export const END = "<!-- afterglow:end -->";

export interface ImageRef {
  /** File stem; `<name>-dark.svg` and `<name>-light.svg` sit under the base URL. */
  name: string;
  width: number;
  alt: string;
  href?: string;
}

/**
 * One row of the grid. `float` takes one column, on `side`; `lines` fill the
 * other column beside it, one line of images each. Where two columns do not
 * fit, GitHub drops the lines below the float, so the grid becomes one column.
 */
export interface Row {
  float?: ImageRef;
  side?: "left" | "right";
  lines: ImageRef[][];
}

export function readmeBlock(rows: Row[], base: string): string {
  const url = (file: string) => escapeXml(`${base.replace(/\/+$/, "")}/${file}`);
  const markup = (image: ImageRef, align: "left" | "right" | "top") => {
    // align="left" or "right" floats the image, and GitHub pads it 20px on the
    // inner side: the gutter.
    // align="top" drops the gap an inline image leaves for descenders, so the
    // lines of a column meet exactly. No height attribute: on a narrow screen
    // the width shrinks and the height must follow it.
    const picture =
      `<picture><source media="(prefers-color-scheme: dark)" srcset="${url(`${image.name}-dark.svg`)}">` +
      `<img src="${url(`${image.name}-light.svg`)}" width="${image.width}" alt="${escapeXml(image.alt)}" align="${align}"></picture>`;
    return image.href ? `<a href="${escapeXml(image.href)}">${picture}</a>` : picture;
  };
  const body = rows
    .map((row) => {
      const lines = row.lines.map((line) => line.map((image) => markup(image, "top")).join("")).join("<br>\n");
      return `${row.float ? markup(row.float, row.side ?? "left") : ""}${lines}<br clear="all">`;
    })
    .join("\n");
  return `${START}\n<p>\n${body}\n</p>\n${END}`;
}

/** Images a README loads from directly under `base`, by file name. */
export function referencedImages(readme: string, base: string): string[] {
  const prefix = `${base.replace(/\/+$/, "")}/`;
  const files = [...readme.matchAll(/(?:src|srcset)="([^"]+\.svg)"/g)]
    .map((match) => match[1]!.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))))
    .filter((url) => url.startsWith(prefix) && !url.slice(prefix.length).includes("/"))
    .map((url) => url.slice(prefix.length));
  return [...new Set(files)];
}

/** A page that lays the block out as GitHub's README column does, to look at before publishing. */
export function previewPage(block: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>afterglow preview</title>
<style>
body{margin:0;padding:32px 16px;background:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){body{background:#0d1117}}
article{max-width:${COLUMN}px;margin:0 auto}
img{max-width:100%;box-sizing:content-box}
img[align=left]{padding-right:20px}
img[align=right]{padding-left:20px}
</style>
<article>
${block}
</article>
`;
}

/** Replaces whatever sits between the markers. A README without them is left
 *  alone and reported, because guessing where a block belongs would overwrite
 *  someone's writing. */
export function injectBlock(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END, start);
  if (start < 0 || end < 0) {
    throw new Error(`README has no ${START} … ${END} pair; add both where the block should go`);
  }
  return readme.slice(0, start) + block + readme.slice(end + END.length);
}
