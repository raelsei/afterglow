import { FULL, HALF, RIGHT_MARGIN } from "./pane";
import { flatten, measureStack, place, type Image, type Pane } from "./panes";

export const PANE_IDS = ["year", "whoami", "activity", "posts", "langs", "top"] as const;
export type PaneId = (typeof PANE_IDS)[number];

export const DEFAULT_LAYOUT = "year whoami\nactivity posts\nlangs top\nbar";

export type LayoutRow = { bar: true } | { bar?: false; cells: { id: PaneId; compact: boolean }[] };

/**
 * Reads the `layout` input: one grid row per line, one or two panes each, a
 * `:compact` or `:full` suffix to override `density` for one pane, and `bar`
 * alone on a line for the tmux status line. `|` may separate cells for
 * readability; blank lines and `#` comments are skipped. A pane left out is
 * off.
 */
export function parseLayout(text: string, density: "full" | "compact"): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const seen: Record<string, true> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").replace(/\|/g, " ").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.includes("bar")) {
      if (tokens.length > 1) throw new Error(`layout: "${raw.trim()}": bar takes a line of its own`);
      rows.push({ bar: true });
      continue;
    }
    if (tokens.length > 2) throw new Error(`layout: "${raw.trim()}": at most two panes per row; GitHub's README column holds two`);
    const cells = tokens.map((token) => {
      const [id, mode, ...rest] = token.split(":");
      if (!PANE_IDS.includes(id as PaneId)) throw new Error(`layout: "${id}" is not a pane; choose from ${PANE_IDS.join(", ")}, bar`);
      if (rest.length || (mode !== undefined && mode !== "compact" && mode !== "full")) {
        throw new Error(`layout: "${token}": the only sizes are :compact and :full`);
      }
      if (seen[id!]) throw new Error(`layout: "${id}" appears twice`);
      seen[id!] = true;
      return { id: id as PaneId, compact: mode ? mode === "compact" : density === "compact" };
    });
    rows.push({ cells });
  }
  return rows;
}

export interface PlacedRow {
  /** The pane that floats; the lines flow beside it. */
  float?: Image;
  side?: "left" | "right";
  lines: Image[][];
}

const natural = (pane: Pane) => pane.pieces.reduce((n, item) => n + item.bands, 0);

/**
 * One row of the grid: one pane across both columns, or two side by side at
 * the same height. A list (one image per line, so each line links) can only
 * flow beside a pane that floats, so:
 *
 * - single, single: the left one floats left.
 * - single, list: the single floats left, the list fills the right column.
 * - list, single: the single floats right, the list fills the left column.
 * - list, list: the left list is drawn as one image and floats left.
 *
 * On a narrow screen the float comes first and the lines drop below it.
 */
export function placeRow(panes: Pane[]): PlacedRow {
  if (panes.length === 1) return alone(panes[0]!);
  let [left, right] = panes as [Pane, Pane];
  if (left.kind === "stack" && right.kind === "stack") left = flatten(measureStack(left, HALF));

  const [single, other, side] = left.kind === "single" ? [left, right, "left" as const] : [right, left, "right" as const];
  const list = other.kind === "stack" ? measureStack(other, HALF) : other;
  const bands = Math.max(single.pieces[0]!.bands, natural(list));
  const float = place(single.pieces[0]!, HALF, bands, side === "right" ? RIGHT_MARGIN : 0);
  if (list.kind === "single") return { float, side, lines: [[place(list.pieces[0]!, HALF, bands)]] };
  // The list's last image takes whatever height the single pane needs beyond it.
  const extra = bands - natural(list);
  const last = list.pieces.length - 1;
  return { float, side, lines: list.pieces.map((item, i) => [place(item, HALF, item.bands + (i === last ? extra : 0))]) };
}

function alone(pane: Pane): PlacedRow {
  const sized = pane.kind === "stack" ? measureStack(pane, FULL) : pane;
  return { lines: sized.pieces.map((item) => [place(item, FULL, item.bands)]) };
}
