import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const editor = readFileSync(
  join(process.cwd(), "src/lib/components/CodeMirrorEditor.svelte"),
  "utf8",
);

test("converts HTML clipboard content before considering standalone images", () => {
  const htmlRead = editor.indexOf('getData("text/html")');
  const conversion = editor.indexOf("htmlClipboardToMarkdown(", htmlRead);
  const imageRead = editor.indexOf("clipboardData?.items", htmlRead);

  assert.ok(htmlRead >= 0);
  assert.ok(conversion > htmlRead);
  assert.ok(imageRead > conversion);
  assert.match(editor, /getData\("text\/plain"\)/);
  assert.match(editor, /!containsOnlyClipboardImageLabels\(markdown\)/);
  assert.match(editor, /event\.preventDefault\(\);\s*insertPastedText\(editorView, markdown\)/);
});

test("shares the editor insertion path with the existing clipboard command", () => {
  assert.match(editor, /const text = await readText\(\);\s*insertPastedText\(editorView, text\)/);
  assert.match(editor, /function insertPastedText\(editorView: EditorView, text: string\)/);
});
