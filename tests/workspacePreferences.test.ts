import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspacePreferences } from "../src/lib/types.js";
import {
  normalizeWorkspacePreferences,
  validateWorkspacePreferences,
  workspacePreferencesEqual,
} from "../src/lib/workspacePreferences.js";

const defaults: WorkspacePreferences = {
  journalFolder: "journal",
  mediaFolder: "media",
  journalEditorContinuousScrolling: true,
  journalRightPaneContinuousScrolling: true,
  taskStates: ["TODO", "DONE"],
  taskStateColors: { TODO: "red", DONE: "green" },
  taskDoneSoundEnabled: true,
  defaultPageSort: "name-desc",
  themeMode: "light",
};

test("validates workspace folders and task states before saving preferences", () => {
  assert.deepEqual(validateWorkspacePreferences(defaults), {});
  assert.match(
    validateWorkspacePreferences({ ...defaults, journalFolder: "../daily" }).journalFolder ?? "",
    /workspace-relative/,
  );
  assert.match(
    validateWorkspacePreferences({ ...defaults, journalFolder: "/daily" }).journalFolder ?? "",
    /workspace-relative/,
  );
  assert.match(
    validateWorkspacePreferences({ ...defaults, mediaFolder: "journal/assets" }).mediaFolder ?? "",
    /must not overlap/,
  );
  assert.match(
    validateWorkspacePreferences({ ...defaults, taskStates: ["TODO", "TODO"] }).taskStates ?? "",
    /unique/,
  );
});

test("normalizes task state keys and workspace-relative separators", () => {
  const normalized = normalizeWorkspacePreferences({
    ...defaults,
    journalFolder: " daily\\logs/ ",
    taskStates: [" TODO ", "DONE"],
    taskStateColors: { " TODO ": "yellow", DONE: "green" },
  });

  assert.equal(normalized.journalFolder, "daily/logs");
  assert.deepEqual(normalized.taskStates, ["TODO", "DONE"]);
  assert.equal(normalized.taskStateColors.TODO, "yellow");
});

test("compares normalized preference drafts", () => {
  assert.equal(
    workspacePreferencesEqual(defaults, { ...defaults, journalFolder: " journal/ " }),
    true,
  );
  assert.equal(workspacePreferencesEqual(defaults, { ...defaults, themeMode: "dark" }), false);
});
