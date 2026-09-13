import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("wires the native Preferences menu to the workspace dialog", () => {
  const backend = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const events = readFileSync(join(root, "src/lib/coreEvents.ts"), "utf8");
  const app = readFileSync(join(root, "src/App.svelte"), "utf8");
  const dialog = readFileSync(
    join(root, "src/lib/components/PreferencesDialog.svelte"),
    "utf8",
  );

  assert.match(backend, /MENU_PREFERENCES, "Preferences\.\.\."/);
  assert.match(backend, /\.accelerator\("CmdOrCtrl\+,"\)/);
  assert.match(backend, /\.enabled\(false\)/);
  assert.match(backend, /MENU_PREFERENCES => Some\("menu-preferences"\)/);
  assert.match(events, /onCoreEvent\("menu-preferences"/);
  assert.match(events, /updatePreferencesMenuEnabled\(enabled\)/);
  assert.match(app, /<PreferencesDialog/);
  assert.match(dialog, /Save Preferences/);
  assert.match(dialog, /Completed state/);
});

test("saves user preferences through one typed backend command", () => {
  const backend = readFileSync(join(root, "src-tauri/src/config_commands.rs"), "utf8");
  const api = readFileSync(join(root, "src/lib/api.ts"), "utf8");
  const store = readFileSync(join(root, "src/lib/stores/workspace.ts"), "utf8");

  assert.match(backend, /pub fn save_workspace_preferences/);
  assert.match(backend, /validate_removed_task_states/);
  assert.match(backend, /validate_journal_folder_contents/);
  assert.match(api, /invokeTauri<WorkspaceState>\("save_workspace_preferences"/);
  assert.match(store, /async savePreferences\(preferences: WorkspacePreferences\)/);
});
