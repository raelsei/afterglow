import { FULL, HALF, RIGHT_MARGIN } from "./pane";
import { flatten, measureStack, place, type Image, type Pane } from "./panes";

export const PANE_IDS = ["year", "whoami", "activity", "posts", "langs", "top"] as const;
export type PaneId = (typeof PANE_IDS)[number];

export const DEFAULT_LAYOUT = "year whoami\nactivity posts\nlangs top\nbar";

export interface Cell {
  id: PaneId;
  compact: boolean;
}

/** One pane across both columns, or two columns. A column holds one pane, or
 *  several stacked when the other column's one pane spans them. */
export type LayoutRow = { bar: true } | { full: Cell } | { left: Cell[]; right: Cell[] };

/**
 * Reads the `layout` input: one grid row per line, one or two panes each, a
 * `:compact` or `:full` suffix to override `density` for one pane, and `bar`
 * alone on a line for the status line. With `|` between the columns, an empty
 * side extends the pane above it down another row:
 *
 *     year | whoami
 *          | posts
 *
 * Blank lines and `#` comments are skipped. A pane left out is off.
 */
export function parseLayout(text: string, density: "full" | "compact"): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const seen: Record<string, true> = {};
  const cell = (token: string): Cell => {
    const [id, mode, ...rest] = token.split(":");
    if (!PANE_IDS.includes(id as PaneId)) throw new Error(`layout: "${id}" is not a pane; choose from ${PANE_IDS.join(", ")}, bar`);
    if (rest.length || (mode !== undefined && mode !== "compact" && mode !== "full")) {
      throw new Error(`layout: "${token}": the only sizes are :compact and :full`);
    }
    if (seen[id!]) throw new Error(`layout: "${id}" appears twice`);
    seen[id!] = true;
    return { id: id as PaneId, compact: mode ? mode === "compact" : density === "compact" };
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "");
    if (!line.trim()) continue;
    const quote = `layout: "${raw.trim()}"`;

    if (!line.includes("|")) {
      const tokens = line.trim().split(/\s+/);
      if (tokens.includes("bar")) {
        if (tokens.length > 1) throw new Error(`${quote}: bar takes a line of its own`);
        rows.push({ bar: true });
      } else if (tokens.length > 2) throw new Error(`${quote}: at most two panes per row; GitHub's README column holds two`);
      else if (tokens.length === 1) rows.push({ full: cell(tokens[0]!) });
      else rows.push({ left: [cell(tokens[0]!)], right: [cell(tokens[1]!)] });
      continue;
    }

    const sides = line.split("|");
    if (sides.length > 2) throw new Error(`${quote}: two columns at most, so one | per line`);
    const [left, right] = sides.map((side) => side.trim().split(/\s+/).filter(Boolean)) as [string[], string[]];
    if (left.length > 1 || right.length > 1) throw new Error(`${quote}: one pane on each side of the |`);
    if (left.includes("bar") || right.includes("bar")) throw new Error(`${quote}: bar takes a line of its own`);
    if (left.length && right.length) {
      rows.push({ left: [cell(left[0]!)], right: [cell(right[0]!)] });
      continue;
    }
    if (!left.length && !right.length) throw new Error(`${quote}: no pane on either side`);
    // An empty side: the pane above it reaches down beside this one.
    const above = rows.at(-1);
    if (!above || !("left" in above)) throw new Error(`${quote}: an empty side extends the pane above it, and there is none`);
    const grows = left.length ? above.left : above.right;
    const spans = left.length ? above.right : above.left;
    if (spans.length !== 1) throw new Error(`${quote}: only one side of a row can reach down, and the other side already does`);
    grows.push(cell((left.length ? left : right)[0]!));
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
 * Two columns at one height. One pane floats in its column; the other column's
 * panes flow beside it as lines, which is the only way a list (one image per
 * line, so each line links) can sit next to anything on GitHub. So:
 *
 * - a column of several panes flows, and the other column's pane floats and
 *   spans them all, as tall as they are together;
 * - single, single: the left one floats left;
 * - single, list: the single floats left, the list fills the right column;
 * - list, single: the single floats right, the list fills the left column;
 * - a list that has to float (list, list; or a list spanning others) is drawn
 *   as one image, its lines no longer separate links.
 *
 * The flowing column's last pane takes any height the float needs beyond it.
 * On a narrow screen the float comes first and the lines drop below it.
 */
export function placeRow(left: Pane[], right: Pane[]): PlacedRow {
  let side: "left" | "right";
  if (left.length > 1) side = "right";
  else if (right.length > 1) side = "left";
  else side = left[0]!.kind === "single" || right[0]!.kind === "stack" ? "left" : "right";

  let span = (side === "left" ? left : right)[0]!;
  if (span.kind === "stack") span = flatten(measureStack(span, HALF));
  const flow = (side === "left" ? right : left).map((pane) => (pane.kind === "stack" ? measureStack(pane, HALF) : pane));
  const total = flow.reduce((n, pane) => n + natural(pane), 0);
  const bands = Math.max(span.pieces[0]!.bands, total);
  const extra = bands - total;
  const lines = flow.flatMap((pane, k) =>
    pane.pieces.map((item, i) => [place(item, HALF, item.bands + (k === flow.length - 1 && i === pane.pieces.length - 1 ? extra : 0))]),
  );
  return { float: place(span.pieces[0]!, HALF, bands, side === "right" ? RIGHT_MARGIN : 0), side, lines };
}

/** One pane across both columns. */
export function placeFull(pane: Pane): PlacedRow {
  const sized = pane.kind === "stack" ? measureStack(pane, FULL) : pane;
  return { lines: sized.pieces.map((item) => [place(item, FULL, item.bands)]) };
}
