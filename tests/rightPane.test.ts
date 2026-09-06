import assert from "node:assert/strict";
import test from "node:test";

import { get } from "svelte/store";
import { createRightPaneStore } from "../src/lib/stores/rightPane.js";
import type { PageView } from "../src/lib/types.js";

function pageView(path: string): PageView {
  const key = path.replace(/\.md$/, "").toLowerCase();
  return {
    page: { exists: true, key, path, title: key },
    content: `# ${key}`,
    backlinks: [],
    diagnostics: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("keeps path and view consistent across journal, regular page, and journal", async () => {
  const journalRequest = deferred<PageView>();
  const store = createRightPaneStore({
    getPageView: async (path) =>
      path === "journal/2026-09-06.md" ? journalRequest.promise : pageView(path),
  });

  await store.open("journal/2026-09-05.md");
  await store.open("Notes.md");
  const openingJournal = store.open("journal/2026-09-06.md");

  assert.equal(get(store).path, "Notes.md");
  assert.equal(get(store).pageView?.page.path, "Notes.md");
  assert.equal(get(store).pendingPath, "journal/2026-09-06.md");
  assert.equal(get(store).loading, true);

  journalRequest.resolve(pageView("journal/2026-09-06.md"));
  await openingJournal;

  assert.equal(get(store).path, "journal/2026-09-06.md");
  assert.equal(get(store).pageView?.page.path, "journal/2026-09-06.md");
  assert.equal(get(store).pendingPath, null);
  assert.equal(get(store).loading, false);
});

test("preserves the loaded page when a pending right-pane navigation fails", async () => {
  const journalRequest = deferred<PageView>();
  const store = createRightPaneStore({
    getPageView: async (path) =>
      path === "journal/2026-09-06.md" ? journalRequest.promise : pageView(path),
  });

  await store.open("Notes.md");
  const openingJournal = store.open("journal/2026-09-06.md");
  journalRequest.reject(new Error("cannot load journal"));
  await openingJournal;

  assert.equal(get(store).path, "Notes.md");
  assert.equal(get(store).pageView?.page.path, "Notes.md");
  assert.equal(get(store).pendingPath, null);
  assert.equal(get(store).error, "cannot load journal");
});

test("tracks right-pane back and forward history", async () => {
  const store = createRightPaneStore({ getPageView: async (path) => pageView(path) });

  await store.open("A.md");
  await store.open("B.md");
  await store.open("C.md");

  assert.equal(get(store).path, "C.md");
  assert.equal(get(store).canGoBack, true);
  assert.equal(get(store).canGoForward, false);

  await store.goBack();
  assert.equal(get(store).path, "B.md");
  assert.equal(get(store).canGoBack, true);
  assert.equal(get(store).canGoForward, true);

  await store.goForward();
  assert.equal(get(store).path, "C.md");
  assert.equal(get(store).canGoBack, true);
  assert.equal(get(store).canGoForward, false);
});

test("keeps the current page and history when right-pane back navigation fails", async () => {
  const failingPaths = new Set<string>();
  const store = createRightPaneStore({
    getPageView: async (path) => {
      if (failingPaths.has(path)) {
        throw new Error(`cannot open ${path}`);
      }
      return pageView(path);
    },
  });

  await store.open("A.md");
  await store.open("B.md");
  failingPaths.add("A.md");
  await store.goBack();

  assert.equal(get(store).path, "B.md");
  assert.equal(get(store).pageView?.page.path, "B.md");
  assert.equal(get(store).canGoBack, true);
  assert.equal(get(store).canGoForward, false);
  assert.equal(get(store).error, "cannot open A.md");

  failingPaths.clear();
  await store.goBack();
  assert.equal(get(store).path, "A.md");
  assert.equal(get(store).canGoBack, false);
  assert.equal(get(store).canGoForward, true);
});
