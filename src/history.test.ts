import { expect, test } from "bun:test";
import { change, parseHistory, record, type Snapshot } from "./history";

const day = (date: string, stars: number, followers = 0, total = 0): Snapshot => ({ date, stars, followers, total });

test("a rerun on the same day replaces that day's entry, and entries stay sorted", () => {
  const history = [day("2026-10-01", 1), day("2026-10-03", 3)];
  expect(record(history, day("2026-10-03", 5))).toEqual([day("2026-10-01", 1), day("2026-10-03", 5)]);
  expect(record(history, day("2026-10-02", 2)).map((entry) => entry.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
});

test("the history keeps the newest 400 entries", () => {
  const start = Date.UTC(2025, 0, 1);
  const history = Array.from({ length: 400 }, (_, i) => day(new Date(start + i * 86_400_000).toISOString().slice(0, 10), i));
  const next = record(history, day("2026-02-05", 400));
  expect(next.length).toBe(400);
  expect(next[0]!.date).toBe("2025-01-02");
  expect(next.at(-1)!.date).toBe("2026-02-05");
});

test("change compares with the newest entry at least that many days older", () => {
  const history = [day("2026-09-20", 100), day("2026-09-26", 110), day("2026-09-27", 120), day("2026-09-28", 125), day("2026-10-04", 146)];
  expect(change(history, "stars", 7)).toBe(146 - 120);
  // A gap: nothing from the 21st to the 25th, so the 20th is the newest that is old enough.
  expect(change([day("2026-09-20", 100), day("2026-09-30", 110), day("2026-10-04", 146)], "stars", 7)).toBe(46);
});

test("change is unknown without an entry old enough", () => {
  expect(change([], "stars", 7)).toBeNull();
  expect(change([day("2026-10-04", 146)], "stars", 7)).toBeNull();
  expect(change([day("2026-09-28", 140), day("2026-10-04", 146)], "stars", 7)).toBeNull();
});

test("a history file keeps its well-formed entries only, and one that is not a list is unreadable", () => {
  const text = JSON.stringify([
    day("2026-10-02", 2),
    { date: "2026-10-01", stars: 1, followers: 0, total: 0, extra: true },
    { date: "yesterday", stars: 1, followers: 0, total: 0 },
    { date: "2026-10-03", stars: "4", followers: 0, total: 0 },
    { date: "2026-10-03", stars: 4, followers: 0 },
    null,
  ]);
  expect(parseHistory(text)).toEqual([day("2026-10-01", 1), day("2026-10-02", 2)]);
  expect(parseHistory("{}")).toBeNull();
  expect(parseHistory("<html>")).toBeNull();
});
