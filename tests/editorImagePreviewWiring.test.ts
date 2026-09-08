import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const editor = readFileSync(
  join(process.cwd(), "src/lib/components/CodeMirrorEditor.svelte"),
  "utf8",
);

test("keeps the image menu when live preview is reconfigured", () => {
  const configuredWithImageMenu =
    /livePreviewExtension\(\s*taskStates,\s*taskStateColors,\s*pages,\s*folderColors,\s*openImageContextMenu,?\s*\)/g;

  assert.equal(
    [...editor.matchAll(configuredWithImageMenu)].length,
    2,
    "initial setup and reactive reconfiguration must retain the image context menu",
  );
});
