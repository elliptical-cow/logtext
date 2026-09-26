import assert from "node:assert/strict";
import test from "node:test";

import {
  richTextClipboardPayload,
  richTextClipboardPayloadFromHtml,
} from "../src/lib/richTextClipboard.js";

test("creates portable rich text while retaining the Markdown fallback", () => {
  const source = "# Weekly update\n\n- **Done**\n- _Next_";
  const payload = richTextClipboardPayload(source);

  assert.equal(payload.text, source);
  assert.match(payload.html, /<h1 style="[^"]*">Weekly update<\/h1>/);
  assert.match(payload.html, /<ul style="[^"]*">/);
  assert.match(payload.html, /<strong>Done<\/strong>/);
  assert.match(payload.html, /<em>Next<\/em>/);
});

test("uses inline styles for links, quotes, code, and tables", () => {
  const payload = richTextClipboardPayload([
    "> Important",
    "",
    "Visit [Logtext](https://example.com).",
    "",
    "`code`",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
  ].join("\n"));

  assert.match(payload.html, /<blockquote style="[^"]*border-left:/);
  assert.match(payload.html, /<a style="[^"]*" href="https:\/\/example\.com">Logtext<\/a>/);
  assert.match(payload.html, /<code style="[^"]*font-family:/);
  assert.match(payload.html, /<table style="[^"]*border-collapse:/);
  assert.match(payload.html, /<td style="[^"]*border:/);
});

test("keeps clipboard HTML safe and removes Logtext-only targets", () => {
  const payload = richTextClipboardPayload([
    "[[projects/alpha|Alpha]] and #roadmap",
    "",
    "<script>alert('no')</script>",
    "",
    "![Diagram](media/diagram.png)",
    "",
    "$x^2$",
  ].join("\n"));

  assert.doesNotMatch(payload.html, /href="logtext/);
  assert.match(payload.html, />Alpha and #roadmap</);
  assert.doesNotMatch(payload.html, /<script>/);
  assert.match(payload.html, /&lt;script&gt;/);
  assert.doesNotMatch(payload.html, /<img/);
  assert.match(payload.html, /\[Image: Diagram\]/);
  assert.match(payload.html, /\$x\^2\$/);
});

test("makes preview lists portable without relying on Logtext CSS", () => {
  const payload = richTextClipboardPayloadFromHtml(
    '<ul><li data-list-marker="•"><strong>Done</strong></li></ul>'
      + '<ol style="margin-top: 2px"><li data-list-marker="1.">Next</li></ol>',
    "Done\nNext",
  );

  assert.equal(payload.text, "Done\nNext");
  assert.match(payload.html, /<ul style="[^"]*list-style-type: disc;/);
  assert.match(payload.html, /<ol style="[^"]*margin-top: 2px;[^"]*list-style-type: decimal;/);
  assert.match(payload.html, /<li style="[^"]*display: list-item;[^"]*" data-list-marker="•">/);
  assert.match(payload.html, /<strong>Done<\/strong>/);
});
