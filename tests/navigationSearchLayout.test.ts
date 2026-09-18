import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("shows one ranked result list while searching", () => {
  const navigationTree = readFileSync(
    join(root, "src/lib/components/NavigationTree.svelte"),
    "utf8",
  );
  const fileTree = readFileSync(join(root, "src/lib/components/FileTree.svelte"), "utf8");
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.equal(/Results by Filename/.test(navigationTree), false);
  assert.match(fileTree, /\{#if !searchQuery\.trim\(\)\}\s*<NavigationTree/);
  assert.match(fileTree, /<span>Ranked Results<\/span>/);
  assert.equal(/Results by Content/.test(fileTree), false);
  assert.match(
    styles,
    /\.content-search-results\s*\{[^}]*flex: 1;[^}]*align-content: start;/s,
  );
});

test("offers a direct right-pane action for every ranked result", () => {
  const fileTree = readFileSync(join(root, "src/lib/components/FileTree.svelte"), "utf8");
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(fileTree, /class="search-result-row"/);
  assert.match(fileTree, /class="icon-button right-pane-action search-result-right-action"/);
  assert.match(fileTree, /on:click=\{\(\) => openSearchResultInRightPane\(result\)\}/);
  assert.match(fileTree, /rightPaneStore\.open\(result\.path, \{ line: result\.line \}\)/);
  assert.match(
    styles,
    /\.search-result-row:hover \.search-result-right-action,[\s\S]*?opacity: 1;/,
  );
});
