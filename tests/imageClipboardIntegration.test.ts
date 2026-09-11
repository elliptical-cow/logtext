import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("grants only the clipboard operations used by editor menus", () => {
  const capability = JSON.parse(
    readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8"),
  ) as { permissions: string[] };

  assert.equal(capability.permissions.includes("clipboard-manager:allow-write-image"), true);
  assert.equal(capability.permissions.includes("clipboard-manager:allow-read-image"), true);
  assert.equal(capability.permissions.includes("clipboard-manager:allow-read-text"), true);
  assert.equal(capability.permissions.includes("clipboard-manager:allow-write-text"), true);
  assert.equal(capability.permissions.some((permission) => permission.includes("write-html")), false);
  assert.equal(capability.permissions.some((permission) => permission.includes("clear")), false);
});

test("registers one shared image context menu in editor and rendered views", () => {
  const editor = readFileSync(
    join(root, "src/lib/components/CodeMirrorEditor.svelte"),
    "utf8",
  );
  const markdownView = readFileSync(
    join(root, "src/lib/components/MarkdownView.svelte"),
    "utf8",
  );
  const imageMenu = readFileSync(
    join(root, "src/lib/components/ImageContextMenu.svelte"),
    "utf8",
  );

  assert.match(editor, /<ImageContextMenu/);
  assert.match(markdownView, /<ImageContextMenu/);
  assert.match(imageMenu, /Copy image/);
  assert.match(imageMenu, /copyImageElementToClipboard/);
});

test("loads copyable editor images in anonymous CORS mode before assigning their source", () => {
  const livePreview = readFileSync(join(root, "src/lib/editorLivePreview.ts"), "utf8");

  assert.match(
    livePreview,
    /image\.crossOrigin = "anonymous";[\s\S]*?image\.src = this\.source;/,
    "the image must opt into CORS before loading so canvas pixel access remains permitted",
  );
});
