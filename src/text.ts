/** Terminal cells a string occupies: East Asian wide characters and emoji take two. */
export function columns(text: string): number {
  let n = 0;
  for (const char of text) {
    n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u.test(char) ? 2 : 1;
  }
  return n;
}

/** Word wrap to `width` columns. Lines that fit are balanced, so a title
 *  never leaves one word stranded on its second line; text past `maxLines`
 *  ends in an ellipsis. */
export function wrap(text: string, width: number, maxLines: number): string[] {
  // A word wider than a whole line is cut where the line ends.
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const pieces: string[] = [];
    let piece = "";
    for (const char of word) {
      if (columns(piece + char) > width) {
        pieces.push(piece);
        piece = "";
      }
      piece += char;
    }
    return piece ? [...pieces, piece] : pieces;
  });
  const greedy = (limit: number): string[] => {
    const lines: string[] = [];
    for (const word of words) {
      const line = lines.at(-1);
      if (line !== undefined && columns(`${line} ${word}`) <= limit) lines[lines.length - 1] = `${line} ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  const lines = greedy(width);
  if (lines.length <= maxLines) {
    // The narrowest measure that still needs no extra line.
    let narrow = Math.max(...words.map(columns));
    while (narrow < width && greedy(narrow).length > lines.length) narrow++;
    return greedy(narrow);
  }

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (columns(last) + 1 > width) last = Array.from(last).slice(0, -1).join("");
  kept[maxLines - 1] = `${last.replace(/[\s,.;:–—-]+$/, "")}…`;
  return kept;
}

/** Cuts to `width` columns with an ellipsis. */
export function fit(text: string, width: number): string {
  if (columns(text) <= width) return text;
  let cut = text;
  while (columns(cut) + 1 > width) cut = Array.from(cut).slice(0, -1).join("");
  return `${cut.trimEnd()}…`;
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
