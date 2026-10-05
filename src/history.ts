import { existsSync, readFileSync } from "node:fs";

/** One UTC day's figures. Kept in `history.json`, which is published with the
 *  images, so that the next run can tell what changed. */
export interface Snapshot {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  stars: number;
  followers: number;
  /** Contributions in the calendar's window. */
  total: number;
}

export type Metric = "stars" | "followers" | "total";

/** A year and a bit: enough for every comparison drawn, small enough to fetch each run. */
const KEEP = 400;

/** Days since 1970 of a `YYYY-MM-DD` date. */
export function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Adds today's snapshot: a rerun on the same day replaces that day's, and the oldest fall off past KEEP. */
export function record(history: Snapshot[], today: Snapshot): Snapshot[] {
  return [...history.filter((entry) => entry.date !== today.date), today].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP);
}

/** How far `metric` moved since the newest entry at least `days` older than the newest; null when there is none. */
export function change(history: Snapshot[], metric: Metric, days: number): number | null {
  const newest = history.at(-1);
  if (!newest) return null;
  const before = dayNumber(newest.date) - days;
  const old = history.findLast((entry) => dayNumber(entry.date) <= before);
  return old ? newest[metric] - old[metric] : null;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    Number.isFinite(dayNumber(entry.date)) &&
    Number.isFinite(entry.stars) &&
    Number.isFinite(entry.followers) &&
    Number.isFinite(entry.total)
  );
}

/** The file's well-formed entries, sorted; null when it is not a JSON list at all. It comes over the network, so nothing about it is assumed. */
export function parseHistory(text: string): Snapshot[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return data
    .filter(isSnapshot)
    .map(({ date, stars, followers, total }) => ({ date, stars, followers, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The previous run's history: `path` when a local run left one there, else the
 * published copy beside the images. No file at all is a first run; one that
 * cannot be read starts the history over, with a warning.
 */
export async function loadHistory(path: string, baseUrl: string): Promise<Snapshot[]> {
  let source = path;
  let text: string | null = null;
  if (existsSync(path)) text = readFileSync(path, "utf8");
  else if (/^https?:\/\//.test(baseUrl)) {
    source = `${baseUrl.replace(/\/+$/, "")}/history.json`;
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.status === 404) return [];
    if (res?.ok) text = await res.text().catch(() => null);
  } else return [];
  const history = text === null ? null : parseHistory(text);
  if (!history) console.warn(`afterglow: could not read ${source}; the history starts over today`);
  return history ?? [];
}
