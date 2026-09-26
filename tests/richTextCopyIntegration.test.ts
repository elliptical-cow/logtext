import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const app = source("src/App.svelte");
const commands = source("src/lib/appCommands.ts");
const coreEvents = source("src/lib/coreEvents.ts");
const editor = source("src/lib/components/CodeMirrorEditor.svelte");
const markdownView = source("src/lib/components/MarkdownView.svelte");
const backend = source("src-tauri/src/lib.rs");
const capability = JSON.parse(source("src-tauri/capabilities/default.json"));

test("offers formatted copy in the native Edit menu and shared command registry", () => {
  assert.match(backend, /MENU_COPY_FORMATTED, "Copy as Formatted Text"/);
  assert.match(backend, /MENU_COPY_FORMATTED => Some\("menu-copy-formatted"\)/);
  assert.match(coreEvents, /\["menu-copy-formatted", "editor\.copyFormatted"\]/);
  assert.match(commands, /id: "editor\.copyFormatted"/);
  assert.match(commands, /requiresEditorSelection: true/);
  assert.match(app, /case "editor\.copyFormatted"/);
  assert.match(app, /logtext-editor-copy-formatted/);
});

test("enables formatted copy only while the Markdown editor has a selection", () => {
  assert.match(backend, /update_formatted_copy_menu_enabled/);
  assert.match(coreEvents, /logtext-editor-selection-availability/);
  assert.match(coreEvents, /updateFormattedCopyMenuEnabled\(enabled\)/);
  assert.match(editor, /!view\.state\.selection\.main\.empty/);
  assert.match(editor, /emitEditorSelectionAvailability\(false\)/);
  assert.match(editor, /selected === lastSelectionAvailability/);
  assert.match(editor, /lastSelectionAvailability = selected/);
  assert.match(app, /!command\.requiresEditorSelection \|\| editorSelectionAvailable/);
});

test("writes HTML and Markdown fallback through the cross-platform Tauri clipboard", () => {
  assert.equal(
    capability.permissions.includes("clipboard-manager:allow-write-html"),
    true,
  );
  assert.match(editor, /writeHtml\(payload\.html, payload\.text\)/);
  assert.doesNotMatch(editor, /navigator\.clipboard/);
  assert.doesNotMatch(editor, /target_os|process\.platform|navigator\.platform/);
});

test("copies rendered selections with portable HTML instead of preview-only CSS", () => {
  assert.match(markdownView, /on:copy=\{handleCopy\}/);
  assert.match(markdownView, /range\.cloneContents\(\)/);
  assert.match(markdownView, /richTextClipboardPayloadFromHtml/);
  assert.match(markdownView, /setData\("text\/html", payload\.html\)/);
  assert.match(markdownView, /setData\("text\/plain", payload\.text\)/);
});
