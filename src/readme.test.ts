import { expect, test } from "bun:test";
import { END, START, injectBlock, readmeBlock } from "./readme";

test("only the text between the markers is replaced", () => {
  const readme = `# me\n\nabove\n\n${START}\nstale\n${END}\n\nbelow\n`;
  const block = `${START}\nfresh\n${END}`;
  const once = injectBlock(readme, block);
  expect(once).toBe(`# me\n\nabove\n\n${START}\nfresh\n${END}\n\nbelow\n`);
  expect(injectBlock(once, block)).toBe(once);
});

test("a README without both markers is refused, not rewritten", () => {
  expect(() => injectBlock("# me\n", "x")).toThrow(/afterglow:start/);
  expect(() => injectBlock(`${END}\n${START}\n`, "x")).toThrow();
});

test("a row floats its left pane, stacks its right column line by line, then clears", () => {
  const block = readmeBlock(
    [
      {
        float: { name: "a", width: 400, alt: "a", href: "https://x.dev/?a=1&b=2" },
        lines: [[{ name: "b", width: 400, alt: `"b"` }], [{ name: "c", width: 400, alt: "c" }]],
      },
      { lines: [[{ name: "d", width: 90, alt: "d" }, { name: "e", width: 90, alt: "e" }]] },
    ],
    "https://raw.example/output/",
  );
  expect(block).toContain(`<a href="https://x.dev/?a=1&#38;b=2">`);
  expect(block).toContain(`srcset="https://raw.example/output/a-dark.svg"`);
  expect(block).toContain(`alt="&#34;b&#34;"`);
  expect(block).toMatch(/a-light\.svg"[^>]*align="left"/);
  expect(block).toMatch(/b-light\.svg"[^>]*align="top"><\/picture><br>\n<picture>[^\n]*c-light/);
  // Chips on one line sit flush: no whitespace between them.
  expect(block).toMatch(/d-light\.svg"[^>]*><\/picture><picture>[^\n]*e-light/);
  expect(block.match(/<br clear="all">/g)).toHaveLength(2);
});
