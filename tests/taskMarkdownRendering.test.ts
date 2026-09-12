import assert from "node:assert/strict";
import test from "node:test";

import { createMarkdownRenderer, markdownCodeLineNumbers } from "../src/lib/markdownRenderer.js";
import { markTaskKeywordsForRendering } from "../src/lib/taskMarkdownRendering.js";

const taskStates = ["TODO", "INPROGRESS", "WAITING", "DONE"];

test("does not mark task syntax inside fenced or indented code", () => {
  const source = [
    "```md",
    "- TODO [#A] fenced example",
    "```",
    "",
    "    - DONE indented example",
    "",
    "- TODO [#B] real task",
  ].join("\n");
  const markdown = createMarkdownRenderer({ breaks: true });
  const result = markTaskKeywordsForRendering(
    source,
    taskStates,
    [],
    markdownCodeLineNumbers(markdown, source),
  );

  assert.equal(result.taskTokens.length, 1);
  assert.equal(result.taskTokens[0].localLine, 7);
  assert.equal(result.priorityTokens.length, 1);
  assert.equal(result.priorityTokens[0].priority, "B");
  assert.match(result.markdown, /- TODO \[#A\] fenced example/);
  assert.match(result.markdown, /- DONE indented example/);
});
