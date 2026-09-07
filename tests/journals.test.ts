import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  adjacentJournalPath,
  expandJournalFeedWindow,
  initialJournalFeedWindow,
  isJournalPagePath,
  journalBoundaryDirection,
  journalPath,
  journalPathForDateInput,
  journalPathForDay,
  orderedJournalPaths,
  shouldUseContinuousJournalView,
} from "../src/lib/journals.js";
import { createJournalScrollNavigation } from "../src/lib/journalScrollNavigation.js";

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

test("finds existing adjacent journal pages in chronological order", () => {
  const pages = [
    "daily/notes.md",
    "daily/2026-08-10.md",
    "daily/2026-08-08.md",
    "daily/2026-08-09.md",
  ];

  assert.equal(adjacentJournalPath("daily/2026-08-09.md", pages, "daily", "previous"), "daily/2026-08-08.md");
  assert.equal(adjacentJournalPath("daily/2026-08-09.md", pages, "daily", "next"), "daily/2026-08-10.md");
  assert.equal(adjacentJournalPath("daily/2026-08-10.md", pages, "daily", "next"), null);
  assert.equal(
    adjacentJournalPath("daily/2026-08-09.md", pages, "daily", "previous", "desc"),
    "daily/2026-08-10.md",
  );
  assert.equal(
    adjacentJournalPath("daily/2026-08-09.md", pages, "daily", "next", "desc"),
    "daily/2026-08-08.md",
  );
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

test("detects scrolling beyond the journal page boundaries", () => {
  assert.equal(journalBoundaryDirection(0, 1000, 400, -10), "previous");
  assert.equal(journalBoundaryDirection(600, 1000, 400, 10), "next");
  assert.equal(journalBoundaryDirection(200, 1000, 400, 10), null);
  assert.equal(journalBoundaryDirection(0, 1000, 400, 0), null);
});

test("wires boundary navigation to the editor scroll container", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/components/EditorPane.svelte"),
    "utf8",
  );
  assert.match(source, /on:wheel=\{handleJournalWheel\}/);
  assert.match(source, /<svelte:window on:keydown\|capture=\{handleJournalPageKey\}/);
  assert.match(source, /editorScroll\?\.contains\(event\.target\)/);
  assert.match(source, /createJournalScrollNavigation\(/);
  assert.match(source, /journalScrollNavigation\.handleWheel\(/);
  assert.match(source, /journalScrollNavigation\.handlePageKey\(/);
  assert.match(source, /enabled: \$workspaceStore\.journalEditorContinuousScrolling/);
  assert.match(source, /folderPageSort\[\$workspaceStore\.journalFolder\]/);
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

test("allows another boundary gesture without requiring a click", async () => {
  const openedPaths: string[] = [];
  const navigation = createJournalScrollNavigation({
    async openPage(path) {
      openedPaths.push(path);
      return true;
    },
    async afterOpen() {},
    gestureLockMs: 0,
  });
  const container = { scrollTop: 500, scrollHeight: 900, clientHeight: 400 } as HTMLElement;
  const event = {
    ctrlKey: false,
    metaKey: false,
    deltaY: 20,
    preventDefault() {},
  } as WheelEvent;
  const paths = [
    "journal/2026-08-08.md",
    "journal/2026-08-09.md",
    "journal/2026-08-10.md",
  ];

  await navigation.handleWheel(event, container, {
    enabled: true,
    currentPath: paths[0],
    pagePaths: paths,
    journalFolder: "journal",
    sortDescending: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  container.scrollTop = 500;
  await navigation.handleWheel(event, container, {
    enabled: true,
    currentPath: paths[1],
    pagePaths: paths,
    journalFolder: "journal",
    sortDescending: false,
  });
  navigation.destroy();

  assert.deepEqual(openedPaths, [paths[1], paths[2]]);
});

test("uses a second page key press at a boundary to open an adjacent journal", async () => {
  const openedPaths: string[] = [];
  let prevented = 0;
  let stopped = 0;
  const navigation = createJournalScrollNavigation({
    async openPage(path) {
      openedPaths.push(path);
      return true;
    },
    async afterOpen() {},
  });
  const container = { scrollTop: 200, scrollHeight: 900, clientHeight: 400 } as HTMLElement;
  const pageDown = {
    key: "PageDown",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  } as KeyboardEvent;
  const paths = [
    "journal/2026-08-08.md",
    "journal/2026-08-09.md",
    "journal/2026-08-10.md",
  ];
  const context = {
    enabled: true,
    currentPath: paths[1],
    pagePaths: paths,
    journalFolder: "journal",
    sortDescending: false,
  };

  assert.equal(await navigation.handlePageKey(pageDown, container, context), false);
  assert.deepEqual(openedPaths, []);

  container.scrollTop = 500;
  assert.equal(await navigation.handlePageKey(pageDown, container, context), true);
  assert.equal(container.scrollTop, 0);

  const pageUp = { ...pageDown, key: "PageUp" } as KeyboardEvent;
  assert.equal(await navigation.handlePageKey(pageUp, container, context), true);
  navigation.destroy();

  assert.equal(container.scrollTop, 900);
  assert.deepEqual(openedPaths, [paths[2], paths[0]]);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
});

test("does not navigate journals for modified, repeated, or unrelated page keys", async () => {
  const openedPaths: string[] = [];
  const navigation = createJournalScrollNavigation({
    async openPage(path) {
      openedPaths.push(path);
      return true;
    },
    async afterOpen() {},
  });
  const container = { scrollTop: 500, scrollHeight: 900, clientHeight: 400 } as HTMLElement;
  const context = {
    enabled: true,
    currentPath: "journal/2026-08-09.md",
    pagePaths: ["journal/2026-08-09.md", "journal/2026-08-10.md"],
    journalFolder: "journal",
    sortDescending: false,
  };
  const event = {
    key: "PageDown",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    preventDefault() {},
    stopPropagation() {},
  } as KeyboardEvent;

  assert.equal(await navigation.handlePageKey(event, container, context), false);
  assert.equal(
    await navigation.handlePageKey({ ...event, shiftKey: false, repeat: true } as KeyboardEvent, container, context),
    false,
  );
  assert.equal(
    await navigation.handlePageKey({ ...event, shiftKey: false, key: "End" } as KeyboardEvent, container, context),
    false,
  );
  navigation.destroy();

  assert.deepEqual(openedPaths, []);
});

test("keeps editor journal boundary navigation disabled by workspace config", async () => {
  const openedPaths: string[] = [];
  const navigation = createJournalScrollNavigation({
    async openPage(path) {
      openedPaths.push(path);
      return true;
    },
    async afterOpen() {},
  });
  const container = { scrollTop: 500, scrollHeight: 900, clientHeight: 400 } as HTMLElement;
  const context = {
    enabled: false,
    currentPath: "journal/2026-08-09.md",
    pagePaths: ["journal/2026-08-09.md", "journal/2026-08-10.md"],
    journalFolder: "journal",
    sortDescending: false,
  };
  let prevented = false;
  const wheelEvent = {
    ctrlKey: false,
    metaKey: false,
    deltaY: 20,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  } as WheelEvent;
  const keyEvent = {
    key: "PageDown",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  } as KeyboardEvent;

  assert.equal(await navigation.handleWheel(wheelEvent, container, context), false);
  assert.equal(await navigation.handlePageKey(keyEvent, container, context), false);
  navigation.destroy();

  assert.equal(prevented, false);
  assert.deepEqual(openedPaths, []);
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

test("opens one adjacent journal and places the previous page at its end", async () => {
  const openedPaths: string[] = [];
  let prevented = false;
  const navigation = createJournalScrollNavigation({
    async openPage(path) {
      openedPaths.push(path);
      return true;
    },
    async afterOpen() {},
  });
  const container = { scrollTop: 0, scrollHeight: 900, clientHeight: 400 } as HTMLElement;
  const event = {
    ctrlKey: false,
    metaKey: false,
    deltaY: -20,
    preventDefault() {
      prevented = true;
    },
  } as WheelEvent;

  const opened = await navigation.handleWheel(event, container, {
    enabled: true,
    currentPath: "journal/2026-08-09.md",
    pagePaths: ["journal/2026-08-08.md", "journal/2026-08-09.md"],
    journalFolder: "journal",
    sortDescending: false,
  });
  navigation.destroy();

  assert.equal(opened, true);
  assert.equal(prevented, true);
  assert.deepEqual(openedPaths, ["journal/2026-08-08.md"]);
  assert.equal(container.scrollTop, 900);
});
