import { expect, test } from "bun:test";
import type { Day, Profile } from "./github";
import { SHAPES, renderShape, type Shape } from "./shapes";

// A year of busy and quiet days, so every shape has relief and every level shows.
const weeks: (Day | null)[][] = Array.from({ length: 53 }, (_, w) =>
  Array.from({ length: 7 }, (_, d) => {
    const count = (w * 7 + d) % 9;
    return { date: "2026-01-01", count, level: Math.min(4, Math.ceil(count / 2)) as Day["level"] };
  }),
);
const profile = { weeks } as Profile; // the shapes read the calendar only

test("every shape stays inside its frame, in every pose, and draws something in each", () => {
  const cols = 64;
  const rows = 27;
  for (const shape of Object.keys(SHAPES) as Shape[]) {
    for (const frame of renderShape(shape, profile, { cols, rows, frames: 12, cellAspect: 0.6 })) {
      const lit = (r: number, c: number) => frame.glyph[r * cols + c]! >= 0;
      let edge = 0;
      let inside = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!lit(r, c)) continue;
          if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) edge++;
          else inside++;
        }
      }
      expect({ shape, edge }).toEqual({ shape, edge: 0 });
      expect(inside).toBeGreaterThan(100);
    }
  }
});
