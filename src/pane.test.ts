import { expect, test } from "bun:test";
import { BAND, COLUMN, FULL, GUTTER, HALF, INSET, NARROW_COLUMN, PAD, RIGHT_MARGIN, TEXT, piece } from "./pane";

test("two columns stay side by side in a 1280px screen's 831px README column", () => {
  expect(NARROW_COLUMN).toBe(831);
  expect(HALF * 2 + GUTTER).toBeLessThanOrEqual(NARROW_COLUMN);
  expect(FULL).toBe(HALF * 2 + GUTTER);
  // A right float, its padding and trailing room, and the list beside it.
  expect(GUTTER + HALF + RIGHT_MARGIN + HALF).toBeLessThanOrEqual(NARROW_COLUMN);
});

test("a right float sits where the right column does in the narrow column, and never left of it", () => {
  const rightColumn = HALF + GUTTER;
  expect(NARROW_COLUMN - RIGHT_MARGIN - HALF).toBe(rightColumn);
  expect(COLUMN - RIGHT_MARGIN - HALF).toBeGreaterThanOrEqual(rightColumn);
});

test("the grid keeps its spacing and its bands survive a phone", () => {
  // Boxes 4px inside their images: the gutter plus both insets is one band, as between rows.
  expect(GUTTER + INSET * 2).toBe(BAND);
  // A 390px phone's ~308px column: a one-band line still fills GitHub's 21px line box.
  expect((BAND * 308) / HALF).toBeGreaterThanOrEqual(21);
  // 43 columns of text in a half pane.
  expect(Math.floor((HALF - PAD * 2) / TEXT.advance)).toBe(43);
});

test("a box's meta stops short of its title", () => {
  const svg = piece({
    width: HALF,
    bands: 2,
    palette: { fg: "#000", muted: "#000", accent: "#000", onAccent: "#000", border: "#000" } as never,
    chrome: { top: { title: "posts", meta: "blog.example-with-a-long-domain-name.dev" }, bottom: true },
    title: "posts",
    draw: () => ({ body: "" }),
  });
  const meta = svg.match(/class="muted">([^<]*)</)![1]!;
  expect(meta.endsWith("…")).toBe(true);
  const metaStart = Number(svg.match(/<tspan x="([\d.]+)" class="muted">/)![1]);
  const titleEnd = INSET + 0.5 + 14 + "posts".length * TEXT.advance;
  expect(metaStart).toBeGreaterThanOrEqual(titleEnd + 12);
});
