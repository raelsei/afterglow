import { escapeXml } from "./svg";

export const START = "<!-- afterglow:start -->";
export const END = "<!-- afterglow:end -->";

export interface Image {
  /** File stem; `<name>-dark.svg` and `<name>-light.svg` sit under the base URL. */
  name: string;
  width: number;
  alt: string;
  href?: string;
}

/** A group of images: `row` sets them side by side and lets them wrap on a
 *  narrow screen; `stack` puts each on its own line. */
export interface Group {
  layout: "row" | "stack";
  images: Image[];
}

export function readmeBlock(groups: Group[], base: string): string {
  const url = (file: string) => escapeXml(`${base.replace(/\/+$/, "")}/${file}`);
  const markup = (image: Image) => {
    // align="top" drops the gap an inline image leaves for text descenders, so
    // stacked lines keep the 26px pitch they were drawn on. No height: on a
    // narrow screen the width shrinks and the height has to follow it, or the
    // image letterboxes inside a box of its desktop height.
    const picture =
      `<picture><source media="(prefers-color-scheme: dark)" srcset="${url(`${image.name}-dark.svg`)}">` +
      `<img src="${url(`${image.name}-light.svg`)}" width="${image.width}" alt="${escapeXml(image.alt)}" align="top"></picture>`;
    return image.href ? `<a href="${escapeXml(image.href)}">${picture}</a>` : picture;
  };
  const body = groups
    .map((group) => `<p>\n${group.images.map(markup).join(group.layout === "row" ? "\n" : "<br>\n")}\n</p>`)
    .join("\n");
  return `${START}\n${body}\n${END}`;
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
