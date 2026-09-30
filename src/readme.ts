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
