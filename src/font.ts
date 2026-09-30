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
    // opentype.js stamps the head table with the current time, and the two
    // checksums over it follow. Zero all four, so the same text makes the same
    // bytes and a file named by its content keeps its name until the drawing
    // changes; browsers do not reject a font over its checksums.
    const bytes = new Uint8Array(subset.toArrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + i * 16;
      if (String.fromCharCode(...bytes.subarray(record, record + 4)) === "head") {
        const offset = view.getUint32(record + 8);
        bytes.fill(0, record + 4, record + 8); // the head table's checksum
        bytes.fill(0, offset + 8, offset + 12); // checkSumAdjustment
        bytes.fill(0, offset + 20, offset + 36); // created, then modified
      }
    }
    const data = Buffer.from(bytes).toString("base64");
    rules.push(`@font-face{font-family:${FAMILY};font-weight:${weight};src:url(data:font/otf;base64,${data}) format("opentype")}`);
  }
  return rules.join("");
}
