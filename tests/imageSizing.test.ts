import assert from "node:assert/strict";
import test from "node:test";

import {
  imageTitleWithLogtextWidth,
  imageTitleWithoutLogtextWidth,
  logtextImageWidth,
  nextImageWidth,
} from "../src/lib/imageSizing.js";

test("stores image width metadata without discarding a visible title", () => {
  const title = imageTitleWithLogtextWidth("Architecture diagram", 640);

  assert.equal(title, "Architecture diagram | logtext-width=640px");
  assert.equal(logtextImageWidth(title), 640);
  assert.equal(imageTitleWithoutLogtextWidth(title), "Architecture diagram");
});

test("replaces existing image width metadata and validates its range", () => {
  assert.equal(
    imageTitleWithLogtextWidth("Chart | logtext-width=400px", 500),
    "Chart | logtext-width=500px",
  );
  assert.equal(logtextImageWidth("logtext-width=79px"), null);
  assert.equal(logtextImageWidth("ordinary title"), null);
});

test("changes only image width in predictable increments", () => {
  assert.equal(nextImageWidth(400, 300, "larger"), 500);
  assert.equal(nextImageWidth(400, 300, "smaller"), 320);
  assert.equal(nextImageWidth(null, 400, "smaller"), 320);
});
