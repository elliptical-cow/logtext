import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const styles = readFileSync(join(root, "src/styles.css"), "utf8");

test("offers recently opened sorting in preferences and folder menus", () => {
  const preferences = readFileSync(
    join(root, "src/lib/components/PreferencesDialog.svelte"),
    "utf8",
  );
  const contextMenu = readFileSync(
    join(root, "src/lib/components/NavigationContextMenu.svelte"),
    "utf8",
  );
  assert.match(preferences, /value: "opened-desc", label: "Recently opened"/);
  assert.match(contextMenu, /sort:opened-desc/);
  assert.match(contextMenu, />ecently opened/);
});

test("offers recently modified sorting in preferences and folder menus", () => {
  const preferences = readFileSync(
    join(root, "src/lib/components/PreferencesDialog.svelte"),
    "utf8",
  );
  const contextMenu = readFileSync(
    join(root, "src/lib/components/NavigationContextMenu.svelte"),
    "utf8",
  );

  assert.match(preferences, /value: "modified-desc", label: "Recently modified"/);
  assert.ok(!/modified-asc/.test(preferences));
  assert.match(contextMenu, /sort:modified-desc/);
  assert.ok(!/sort:modified-asc/.test(contextMenu));
  assert.match(contextMenu, /Recently\s+<span class="menu-mnemonic">m<\/span>odified/);
  assert.match(contextMenu, /context-menu-flyout-panel navigation-sort-menu/);
  assert.match(styles, /\.navigation-sort-menu\s*\{[^}]*width: max-content;/s);
  assert.match(styles, /\.navigation-sort-menu button\s*\{[^}]*white-space: nowrap;/s);
});

test("records successful pane opens through the workspace backend", () => {
  const backend = readFileSync(join(root, "src-tauri/src/config_commands.rs"), "utf8");
  const registration = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const editorSession = readFileSync(join(root, "src/lib/stores/editorSession.ts"), "utf8");
  const rightPane = readFileSync(join(root, "src/lib/stores/rightPane.ts"), "utf8");

  assert.match(backend, /pub fn record_page_opened/);
  assert.match(registration, /config_commands::record_page_opened/);
  assert.match(editorSession, /recordPageOpened/);
  assert.match(rightPane, /recordPageOpened/);
});
