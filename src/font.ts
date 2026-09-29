import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";

/** An SVG loaded through <img> may not fetch anything, so each file carries
 *  its own copy of the face, cut down to the characters it draws. */
export const FAMILY = "afterglow";

const FONT_DIR = fileURLToPath(new URL("../fonts/", import.meta.url));
const faces = new Map<number, opentype.Font>();

function face(weight: 400 | 700): opentype.Font {
  let font = faces.get(weight);
  if (!font) {
    const file = weight === 700 ? "GoogleSansCode-Bold.ttf" : "GoogleSansCode-Regular.ttf";
    const bytes = readFileSync(FONT_DIR + file);
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    faces.set(weight, font);
  }
  return font;
}

/** `@font-face` rules for exactly the characters in `regular` and `bold`.
 *  Characters the face lacks are left to the fallback stack. */
export function fontFaces(regular: string, bold = ""): string {
  const rules: string[] = [];
  for (const [weight, text] of [[400, regular], [700, bold]] as const) {
    if (!text) continue;
    const font = face(weight);
    const glyphs = [font.glyphs.get(0)];
    for (const char of new Set(text)) {
      const glyph = font.charToGlyph(char);
      if (glyph.index !== 0) glyphs.push(glyph);
    }
    const subset = new opentype.Font({
      familyName: FAMILY,
      styleName: weight === 700 ? "Bold" : "Regular",
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascender,
      descender: font.descender,
      glyphs,
    });
    const data = Buffer.from(subset.toArrayBuffer()).toString("base64");
    rules.push(`@font-face{font-family:${FAMILY};font-weight:${weight};src:url(data:font/otf;base64,${data}) format("opentype")}`);
  }
  return rules.join("");
}
