import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

test("uses theme colors for the selected editor autocomplete entry in dark mode", () => {
  assert.match(
    styles,
    /:root\[data-theme="dark"\] \.code-editor \.cm-tooltip-autocomplete > ul > li\[aria-selected\]\s*\{[^}]*background: var\(--accent-bg-selected\);[^}]*color: var\(--text-primary\);/s,
  );
});
