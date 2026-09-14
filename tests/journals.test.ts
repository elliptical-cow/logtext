import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  expandJournalFeedWindow,
  initialJournalFeedWindow,
  isJournalPagePath,
  journalPath,
  journalPathForDateInput,
  journalPathForDay,
  orderedJournalPaths,
  shouldUseContinuousJournalView,
} from "../src/lib/journals.js";

const date = new Date(2026, 7, 9);

test("builds journal paths from local dates", () => {
  assert.equal(journalPath(date), "journal/2026-08-09.md");
  assert.equal(journalPath(date, "daily/logs"), "daily/logs/2026-08-09.md");
});

test("builds adjacent journal paths", () => {
  assert.equal(journalPathForDay("yesterday", date), "journal/2026-08-08.md");
  assert.equal(journalPathForDay("today", date), "journal/2026-08-09.md");
  assert.equal(journalPathForDay("tomorrow", date), "journal/2026-08-10.md");
});

test("builds journal paths from date picker input", () => {
  assert.equal(journalPathForDateInput("2026-08-09"), "journal/2026-08-09.md");
  assert.equal(journalPathForDateInput("2026-02-30"), null);
  assert.equal(journalPathForDateInput("08/09/2026"), null);
});

test("recognizes only valid date files directly inside the journal folder", () => {
  assert.equal(isJournalPagePath("daily/2026-02-28.md", "daily"), true);
  assert.equal(isJournalPagePath("daily/2026-02-30.md", "daily"), false);
  assert.equal(isJournalPagePath("daily/notes.md", "daily"), false);
  assert.equal(isJournalPagePath("daily/archive/2026-02-28.md", "daily"), false);
});

test("enables the continuous journal view only for configured journal pages", () => {
  assert.equal(shouldUseContinuousJournalView("daily/2026-08-09.md", "daily", true), true);
  assert.equal(shouldUseContinuousJournalView("daily/2026-08-09.md", "daily", false), false);
  assert.equal(shouldUseContinuousJournalView("notes.md", "daily", true), false);
  assert.equal(shouldUseContinuousJournalView(null, "daily", true), false);
});

test("orders and expands the progressively loaded journal feed", () => {
  const pages = [
    "daily/2026-08-10.md",
    "daily/notes.md",
    "daily/2026-08-08.md",
    "daily/2026-08-09.md",
  ];

  assert.deepEqual(orderedJournalPaths(pages, "daily", "asc"), [
    "daily/2026-08-08.md",
    "daily/2026-08-09.md",
    "daily/2026-08-10.md",
  ]);
  assert.deepEqual(orderedJournalPaths(pages, "daily", "desc"), [
    "daily/2026-08-10.md",
    "daily/2026-08-09.md",
    "daily/2026-08-08.md",
  ]);
  const initial = initialJournalFeedWindow(5, 12, 2);
  assert.deepEqual(initial, { start: 3, end: 7 });
  assert.deepEqual(expandJournalFeedWindow(initial, 12, "before", 2), {
    start: 1,
    end: 7,
  });
  assert.deepEqual(expandJournalFeedWindow(initial, 12, "after", 3), {
    start: 3,
    end: 10,
  });
});

test("keeps journal boundary navigation out of the editor", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/components/EditorPane.svelte"),
    "utf8",
  );
  assert.equal(/handleJournalWheel|handleJournalPageKey/.test(source), false);
  assert.equal(/journalScrollNavigation|journalEditorContinuousScrolling/.test(source), false);
});

test("uses a progressively loaded multi-file journal feed in the right pane", () => {
  const rightPane = readFileSync(
    join(process.cwd(), "src/lib/components/RightPane.svelte"),
    "utf8",
  );
  const feed = readFileSync(
    join(process.cwd(), "src/lib/components/JournalFeed.svelte"),
    "utf8",
  );

  assert.match(rightPane, /<JournalFeed/);
  assert.match(rightPane, /shouldUseContinuousJournalView\(/);
  assert.match(rightPane, /\$workspaceStore\.journalRightPaneContinuousScrolling/);
  assert.match(feed, /loadBefore\(\)/);
  assert.match(feed, /loadAfter\(\)/);
  assert.match(feed, /scrollContainer\.scrollTop \+=/);
  assert.match(feed, /onActivePathChange\(nextActive\)/);
  assert.match(feed, /pageContentUpdateStore/);
  assert.match(feed, /refreshPath\(\$pageContentUpdateStore\.path\)/);
});

test("uses the configured journal folder for startup and journal shortcuts", () => {
  const app = readFileSync(join(process.cwd(), "src/App.svelte"), "utf8");
  const fileTree = readFileSync(
    join(process.cwd(), "src/lib/components/FileTree.svelte"),
    "utf8",
  );

  assert.match(app, /journalPath\(new Date\(\), \$workspaceStore\.journalFolder\)/);
  assert.match(fileTree, /journalPathForDay\(day, new Date\(\), \$workspaceStore\.journalFolder\)/);
  assert.match(fileTree, /journalPathForDateInput\(date, \$workspaceStore\.journalFolder\)/);
});
