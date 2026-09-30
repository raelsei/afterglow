import { expect, test } from "bun:test";
import { columns, fit, wrap } from "./text";

test("a title that needs two lines splits evenly instead of stranding a word", () => {
  expect(wrap("Your LLM can't hallucinate a number it was never given", 48, 2)).toEqual([
    "Your LLM can't hallucinate",
    "a number it was never given",
  ]);
});

test("a title that fits stays on one line", () => {
  expect(wrap("Cache the prompt, not the inputs", 48, 2)).toEqual(["Cache the prompt, not the inputs"]);
});

test("text past the line budget ends in an ellipsis inside the width", () => {
  const lines = wrap("one two three four five six seven eight nine ten", 12, 2);
  expect(lines).toHaveLength(2);
  expect(lines[1]!.endsWith("…")).toBe(true);
  for (const line of lines) expect(columns(line)).toBeLessThanOrEqual(12);
});

test("a word wider than the line is cut at the line's end", () => {
  const lines = wrap("see https://example.dev/a/very/long/path/that/never/ends", 20, 4);
  for (const line of lines) expect(columns(line)).toBeLessThanOrEqual(20);
  expect(lines.join("").replace(/\s/g, "")).toBe("seehttps://example.dev/a/very/long/path/that/never/ends");
});

test("wide characters take two columns", () => {
  expect(columns("abc")).toBe(3);
  expect(columns("日本")).toBe(4);
  expect(columns("İstanbul")).toBe(8);
});

test("fit cuts to the width with an ellipsis and leaves short text alone", () => {
  expect(fit("pocketbase-ts-starter", 12)).toBe("pocketbase-…");
  expect(fit("keel", 12)).toBe("keel");
});
