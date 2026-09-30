import { expect, test } from "bun:test";
import { parseLayout, placeRow, type PlacedRow } from "./layout";
import { FULL, HALF, RIGHT_MARGIN } from "./pane";
import type { Pane, Piece } from "./panes";

const item = (name: string, bands: number, href?: string): Piece => ({ name, alt: name, href, bands, chrome: {}, draw: () => ({ body: "" }) });
const single = (name: string, bands: number): Pane => ({ kind: "single", pieces: [item(name, bands)] });
const stack = (name: string, ...bands: number[]): Pane => ({ kind: "stack", pieces: bands.map((b, i) => item(`${name}${i}`, b, `https://x.dev/${name}${i}`)) });

/** Height in bands of each column, read back from the SVG each image renders. */
function heights(row: PlacedRow): number[] {
  const bandsOf = (image: { render: (p: never) => string }) => Number(image.render({} as never).match(/height="(\d+)"/)![1]) / 28;
  const lines = row.lines.flat().reduce((n, image) => n + bandsOf(image), 0);
  return row.float ? [bandsOf(row.float), lines] : [lines];
}

test("two panes share a row at one height, the list stretching its last image", () => {
  const row = placeRow([single("activity", 7), stack("posts", 3, 2, 2, 1, 2)]);
  expect(heights(row)).toEqual([10, 10]);
  expect(row.side).toBe("left");
  expect(row.float!.name).toBe("activity");
  expect(row.lines.map((line) => line[0]!.name)).toEqual(["posts0", "posts1", "posts2", "posts3", "posts4"]);

  const tall = placeRow([single("year", 13), stack("top", 2, 1, 1)]);
  expect(heights(tall)).toEqual([13, 13]);
});

test("a list written on the left keeps its side: its partner floats right instead", () => {
  const row = placeRow([stack("posts", 1, 1, 2), single("activity", 5)]);
  expect(row.side).toBe("right");
  expect(row.float!.name).toBe("activity");
  expect(row.float!.width).toBe(HALF + RIGHT_MARGIN);
  expect(row.lines.flat().every((image) => image.width === HALF && image.href)).toBe(true);
});

test("two lists in one row: the left becomes one image, the right keeps a link per line", () => {
  const row = placeRow([stack("top", 1, 1, 1), stack("posts", 1, 1, 1, 1)]);
  expect(row.float!.name).toBe("top0-flat");
  expect(row.float!.href).toBe("https://x.dev/top0");
  expect(row.lines).toHaveLength(4);
  expect(heights(row)).toEqual([4, 4]);
});

test("a pane alone spans both columns", () => {
  const row = placeRow([single("langs", 6)]);
  expect(row.float).toBeUndefined();
  expect(row.lines[0]![0]!.width).toBe(FULL);
});

test("layout reads rows, sizes, comments and the bar; a pane left out is off", () => {
  expect(parseLayout("year:full | whoami\n# the rest\n\nposts:compact\nbar", "compact")).toEqual([
    {
      cells: [
        { id: "year", compact: false },
        { id: "whoami", compact: true },
      ],
    },
    { cells: [{ id: "posts", compact: true }] },
    { bar: true },
  ]);
});

test("layout refuses what GitHub cannot draw, and says why", () => {
  expect(() => parseLayout("year whoami posts", "full")).toThrow(/at most two panes/);
  expect(() => parseLayout("year bar", "full")).toThrow(/line of its own/);
  expect(() => parseLayout("clock", "full")).toThrow(/not a pane/);
  expect(() => parseLayout("year:tiny", "full")).toThrow(/:compact and :full/);
  expect(() => parseLayout("year\nyear:compact", "full")).toThrow(/appears twice/);
});
