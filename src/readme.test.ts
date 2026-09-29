import { expect, test } from "bun:test";
import { END, START, injectBlock, readmeBlock } from "./readme";

test("only the text between the markers is replaced", () => {
  const readme = `# me\n\nabove\n\n${START}\nstale\n${END}\n\nbelow ${START.length}\n`;
  const block = `${START}\nfresh\n${END}`;
  const once = injectBlock(readme, block);
  expect(once).toBe(`# me\n\nabove\n\n${START}\nfresh\n${END}\n\nbelow ${START.length}\n`);
  expect(injectBlock(once, block)).toBe(once);
});

test("a README without both markers is refused, not rewritten", () => {
  expect(() => injectBlock("# me\n", "x")).toThrow(/afterglow:start/);
  expect(() => injectBlock(`${END}\n${START}\n`, "x")).toThrow();
});

test("rows sit side by side, stacks break per line, and alt text is escaped", () => {
  const block = readmeBlock(
    [
      { layout: "row", images: [{ name: "a", width: 10, alt: "a", href: "https://x.dev/?a=1&b=2" }, { name: "b", width: 10, alt: `"b"` }] },
      { layout: "stack", images: [{ name: "c", width: 10, alt: "c" }, { name: "d", width: 10, alt: "d" }] },
    ],
    "https://raw.example/output/",
  );
  expect(block).toContain(`<a href="https://x.dev/?a=1&#38;b=2">`);
  expect(block).toContain(`srcset="https://raw.example/output/a-dark.svg"`);
  expect(block).toContain(`alt="&#34;b&#34;"`);
  expect(block).toMatch(/a-light\.svg"[^\n]*\n<picture>[^\n]*b-light/);
  expect(block).toMatch(/c-light\.svg"[^\n]*<br>\n<picture>[^\n]*d-light/);
});
