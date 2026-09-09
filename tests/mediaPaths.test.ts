import assert from "node:assert/strict";
import test from "node:test";

import {
  isWorkspaceImageTarget,
  resolveWorkspaceImagePath,
  workspaceImageUrl,
} from "../src/lib/mediaPaths.js";

test("resolves local image paths from the workspace root", () => {
  assert.equal(resolveWorkspaceImagePath("media/image.png"), "media/image.png");
  assert.equal(resolveWorkspaceImagePath("assets/media/image.png"), "assets/media/image.png");
});

test("rejects parent, leading-slash, and operating-system absolute paths", () => {
  assert.equal(resolveWorkspaceImagePath("../media/image.png"), null);
  assert.equal(resolveWorkspaceImagePath("/media/image.png"), null);
  assert.equal(resolveWorkspaceImagePath("C:\\Users\\hans\\image.png"), null);
  assert.equal(resolveWorkspaceImagePath("\\\\server\\share\\image.png"), null);
});

test("builds an encoded workspace media URL outside the Tauri runtime", () => {
  assert.equal(
    workspaceImageUrl("media/My image.png"),
    "logtext-media://localhost/media/My%20image.png",
  );
});

test("keeps remote image URLs unchanged", () => {
  assert.equal(
    workspaceImageUrl("https://example.test/image.png"),
    "https://example.test/image.png",
  );
  assert.equal(isWorkspaceImageTarget("https://example.test/image.png"), false);
  assert.equal(isWorkspaceImageTarget("media/image.png"), true);
});
