import { expect, setSystemTime, test } from "bun:test";
import { fontFaces } from "./font";

// Every image is named by its content, so an embedded font that carried the
// time it was made would rename every file on every run.
test("the same characters embed the same bytes whenever they are drawn", () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const before = fontFaces("afterglow", "@raelsei");
  setSystemTime(new Date("2031-06-15T12:34:56Z"));
  const after = fontFaces("afterglow", "@raelsei");
  setSystemTime();
  expect(after).toBe(before);
});
