import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import MarkdownIt from "markdown-it";

const root = process.cwd();

test("renders continuation lines as visible breaks in the right pane", () => {
  const markdownView = readFileSync(
    join(root, "src/lib/components/MarkdownView.svelte"),
    "utf8",
  );

  assert.match(markdownView, /breaks: true/);
  assert.match(
    new MarkdownIt({ breaks: true }).render("- First line\n  Continuation"),
    /First line<br>\nContinuation/,
  );
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
