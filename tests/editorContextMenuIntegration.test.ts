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
  assert.match(editor, /Open link in <span class="menu-mnemonic">r<\/span>ight pane/);
});

test("composes contextual actions with standard editor actions", () => {
  for (const label of ["Copy", "Paste"]) {
    assert.match(editor, new RegExp(label.replace(" ", "\\s+"), "i"));
  }
  assert.equal(/undoFromContextMenu|redoFromContextMenu/.test(editor), false);
  assert.match(editor, /copyContextSelection\(true\)/);
  assert.match(editor, /on:click=\{selectAllEditorText\}/);
  assert.match(
    editor,
    /<span><span class="menu-mnemonic">F<\/span>ormat<\/span>[\s\S]*?on:click=\{linkContextSelection\}/,
  );
  assert.match(editor, /on:click=\{openSourceLineInRightPane\}/);
  assert.match(editor, /Show line in <span class="menu-mnemonic">r<\/span>ight pane/);
  assert.match(editor, /runContextEditorCommand\(indentSelectedBlocks\)/);
  assert.match(editor, /runContextEditorCommand\(moveCurrentBlock\("up"\)\)/);
});

test("keeps editor task keyword menus limited to task and line actions", () => {
  assert.match(editor, /editorContextMenu\.kind !== "task"/);
  assert.match(
    editor,
    /blockIsList && editorContextMenu\.kind !== "link" && editorContextMenu\.kind !== "task"/,
  );
  assert.match(editor, /on:click=\{\(\) => setTaskStatus\(state\)\}/);
  assert.match(editor, /on:click=\{\(\) => setTaskPriority\(priority\)\}/);
  assert.match(editor, /on:click=\{openSourceLineInRightPane\}/);
});

test("shows subtle Windows shortcut hints only for equivalent editor actions", () => {
  for (const shortcut of ["Tab", "Shift+Tab", "Ctrl+↑", "Ctrl+↓", "Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+A"]) {
    const shortcutMarkup = `>${shortcut}<`;
    const shortcutPosition = editor.indexOf(shortcutMarkup);
    const buttonStart = editor.lastIndexOf("<button", shortcutPosition);
    const buttonEnd = editor.indexOf("</button>", shortcutPosition);

    assert.ok(shortcutPosition >= 0, `missing ${shortcut} shortcut hint`);
    assert.match(editor.slice(buttonStart, buttonEnd), /class="context-menu-action"/);
  }
  assert.equal(/Cmd\/Ctrl/.test(editor), false);
  assert.match(
    editor,
    /<button\s+type="button"\s+role="menuitem"\s+data-menu-key="r"\s+on:click=\{openSourceLineInRightPane\}/,
  );
});

test("supports keyboard context menus and restores editor focus", () => {
  assert.match(editor, /event\.key !== "ContextMenu"/);
  assert.match(editor, /event\.key === "F10" && event\.shiftKey/);
  assert.match(editor, /onClose=\{closeEditorContextMenuAndFocus\}/);
});
