import assert from "node:assert/strict";
import test from "node:test";

import {
  blockAttributeMatch,
  markBlockAttributesForRendering,
} from "../src/lib/blockAttributes.js";

test("recognizes arbitrary list child attributes with conservative names", () => {
  assert.deepEqual(blockAttributeMatch("  - owner:: Jens"), {
    name: "owner",
    value: "Jens",
    from: 4,
    to: 16,
    nameFrom: 4,
    nameTo: 11,
  });
  assert.equal(blockAttributeMatch("- due-date::")?.value, "");
  assert.equal(blockAttributeMatch("- owner_name:: Team")?.name, "owner_name");
  assert.equal(blockAttributeMatch("- owner name:: Team"), null);
  assert.equal(blockAttributeMatch("- 1owner:: Team"), null);
  assert.equal(blockAttributeMatch("owner:: Team"), null);
});

test("marks attribute keys for rendering without touching values or code", () => {
  const source = [
    "- Parent",
    "  - owner:: **Jens**",
    "```md",
    "- example:: literal",
    "```",
  ].join("\n");
  const result = markBlockAttributesForRendering(source, new Set([3, 4, 5]));

  assert.equal(result.tokens.length, 1);
  assert.equal(result.tokens[0].name, "owner");
  assert.match(
    result.markdown,
    /LOGTEXT_BLOCK_ATTRIBUTE_0_OPEN: \*\*Jens\*\*:LOGTEXT_BLOCK_ATTRIBUTE_0_CLOSE/,
  );
  assert.match(result.markdown, /- example:: literal/);
});

test("keeps CRLF line endings outside attribute rendering markers", () => {
  const source = "- Parent\r\n  - owner:: Jens\r\n";
  const result = markBlockAttributesForRendering(source, new Set());

  assert.match(result.markdown, /CLOSE\r\n/);
  assert.equal(result.markdown.includes("\rLOGTEXT_BLOCK_ATTRIBUTE"), false);
});
