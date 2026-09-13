import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import test from "node:test";
import {
  blockFoldingMetadata,
  blockFoldingExtension,
  collapseBlockEffect,
  collapsibleBlockAtLine,
  expandBlockEffect,
  foldableBlockLevelAtLine,
  foldedBlockAtLine,
} from "../src/lib/editorBlockFolding.js";
import { listWrapIndentExtension } from "../src/lib/editorLineWrapping.js";

test("preserves indentation guides while blocks are collapsed and expanded", () => {
  let state = EditorState.create({
    doc: "- Parent\n  - Child\n    - Grandchild\n- Sibling",
    extensions: [blockFoldingExtension, listWrapIndentExtension],
  });

  assert.equal(indentGuideDecorationCount(state), 2);

  state = state.update({ effects: collapseBlockEffect.of(1) }).state;
  assert.equal(foldedBlockAtLine(state, 1), true);
  assert.equal(indentGuideDecorationCount(state), 2);

  state = state.update({ effects: expandBlockEffect.of(1) }).state;
  assert.equal(foldedBlockAtLine(state, 1), false);
  assert.equal(indentGuideDecorationCount(state), 2);
});

test("caches folding metadata until the document changes", () => {
  let state = EditorState.create({
    doc: "- Parent\n  - Child\n- Sibling",
    extensions: [blockFoldingExtension],
  });
  const initialMetadata = blockFoldingMetadata(state);

  state = state.update({ selection: { anchor: state.doc.length } }).state;
  assert.equal(blockFoldingMetadata(state), initialMetadata);
  assert.equal(collapsibleBlockAtLine(state, 1), true);
  assert.equal(foldableBlockLevelAtLine(state, 2), 2);

  state = state.update({
    changes: {
      from: 0,
      to: state.doc.length,
      insert: "- Leaf\n- New parent\n  - New child",
    },
  }).state;

  assert.ok(blockFoldingMetadata(state) !== initialMetadata);
  assert.equal(collapsibleBlockAtLine(state, 1), false);
  assert.equal(collapsibleBlockAtLine(state, 2), true);

  state = state.update({ effects: collapseBlockEffect.of(2) }).state;
  assert.equal(foldedBlockAtLine(state, 2), true);
});

function indentGuideDecorationCount(state: EditorState) {
  let count = 0;
  state.field(listWrapIndentExtension).between(0, state.doc.length, (_from, _to, decoration) => {
    if (String(decoration.spec.class ?? "").includes("cm-list-indent-guides")) {
      count += 1;
    }
  });
  return count;
}
