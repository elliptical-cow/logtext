import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const editor = readFileSync(
  join(process.cwd(), "src/lib/components/CodeMirrorEditor.svelte"),
  "utf8",
);

test("keeps the active document path when live preview is reconfigured", () => {
  const configuredWithSourcePath =
    /livePreviewExtension\(\s*taskStates,\s*taskStateColors,\s*pages,\s*folderColors,\s*documentPath \?\? "",?\s*\)/g;

  assert.equal(
    [...editor.matchAll(configuredWithSourcePath)].length,
    2,
    "initial setup and reactive reconfiguration must resolve images from the active page",
  );
});
