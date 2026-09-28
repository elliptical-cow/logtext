import assert from "node:assert/strict";
import test from "node:test";

import {
  containsOnlyClipboardImageLabels,
  htmlClipboardToMarkdown,
} from "../src/lib/htmlClipboard.js";

test("converts common formatted mail content to readable Markdown", () => {
  const markdown = htmlClipboardToMarkdown([
    "<h2>Project update</h2>",
    "<p><strong>Done</strong> and <em>reviewed</em>.</p>",
    "<blockquote>Keep this context.</blockquote>",
    '<p>See <a href="https://example.com">details</a>.</p>',
    "<ul><li>First</li><li>Second</li></ul>",
  ].join(""));

  assert.equal(markdown, [
    "## Project update",
    "",
    "**Done** and *reviewed*.",
    "",
    "> Keep this context.",
    "",
    "See [details](https://example.com).",
    "",
    "- First",
    "- Second",
  ].join("\n"));
});

test("preserves formatting expressed through Outlook inline styles", () => {
  const markdown = htmlClipboardToMarkdown([
    '<p><span style="font-weight: 700">Bold</span> ',
    '<span style="font-style: italic">italic</span> ',
    '<span style="text-decoration-line: line-through">old</span></p>',
  ].join(""));

  assert.equal(markdown, "**Bold** *italic* ~~old~~");
});

test("normalizes Outlook list paragraphs and nesting", () => {
  const markdown = htmlClipboardToMarkdown([
    '<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">',
    '<span style="mso-list:Ignore">·<span style="font:7.0pt Times New Roman">&nbsp;&nbsp;&nbsp;</span></span>',
    '<span style="font-weight:700">First</span></p>',
    '<p class="MsoListParagraphCxSpMiddle" style="mso-list:l0 level2 lfo1">',
    '<span style="mso-list:Ignore">o<span style="font:7.0pt Times New Roman">&nbsp;&nbsp;</span></span>',
    "Nested</p>",
    '<p class="MsoListParagraphCxSpLast" style="mso-list:l1 level1 lfo2">1.&nbsp;Ordered</p>',
  ].join(""));

  assert.equal(markdown, "- **First**\n    - Nested\n1. Ordered");
});

test("preserves semantic list nesting across multiple levels", () => {
  const markdown = htmlClipboardToMarkdown([
    "<ul><li>First<ul><li>Second<ul><li>Third</li></ul></li></ul></li></ul>",
    "<ol><li>One<ol><li>Two</li></ol></li></ol>",
  ].join(""));

  assert.equal(markdown, [
    "- First",
    "    - Second",
    "        - Third",
    "1. One",
    "    1. Two",
  ].join("\n"));
});

test("turns visually indented sibling lists into Markdown hierarchy", () => {
  const unordered = htmlClipboardToMarkdown([
    '<ul style="margin-left: 40px"><li>First</li></ul>',
    '<ul style="margin-left: 80px"><li>Second</li></ul>',
    '<ul style="margin-left: 120px"><li>Third</li></ul>',
  ].join(""));
  const ordered = htmlClipboardToMarkdown([
    '<ol style="margin-left: 36pt"><li>First</li></ol>',
    '<ol style="margin-left: 72pt"><li>Second</li></ol>',
    '<ol style="margin-left: 108pt"><li>Third</li></ol>',
  ].join(""));

  assert.equal(unordered, "- First\n    - Second\n        - Third");
  assert.equal(ordered, "1. First\n    1. Second\n        1. Third");
});

test("preserves hierarchy from indented list wrappers and list paragraphs", () => {
  const markdown = htmlClipboardToMarkdown([
    '<div><ul><li>First</li></ul></div>',
    '<div style="margin: 0 0 0 40px"><ul><li>Second</li></ul></div>',
    '<p style="margin-left: 40px">•&nbsp;Third</p>',
    '<p style="margin-left: 80px">•&nbsp;Fourth</p>',
  ].join(""));

  assert.equal(markdown, "- First\n    - Second\n    - Third\n        - Fourth");
});

test("infers Outlook hierarchy from paragraph indentation when level metadata is absent", () => {
  const markdown = htmlClipboardToMarkdown([
    '<p class="MsoListParagraph" style="margin-left:36pt">•&nbsp;First</p>',
    '<p class="MsoListParagraph" style="margin-left:72pt">•&nbsp;Second</p>',
    '<p class="MsoListParagraph" style="margin-left:108pt">•&nbsp;Third</p>',
  ].join(""));

  assert.equal(markdown, "- First\n    - Second\n        - Third");
});

test("keeps code readable, removes unsafe metadata, and replaces embedded images", () => {
  const markdown = htmlClipboardToMarkdown([
    "<style>.hidden { display: none; }</style>",
    "<script>alert('no')</script>",
    '<pre><code>const value = 1;</code></pre>',
    '<p><img src="cid:chart" alt="Quarterly chart"></p>',
  ].join(""));

  assert.equal(markdown, "```\nconst value = 1;\n```\n\n[Image: Quarterly chart]");
});

test("uses the plain-text fallback when the HTML has no useful content", () => {
  assert.equal(htmlClipboardToMarkdown("", "Plain text"), "Plain text");
  assert.equal(htmlClipboardToMarkdown("<style>p { color: red; }</style>", "Plain text"), "Plain text");
});

test("recognizes image-only conversions without mistaking surrounding text for an image paste", () => {
  assert.equal(containsOnlyClipboardImageLabels("[Image: Chart]"), true);
  assert.equal(containsOnlyClipboardImageLabels("[Image: A\\]B]\n[Image]"), true);
  assert.equal(containsOnlyClipboardImageLabels("Caption\n\n[Image: Chart]"), false);
  assert.equal(containsOnlyClipboardImageLabels(""), false);
});
