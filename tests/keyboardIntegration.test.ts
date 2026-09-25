import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const app = source("src/App.svelte");
const palette = source("src/lib/components/CommandPalette.svelte");
const fileTree = source("src/lib/components/FileTree.svelte");
const navigationTree = source("src/lib/components/NavigationTree.svelte");
const quickAccess = source("src/lib/components/QuickAccess.svelte");
const tasks = source("src/lib/components/TaskOverview.svelte");
const workspaceHeader = source("src/lib/components/WorkspaceHeader.svelte");
const datePicker = source("src/lib/components/DatePickerPopover.svelte");
const codeMirrorEditor = source("src/lib/components/CodeMirrorEditor.svelte");

test("wires global commands, pane focus regions, and keyboard resizers", () => {
  assert.match(app, /commandForKeyboardEvent\(event\)/);
  for (const region of ["left", "middle", "right"]) {
    assert.match(app, new RegExp(`use:focusRegion=\\{"${region}"\\}`));
  }
  assert.equal((app.match(/role="separator"/g) ?? []).length, 2);
  assert.equal((app.match(/aria-valuenow=/g) ?? []).length, 2);
  assert.match(app, /event\.key === "Home"/);
});

test("uses accessible combobox and listbox semantics for command surfaces", () => {
  assert.match(palette, /role="combobox"/);
  assert.match(palette, /aria-activedescendant=\{activeId\}/);
  assert.match(palette, /role="listbox"/);
  assert.match(palette, /role="option"/);
  assert.match(palette, /event\.key === "Escape"/);
});

test("keeps the file navigator to one roving tree stop and exposes file commands", () => {
  assert.match(navigationTree, /role="tree"/);
  assert.match(navigationTree, /role="treeitem"/);
  assert.match(navigationTree, /tabindex=\{focusedTreePath === node\.path \? 0 : -1\}/);
  assert.match(fileTree, /event\.key === "F2"/);
  assert.match(fileTree, /event\.key === "Delete"/);
  assert.match(fileTree, /event\.key === "F10" && event\.shiftKey/);
  assert.match(fileTree, /logtext-file-command/);
  assert.match(fileTree, /aria-activedescendant=\{moveFolderSuggestions/);
});

test("uses compact roving stops in quick access, search, and tasks", () => {
  assert.match(quickAccess, /tabindex=\{index === focusedQuickIndex \? 0 : -1\}/);
  assert.match(fileTree, /tabindex=\{index === focusedSearchResultIndex \? 0 : -1\}/);
  assert.match(tasks, /tabindex=\{focusedTaskKey === taskKey\(task\) \? 0 : -1\}/);
  assert.match(tasks, /event\.key\.toLocaleLowerCase\(\) === "e"/);
});

test("renders the journal picker as a one-stop keyboard grid", () => {
  assert.match(workspaceHeader, /<DatePickerPopover/);
  assert.match(datePicker, /role="grid"/);
  assert.match(datePicker, /role="gridcell"/);
  assert.match(datePicker, /tabindex=\{day\.dateInput === focusedDateInput \? 0 : -1\}/);
  assert.match(datePicker, /calendarDateForKey\(current, event\.key\)/);
});

test("routes the current editor line to the right pane through the shared command", () => {
  assert.match(app, /case "editor\.openLineInRightPane"/);
  assert.match(app, /logtext-open-editor-line-in-right-pane/);
  assert.match(app, /event\.target\.closest\("\.cm-editor"\)/);
  assert.match(codeMirrorEditor, /view\.state\.doc\.lineAt\(view\.state\.selection\.main\.head\)\.number/);
  assert.match(codeMirrorEditor, /onOpenSourceLineInRightPane\(line\)/);
  assert.match(codeMirrorEditor, /addEventListener\([\s\S]*?logtext-open-editor-line-in-right-pane/);
});
