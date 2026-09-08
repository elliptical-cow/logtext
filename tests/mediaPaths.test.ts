import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkspaceImagePath, workspaceImageUrl } from "../src/lib/mediaPaths.js";

test("resolves local images relative to their Markdown document", () => {
  assert.equal(
    resolveWorkspaceImagePath("projects/Roadmap.md", "../media/image.png"),
    "media/image.png",
  );
  assert.equal(resolveWorkspaceImagePath("Inbox.md", "media/image.png"), "media/image.png");
});

test("rejects local image targets that leave the workspace", () => {
  assert.equal(resolveWorkspaceImagePath("Inbox.md", "../outside.png"), null);
  assert.equal(resolveWorkspaceImagePath("projects/Roadmap.md", "../../outside.png"), null);
});

test("builds an encoded workspace media URL outside the Tauri runtime", () => {
  assert.equal(
    workspaceImageUrl("projects/Roadmap.md", "../media/My image.png"),
    "logtext-media://localhost/media/My%20image.png",
  );
});

test("keeps remote image URLs unchanged", () => {
  assert.equal(
    workspaceImageUrl("projects/Roadmap.md", "https://example.test/image.png"),
    "https://example.test/image.png",
  );
});
