import assert from "node:assert/strict";
import test from "node:test";

import {
  pageContentUpdateStore,
  type PageContentUpdate,
} from "../src/lib/stores/pageContentUpdates.js";

test("publishes path-specific page content revisions", () => {
  const updates: PageContentUpdate[] = [];
  const unsubscribe = pageContentUpdateStore.subscribe((update) => {
    if (update) {
      updates.push(update);
    }
  });

  pageContentUpdateStore.notify("journal/2026-09-05.md");
  pageContentUpdateStore.notify("journal/2026-09-06.md");
  unsubscribe();

  assert.deepEqual(
    updates.map((update) => update.path),
    ["journal/2026-09-05.md", "journal/2026-09-06.md"],
  );
  assert.equal(updates[1].revision, updates[0].revision + 1);
});
