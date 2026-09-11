import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const editor = readFileSync(
  join(process.cwd(), "src/lib/components/CodeMirrorEditor.svelte"),
  "utf8",
);

test("keeps task state selection and the normal left-click link behavior intact", () => {
  assert.match(editor, /on:click=\{\(\) => setTaskStatus\(state\)\}/);
  assert.match(editor, /onOpenWikiLink\(resolved\.path, "editor"\)/);
  assert.equal(/Open in editor/.test(editor), false);
});

test("composes contextual actions with standard editor actions", () => {
  for (const label of ["Undo", "Copy", "Paste"]) {
    assert.match(editor, new RegExp(label.replace(" ", "\\s+"), "i"));
  }
  assert.match(editor, /copyContextSelection\(true\)/);
  assert.match(editor, /on:click=\{selectAllEditorText\}/);
  assert.match(editor, /on:click=\{linkContextSelection\}/);
  assert.match(editor, /on:click=\{openSourceLineInRightPane\}/);
  assert.match(editor, /runContextEditorCommand\(indentSelectedBlocks\)/);
  assert.match(editor, /runContextEditorCommand\(moveCurrentBlock\("up"\)\)/);
});

test("supports keyboard context menus and restores editor focus", () => {
  assert.match(editor, /event\.key !== "ContextMenu"/);
  assert.match(editor, /event\.key === "F10" && event\.shiftKey/);
  assert.match(editor, /onClose=\{closeEditorContextMenuAndFocus\}/);
});
