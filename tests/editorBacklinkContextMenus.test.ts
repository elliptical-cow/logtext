import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const editorPane = readFileSync(
  join(process.cwd(), "src/lib/components/EditorPane.svelte"),
  "utf8",
);

test("editor backlinks expose the shared task and copy context menus", () => {
  const linkedReferences = editorPane.match(/<LinkedReferences[\s\S]*?\/>/)?.[0] ?? "";

  assert.match(linkedReferences, /enableTaskContextMenu/);
  assert.match(linkedReferences, /enableTextCopyContextMenu/);
  assert.match(linkedReferences, /onCheckboxToggle=\{toggleBacklinkCheckbox\}/);
  assert.match(linkedReferences, /onTaskStatusChange=\{changeBacklinkTaskStatus\}/);
  assert.match(linkedReferences, /onTaskPriorityChange=\{changeBacklinkTaskPriority\}/);
  assert.match(linkedReferences, /sourceLineMenuTargets=\{\["right"\]\}/);
});

test("editor backlinks refresh after a successful shared mutation", () => {
  assert.match(
    editorPane,
    /if \(result\.status === "changed"\) \{\s*await loadEditorPageView\(\$editorSessionStore\.path\);/,
  );
  assert.match(editorPane, /message=\{\$editorSessionStore\.error \?\? mutationError \?\? pageViewError\}/);
});

test("editor backlink refreshes keep the existing view mounted", () => {
  assert.match(
    editorPane,
    /pageViewLoading = !pageView \|\| pageView\.page\.path !== path;/,
  );
});
