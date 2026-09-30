import { expect, test } from "bun:test";
import { arrange } from "./layout";
import { FULL, HALF } from "./pane";
import type { Pane, Piece } from "./panes";

const item = (name: string, bands: number): Piece => ({ name, alt: name, bands, chrome: {}, draw: () => ({ body: "" }) });
const single = (name: string, bands: number): Pane => ({ kind: "single", pieces: [item(name, bands)] });
const stack = (name: string, ...bands: number[]): Pane => ({ kind: "stack", pieces: bands.map((b, i) => item(`${name}${i}`, b)) });

/** Height in bands of each column of a row, reading the SVG each image renders. */
function heights(row: ReturnType<typeof arrange>[number]): number[] {
  const bandsOf = (image: { render: (p: never) => string }) => Number(image.render({} as never).match(/height="(\d+)"/)![1]) / 28;
  const right = row.lines.flat().reduce((n, image) => n + bandsOf(image), 0);
  return row.float ? [bandsOf(row.float), right] : [right];
}

test("every row has two columns of equal height, a stack stretching its last image", () => {
  const rows = arrange([single("year", 13), single("whoami", 14), single("activity", 7), stack("posts", 3, 2, 2, 1, 2), single("langs", 6), stack("top", 2, 1, 1, 1)]);
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    const [left, right] = heights(row);
    expect(left).toBe(right!);
  }
  expect(heights(rows[1]!)).toEqual([10, 10]);
  expect(heights(rows[2]!)).toEqual([6, 6]);
  // The single pane floats left; the stack fills the right column line by line.
  expect(rows[1]!.float!.name).toBe("activity");
  expect(rows[1]!.lines.map((line) => line[0]!.name)).toEqual(["posts0", "posts1", "posts2", "posts3", "posts4"]);
  expect(rows.every((row) => row.lines.flat().every((image) => image.width === HALF))).toBe(true);
});

test("stacks get a single partner before singles pair with each other", () => {
  const rows = arrange([single("year", 13), single("whoami", 14), single("activity", 7), single("langs", 6), stack("top", 2, 1, 1)]);
  expect(rows.map((row) => [row.float?.name, row.lines[0]![0]!.name])).toEqual([
    ["year", "whoami"],
    ["activity", "top0"],
    [undefined, "langs"],
  ]);
  // The one left over spans both columns.
  expect(rows[2]!.lines[0]![0]!.width).toBe(FULL);
});
