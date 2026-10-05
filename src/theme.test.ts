import { expect, test } from "bun:test";
import { THEMES, contrast, withAccent } from "./theme";

test("any accent ends up readable on GitHub's grounds, and so does the text on it", () => {
  for (const hex of ["#ff6ac1", "#ffff00", "#000080", "#777777", "#ffffff", "#000000"]) {
    const { dark, light } = withAccent(THEMES.phosphor!, hex);
    expect(contrast(dark.accent, "#0d1117")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.levels[1], "#ffffff")).toBeGreaterThanOrEqual(3);
    for (const palette of [dark, light]) {
      expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
      expect(palette.levels[3]).toBe(palette.accent);
    }
  }
});

test("an accent that already reads is kept as given", () => {
  expect(withAccent(THEMES.phosphor!, "#ff6ac1").dark.accent).toBe("#ff6ac1");
});
