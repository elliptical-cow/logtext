import assert from "node:assert/strict";
import test from "node:test";

import {
  recordPageOpen,
  remapPageOpenHistoryFolder,
  remapPageOpenHistoryPath,
  removePageOpenHistory,
} from "../src/lib/pageOpenHistory.js";

test("records, removes, and remaps page open timestamps", () => {
  const recorded = recordPageOpen({}, "projects/alpha.md", 100);
  assert.deepEqual(recorded, { "projects/alpha.md": 100 });

  const moved = remapPageOpenHistoryPath(recorded, "projects/alpha.md", "archive/alpha.md");
  assert.deepEqual(moved, { "archive/alpha.md": 100 });

  const renamedFolder = remapPageOpenHistoryFolder(
    { ...moved, "archive/team/beta.md": 200, "notes.md": 300 },
    "archive",
    "history",
  );
  assert.deepEqual(renamedFolder, {
    "history/alpha.md": 100,
    "history/team/beta.md": 200,
    "notes.md": 300,
  });

  assert.deepEqual(removePageOpenHistory(renamedFolder, ["history/alpha.md"]), {
    "history/team/beta.md": 200,
    "notes.md": 300,
  });
});

test("keeps the newest timestamp when paths are merged", () => {
  assert.deepEqual(
    remapPageOpenHistoryPath(
      { "old.md": 100, "new.md": 200 },
      "old.md",
      "new.md",
    ),
    { "new.md": 200 },
  );
});

test("moves folder history to the workspace root without a leading slash", () => {
  assert.deepEqual(
    remapPageOpenHistoryFolder({ "projects/alpha.md": 100 }, "projects", ""),
    { "alpha.md": 100 },
  );
});
