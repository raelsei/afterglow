import type { Day, Profile } from "./github";

export interface YearStats {
  total: number;
  /** Most contributions in one day; the latest such day on a tie. Null for an empty year. */
  peak: Day | null;
  /** 0 = Sunday. Null for an empty year. */
  busiestWeekday: number | null;
  /** Consecutive days with at least one contribution. While the window runs up
   *  to today, the run ending today, and a quiet today does not break it yet;
   *  for a year gone by, its longest run. */
  streak: number;
}

export function yearStats(profile: Profile): YearStats {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);

  let peak: Day | null = null;
  const perWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const day of days) {
    if (day.count > 0 && (!peak || day.count >= peak.count)) peak = day;
    perWeekday[new Date(`${day.date}T00:00:00Z`).getUTCDay()]! += day.count;
  }

  let streak = 0;
  if (profile.live) {
    let i = days.length - 1;
    if (i >= 0 && days[i]!.count === 0) i--;
    for (; i >= 0 && days[i]!.count > 0; i--) streak++;
  } else {
    let run = 0;
    for (const day of days) {
      run = day.count > 0 ? run + 1 : 0;
      streak = Math.max(streak, run);
    }
  }

  const busiest = Math.max(...perWeekday);
  return {
    total: profile.total,
    peak,
    busiestWeekday: busiest > 0 ? perWeekday.indexOf(busiest) : null,
    streak,
  };
}
