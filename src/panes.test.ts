import { expect, spyOn, test } from "bun:test";
import { FULL } from "./pane";
import { age, punchCard, statusBar } from "./panes";

const LABELS = ["web", "x", "linkedin", "mastodon", "bluesky", "instagram", "youtube", "facebook", "reddit", "twitch", "npm"];
const links = (count: number) => LABELS.slice(0, count).map((label) => ({ label, url: `https://${label}.example/me` }));

test("the status line fills the row exactly, no segment wider than a phone column", () => {
  for (const count of [2, 3, 5, 7]) {
    const bar = statusBar("raelsei", links(count), "30 Sep 2026", FULL, "https://x.dev");
    expect(bar).toHaveLength(count + 2);
    expect(bar.reduce((n, image) => n + image.width, 0)).toBe(FULL);
    for (const image of bar) expect(image.width).toBeLessThanOrEqual(300);
  }
});

test("links past the row's width are left out, in order, and named in a warning", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const bar = statusBar("raelsei", links(11), "30 Sep 2026", FULL, "https://x.dev");
  const warnings = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
  const kept = bar.length - 2;
  expect(bar.reduce((n, image) => n + image.width, 0)).toBe(FULL);
  expect(bar.slice(1, -1).map((image) => image.alt.split(":")[0])).toEqual(LABELS.slice(0, kept));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(LABELS.slice(kept).join(", "));
});

test("account age counts a month once its day of the month comes round", () => {
  const since = new Date("2020-05-17T08:00:00Z");
  const at = (iso: string) => age(since, new Date(`${iso}T00:00:00Z`));
  expect(at("2026-05-16")).toBe("5 years, 11 months");
  expect(at("2026-05-17")).toBe("6 years");
  expect(at("2026-06-17")).toBe("6 years, 1 month");
  expect(at("2021-06-16")).toBe("1 year");
  expect(at("2020-06-02")).toBe("0 months");
  expect(age(new Date("2025-01-31T00:00:00Z"), new Date("2025-03-01T00:00:00Z"))).toBe("1 month");
});

test("the punch card reads each instant off the time zone's clock: weekday Sunday first, hour 0 to 23", () => {
  const slot = (iso: string, timeZone: string) => {
    const card = punchCard([new Date(iso)], timeZone);
    const day = card.findIndex((row) => row.some(Boolean));
    return [day, card[day]!.indexOf(1)];
  };
  // Sunday 23:30 in UTC is already Monday 02:30 in Istanbul.
  expect(slot("2026-10-04T23:30:00Z", "UTC")).toEqual([0, 23]);
  expect(slot("2026-10-04T23:30:00Z", "Europe/Istanbul")).toEqual([1, 2]);
  expect(slot("2026-10-05T00:00:00Z", "UTC")).toEqual([1, 0]);
  // New York springs forward at 2:00 on 8 March 2026: an hour apart in UTC, two apart on the clock.
  expect(slot("2026-03-08T06:30:00Z", "America/New_York")).toEqual([0, 1]);
  expect(slot("2026-03-08T07:30:00Z", "America/New_York")).toEqual([0, 3]);
  const card = punchCard([new Date("2026-10-05T09:00:00Z"), new Date("2026-10-12T09:59:00Z")], "UTC");
  expect(card).toHaveLength(7);
  expect(card[1]![9]).toBe(2);
  expect(card.flat().reduce((n, count) => n + count, 0)).toBe(2);
});
