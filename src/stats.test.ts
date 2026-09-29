import { expect, test } from "bun:test";
import type { Day, Profile } from "./github";
import { yearStats } from "./stats";

/** One calendar week starting on the given Sunday. */
function week(sunday: string, counts: (number | null)[]): (Day | null)[] {
  const start = new Date(`${sunday}T00:00:00Z`).getTime();
  return counts.map((count, i) =>
    count === null ? null : { date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), count, level: count ? 2 : 0 },
  );
}

function profile(weeks: (Day | null)[][]): Profile {
  const total = weeks.flat().reduce((sum, day) => sum + (day?.count ?? 0), 0);
  return { login: "x", name: null, bio: null, total, weeks };
}

test("a quiet today does not break the streak, a quiet yesterday does", () => {
  const stats = yearStats(profile([week("2026-09-13", [1, 0, 3, 4, 5, 6, 7]), week("2026-09-20", [2, 2, 0, null, null, null, null])]));
  expect(stats.streak).toBe(7);

  const broken = yearStats(profile([week("2026-09-13", [1, 2, 3, 4, 5, 0, 1])]));
  expect(broken.streak).toBe(1);
});

test("peak is the latest of tied days and the busiest weekday sums every week", () => {
  const stats = yearStats(profile([week("2026-09-06", [0, 9, 1, 0, 0, 0, 0]), week("2026-09-13", [0, 9, 0, 0, 0, 0, 12])]));
  expect(stats.peak?.date).toBe("2026-09-19");
  expect(stats.busiestWeekday).toBe(1); // Mondays: 18 against Saturday's 12
  expect(stats.total).toBe(31);
});

test("an empty year has no peak, no busiest day and no streak", () => {
  const stats = yearStats(profile([week("2026-09-13", [0, 0, 0, 0, 0, 0, 0])]));
  expect(stats).toEqual({ total: 0, peak: null, busiestWeekday: null, streak: 0 });
});
