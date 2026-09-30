import { FULL, HALF } from "./pane";
import { measureStack, place, type Image, type Pane } from "./panes";

export interface PlacedRow {
  float?: Image;
  lines: Image[][];
}

const natural = (pane: Pane) => pane.pieces.reduce((n, item) => n + item.bands, 0);

/**
 * Pairs panes into rows of two equal-height columns, so no row leaves half the
 * page empty. A stack (one image per line, so each line links) needs a single
 * pane beside it, and gets one while there are enough to go round. A pane left
 * over takes the full width.
 */
export function arrange(panes: Pane[]): PlacedRow[] {
  const queue = [...panes];
  const rows: PlacedRow[] = [];
  while (queue.length > 0) {
    const first = queue.shift()!;
    const stacks = queue.filter((pane) => pane.kind === "stack").length;
    const singles = queue.filter((pane) => pane.kind === "single").length;
    let index: number;
    if (first.kind === "stack") index = queue.findIndex((pane) => pane.kind === "single");
    else if (stacks > 0 && stacks >= singles) index = queue.findIndex((pane) => pane.kind === "stack");
    else index = queue.length > 0 ? 0 : -1;

    if (index < 0) {
      rows.push(alone(first));
      continue;
    }
    const second = queue.splice(index, 1)[0]!;
    rows.push(first.kind === "single" ? pair(first, second) : pair(second, first));
  }
  return rows;
}

function pair(single: Pane, other: Pane): PlacedRow {
  const right = other.kind === "stack" ? measureStack(other, HALF) : other;
  const bands = Math.max(single.pieces[0]!.bands, natural(right));
  const float = place(single.pieces[0]!, HALF, bands);
  if (right.kind === "single") return { float, lines: [[place(right.pieces[0]!, HALF, bands)]] };
  // The stack's last image takes whatever height the single pane needs beyond it.
  const extra = bands - natural(right);
  const last = right.pieces.length - 1;
  return { float, lines: right.pieces.map((item, i) => [place(item, HALF, item.bands + (i === last ? extra : 0))]) };
}

function alone(pane: Pane): PlacedRow {
  const sized = pane.kind === "stack" ? measureStack(pane, FULL) : pane;
  return { lines: sized.pieces.map((item) => [place(item, FULL, item.bands)]) };
}
