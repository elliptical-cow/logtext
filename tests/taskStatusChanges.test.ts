import assert from "node:assert/strict";
import test from "node:test";

import {
  changeTaskStatusInContent,
  restoreTaskStatusInContent,
  statusChangedAtTimestamp,
} from "../src/lib/taskStatusChanges.js";

const states = ["TODO", "INPROGRESS", "WAITING", "DONE"];
const changedAt = "2026-09-16T12:32:18Z";

test("adds status-changed-at as the first direct child of a list task", () => {
  const source = "- TODO Parent\r\n  - Existing child\r\n- TODO Sibling\r\n";
  const result = changeTaskStatusInContent(source, 1, "TODO", "DONE", states, changedAt);

  assert.equal(result.changed, true);
  assert.equal(
    result.content,
    "- DONE Parent\r\n  - status-changed-at:: 2026-09-16T12:32:18Z\r\n  - Existing child\r\n- TODO Sibling\r\n",
  );
});

test("updates an existing direct status attribute and preserves arbitrary attributes", () => {
  const source = [
    "- INPROGRESS Parent",
    "  - owner:: Jens",
    "  - status-changed-at:: 2026-09-15T09:00:00Z",
    "  - Child",
    "    - status-changed-at:: nested-value",
  ].join("\n");
  const result = changeTaskStatusInContent(
    source,
    1,
    "INPROGRESS",
    "WAITING",
    states,
    changedAt,
  );

  assert.equal(
    result.content,
    [
      "- WAITING Parent",
      "  - owner:: Jens",
      "  - status-changed-at:: 2026-09-16T12:32:18Z",
      "  - Child",
      "    - status-changed-at:: nested-value",
    ].join("\n"),
  );
});

test("supports plain task blocks and ignores no-op transitions", () => {
  assert.equal(
    changeTaskStatusInContent("TODO Plain", 1, "TODO", "DONE", states, changedAt).content,
    "DONE Plain\n  - status-changed-at:: 2026-09-16T12:32:18Z",
  );
  assert.equal(
    changeTaskStatusInContent("- TODO Same", 1, "TODO", "TODO", states, changedAt).changed,
    false,
  );
});

test("keeps task continuation lines before the inserted status attribute", () => {
  const source = [
    "- TODO Decision",
    "  Supporting context",
    "",
    "  - Existing child",
    "- TODO Sibling",
  ].join("\n");

  const result = changeTaskStatusInContent(source, 1, "TODO", "DONE", states, changedAt);

  assert.equal(
    result.content,
    [
      "- DONE Decision",
      "  Supporting context",
      "",
      "  - status-changed-at:: 2026-09-16T12:32:18Z",
      "  - Existing child",
      "- TODO Sibling",
    ].join("\n"),
  );
});

test("restores the previous status attribute source or removes an inserted line", () => {
  const changed = changeTaskStatusInContent("- TODO Item", 1, "TODO", "DONE", states, changedAt);
  const restored = restoreTaskStatusInContent(
    changed.content,
    1,
    "DONE",
    "TODO",
    states,
    changed.previousStatusChangedAtSource,
  );
  assert.equal(restored.content, "- TODO Item");

  const existing = changeTaskStatusInContent(
    "- TODO Item\n  - STATUS-CHANGED-AT:: old value",
    1,
    "TODO",
    "DONE",
    states,
    changedAt,
  );
  const restoredExisting = restoreTaskStatusInContent(
    existing.content,
    1,
    "DONE",
    "TODO",
    states,
    existing.previousStatusChangedAtSource,
  );
  assert.equal(restoredExisting.content, "- TODO Item\n  - STATUS-CHANGED-AT:: old value");
});

test("formats generated timestamps as second-precision UTC", () => {
  assert.equal(
    statusChangedAtTimestamp(new Date("2026-09-16T12:32:18.456Z")),
    "2026-09-16T12:32:18Z",
  );
});
