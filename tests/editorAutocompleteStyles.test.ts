import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

test("uses dark theme colors for the editor autocomplete dropdown", () => {
  assert.match(
    styles,
    /:root\[data-theme="dark"\] \.code-editor \.cm-tooltip\.cm-tooltip-autocomplete\s*\{[^}]*border: 1px solid var\(--border-control\);[^}]*background: var\(--surface-elevated\);[^}]*color: var\(--text-primary\);/s,
  );
});

test("matches the selected autocomplete entry to the focused file selection", () => {
  assert.match(
    styles,
    /\.code-editor \.cm-tooltip-autocomplete > ul > li\[aria-selected\]\s*\{[^}]*background: var\(--navigator-selected-active-bg\);[^}]*color: var\(--text-primary\);[^}]*outline: 1px solid var\(--navigator-focus-outline\);[^}]*box-shadow: 0 0 0 2px var\(--navigator-focus-shadow\);/s,
  );
});

test("renders slash commands as compact text-only entries", () => {
  assert.match(
    styles,
    /\.code-editor \.cm-slash-command \.cm-completionIcon\s*\{[^}]*display: none;/s,
  );
  assert.match(
    styles,
    /\.code-editor \.cm-slash-command \.cm-completionLabel\s*\{[^}]*font-weight: 600;/s,
  );
  assert.match(
    styles,
    /\.code-editor \.cm-slash-command \.cm-completionDetail\s*\{[^}]*color: var\(--text-muted\);[^}]*font-size: 12px;[^}]*font-style: normal;/s,
  );
});
