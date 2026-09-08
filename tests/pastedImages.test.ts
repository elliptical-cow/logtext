import assert from "node:assert/strict";
import test from "node:test";

import { isSupportedClipboardImageType, pastedImageMarkdown } from "../src/lib/pastedImages.js";

test("accepts supported raster clipboard formats but rejects SVG", () => {
  assert.equal(isSupportedClipboardImageType("image/png"), true);
  assert.equal(isSupportedClipboardImageType("image/jpeg"), true);
  assert.equal(isSupportedClipboardImageType("image/svg+xml"), false);
});

test("creates portable Markdown while encoding unsafe path characters", () => {
  assert.equal(
    pastedImageMarkdown("../media files/screenshot (1).png"),
    "![Pasted image](../media%20files/screenshot%20(1).png)",
  );
  assert.equal(pastedImageMarkdown("media/image.png", "Chart ] draft"), "![Chart \\] draft](media/image.png)");
  assert.equal(
    pastedImageMarkdown("/media files/root image.png"),
    "![Pasted image](/media%20files/root%20image.png)",
  );
});
