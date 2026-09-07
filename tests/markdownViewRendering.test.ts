import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createMarkdownRenderer } from "../src/lib/markdownRenderer.js";

const root = process.cwd();

test("renders continuation lines as visible breaks in the right pane", () => {
  const markdownView = readFileSync(
    join(root, "src/lib/components/MarkdownView.svelte"),
    "utf8",
  );

  assert.match(markdownView, /breaks: true/);
  assert.match(
    createMarkdownRenderer({ breaks: true }).render("- First line\n  Continuation"),
    /First line<br>\nContinuation/,
  );
});

test("renders inline and block LaTeX formulas with KaTeX", () => {
  const markdown = createMarkdownRenderer({ breaks: true });
  const inline = markdown.render(String.raw`Energy is $E = mc^2$.`);
  const block = markdown.render(String.raw`$$
\int_0^1 x^2 \, dx
$$`);

  assert.match(inline, /<span class="katex">/);
  assert.match(inline, /Energy is/);
  assert.match(block, /class=['"]katex-block['"]/);
  assert.match(block, /class="katex-display"/);
});

test("keeps rendering after malformed LaTeX and ignores formulas in Markdown code", () => {
  const markdown = createMarkdownRenderer({ breaks: true });
  const malformed = markdown.render(String.raw`Before $\notacommand{$ after **still here**.`);
  const code = markdown.render(
    ["Inline code: `$E = mc^2$`", "", "```text", "$$x^2$$", "```"].join("\n"),
  );

  assert.match(malformed, /class="katex-error"/);
  assert.match(malformed, /<strong>still here<\/strong>/);
  assert.equal(/class="katex"/.test(code), false);
  assert.match(code, /<code>\$E = mc\^2\$<\/code>/);
  assert.match(code, /\$\$x\^2\$\$/);
});

test("scales rendered Markdown headings with the application font size", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  for (const [heading, fontSize] of [
    ["h1", "1.714em"],
    ["h2", "1.286em"],
    ["h3", "1.071em"],
  ]) {
    assert.match(
      styles,
      new RegExp(`\\.markdown-view ${heading}\\s*\\{[^}]*font-size: ${fontSize};`, "s"),
    );
  }
});

test("keeps rendered formulas readable in light and dark themes", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(styles, /\.markdown-view \.katex,[\s\S]*?color: inherit;/);
  assert.match(
    styles,
    /\.markdown-view \.katex \.katex-mathml,[\s\S]*?clip-path: inset\(50%\);/,
  );
  assert.match(
    styles,
    /:root\[data-theme="dark"\] \.markdown-view \.katex-error,[\s\S]*?color: #ffb4b4 !important;/,
  );
});
