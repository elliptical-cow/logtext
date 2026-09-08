import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("wires Clean Media from the File menu to the cleanup dialog", () => {
  const backend = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const coreEvents = readFileSync(join(root, "src/lib/coreEvents.ts"), "utf8");
  const app = readFileSync(join(root, "src/App.svelte"), "utf8");
  const dialog = readFileSync(
    join(root, "src/lib/components/MediaCleanupDialog.svelte"),
    "utf8",
  );

  assert.match(backend, /MENU_CLEAN_MEDIA, "Clean Media\.\.\."/);
  assert.match(backend, /MENU_CLEAN_MEDIA => Some\("menu-clean-media"\)/);
  assert.match(coreEvents, /onCoreEvent\(\s*"menu-clean-media"/);
  assert.match(coreEvents, /editorSessionStore\.save\(\)/);
  assert.match(app, /<MediaCleanupDialog/);
  assert.match(dialog, /class="media-cleanup-list"/);
  assert.match(dialog, />\s*Cancel\s*</);
  assert.match(dialog, /Move to Trash/);
});

test("registers backend commands that move only the displayed candidates", () => {
  const backend = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const api = readFileSync(join(root, "src/lib/api.ts"), "utf8");
  const app = readFileSync(join(root, "src/App.svelte"), "utf8");

  assert.match(backend, /media_cleanup::list_unused_media/);
  assert.match(backend, /media_cleanup::move_unused_media_to_trash/);
  assert.match(api, /invokeTauri<MediaCleanupCandidate\[\]>\("list_unused_media"\)/);
  assert.match(api, /invokeTauri<MediaTrashResult>\("move_unused_media_to_trash"/);
  assert.match(
    app,
    /moveUnusedMediaToTrash\(\s*mediaCleanupCandidates\.map\(\(candidate\) => candidate\.path\)/,
  );
});
