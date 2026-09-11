import assert from "node:assert/strict";
import test from "node:test";
import {
  editorContextMenuKind,
  editorContextMenuSelection,
} from "../src/lib/editorContextMenu.js";

test("prioritizes a clicked link over text selection and tasks", () => {
  assert.equal(editorContextMenuKind(4, { from: 0, to: 8 }, true, true), "link");
});

test("uses selection actions for every non-empty selection that was clicked", () => {
  assert.equal(editorContextMenuKind(4, { from: 2, to: 7 }, false, true), "selection");
  assert.equal(editorContextMenuKind(7, { from: 2, to: 7 }, false, false), "text");
  assert.equal(editorContextMenuKind(8, { from: 2, to: 7 }, false, false), "text");
  assert.equal(editorContextMenuKind(2, { from: 2, to: 3 }, false, false), "selection");
  assert.deepEqual(editorContextMenuSelection(2, { from: 2, to: 3 }), { from: 2, to: 3 });
  assert.equal(editorContextMenuSelection(3, { from: 2, to: 3 }), null);
});

test("keeps task and ordinary text menus distinct", () => {
  assert.equal(editorContextMenuKind(4, { from: 4, to: 4 }, false, true), "task");
  assert.equal(editorContextMenuKind(4, { from: 4, to: 4 }, false, false), "text");
});
