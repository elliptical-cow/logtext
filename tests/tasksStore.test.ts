import assert from "node:assert/strict";
import test from "node:test";

import { get } from "svelte/store";
import { createTaskStore } from "../src/lib/stores/tasks.js";
import type { TaskItem } from "../src/lib/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function task(path: string): TaskItem {
  return {
    path,
    title: path,
    line: 1,
    status: "TODO",
    priority: null,
    sourceHeadings: [],
    parentBlocks: [],
    linkedPages: [],
    attributes: [],
    text: "TODO Task",
    markdown: "- TODO Task",
  };
}

test("ignores stale task responses after clear and a newer refresh", async () => {
  const first = deferred<TaskItem[]>();
  const second = deferred<TaskItem[]>();
  const responses = [first.promise, second.promise];
  const store = createTaskStore(async () => responses.shift() ?? []);

  const firstRefresh = store.refresh();
  store.clear();
  const secondRefresh = store.refresh();
  second.resolve([task("New.md")]);
  await secondRefresh;
  first.resolve([task("Old.md")]);
  await firstRefresh;

  assert.deepEqual(get(store).tasks.map((item) => item.path), ["New.md"]);
  assert.equal(get(store).loaded, true);
});
