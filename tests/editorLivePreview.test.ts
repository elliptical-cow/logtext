import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import test from "node:test";
import {
  activeBlockLineNumbers,
  checkboxAtDocumentPosition,
  emphasisSpans,
  inlineLatexSourceSpans,
  latexBlockLineNumbers,
  livePreviewExtension,
  liveCheckboxCheckClass,
  markdownImagesInState,
  previewDecorationsForLine,
  taskKeywordAtDocumentPosition,
  wikiLinkAtDocumentPosition,
  wikiLinkAtPosition,
} from "../src/lib/editorLivePreview.js";

test("shows inline LaTeX as code without applying Markdown decorations", () => {
  const decorations = previewDecorationsForLine(String.raw`Formula $x_i * y_i$ and **bold**`);

  assert.deepEqual(inlineLatexSourceSpans(String.raw`Formula $x_i * y_i$ and **bold**`), [
    { start: 8, end: 19 },
  ]);
  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 8, to: 19 },
      { from: 24, to: 26 },
      { from: 26, to: 30 },
      { from: 30, to: 32 },
    ],
  );
});

test("does not treat escaped dollars or code spans as LaTeX", () => {
  assert.deepEqual(inlineLatexSourceSpans("Price \\$5 and code `$x$`"), []);
  assert.deepEqual(inlineLatexSourceSpans("Not inline $$x_i$$ here"), []);
});

test("does not activate wiki links contained in inline LaTeX", () => {
  assert.equal(wikiLinkAtPosition(String.raw`$\text{[[Alpha]]}$`, 0, 9), null);
});

test("shows block LaTeX as code without interpreting fenced code as formulas", () => {
  const source = [
    "Before",
    "$$",
    String.raw`x_i * y_i`,
    "$$",
    "```text",
    "$$not a formula$$",
    "```",
  ].join("\n");

  assert.deepEqual([...latexBlockLineNumbers(source)], [2, 3, 4]);
});

test("builds live preview decorations for multiline block LaTeX", () => {
  const state = EditorState.create({
    doc: ["Before", "$$", String.raw`x_i * y_i`, "$$", "After"].join("\n"),
    extensions: livePreviewExtension(),
  });

  assert.equal(state.doc.lines, 5);
});

test("recognizes Markdown images through the editor syntax tree", () => {
  const source = "Before ![Screenshot](media/image.png) after";
  const state = EditorState.create({
    doc: source,
    extensions: [markdown(), livePreviewExtension()],
  });

  assert.deepEqual(markdownImagesInState(state), [
    {
      from: 7,
      to: 37,
      alt: "Screenshot",
      target: "media/image.png",
      title: null,
      titleFrom: null,
      titleTo: null,
    },
  ]);
});

test("reads persistent image width metadata from Markdown titles", () => {
  const source = '![Diagram](media/diagram.png "Overview | logtext-width=640px")';
  const state = EditorState.create({
    doc: source,
    extensions: [markdown()],
  });

  assert.deepEqual(markdownImagesInState(state), [
    {
      from: 0,
      to: source.length,
      alt: "Diagram",
      target: "media/diagram.png",
      title: "Overview | logtext-width=640px",
      titleFrom: 29,
      titleTo: 61,
    },
  ]);
});

test("keeps image syntax parseable inside inline LaTeX source", () => {
  const source = String.raw`Formula $![not an image](media/image.png)$`;
  const state = EditorState.create({
    doc: source,
    extensions: [markdown(), livePreviewExtension()],
  });

  // Constructing the state builds the decoration set. Markdown-looking formula
  // content must not create overlapping image and LaTeX decorations.
  assert.equal(state.doc.toString(), source);
});

test("does not activate wiki links contained in block LaTeX", () => {
  const state = EditorState.create({
    doc: ["$$", String.raw`\text{[[Alpha]]}`, "$$"].join("\n"),
  });

  assert.equal(wikiLinkAtDocumentPosition(state, 11), null);
});

test("creates preview decorations for headings without changing text", () => {
  const decorations = previewDecorationsForLine("## Project Alpha", 10);

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 10, to: 10 },
      { from: 10, to: 13 },
    ],
  );
});

test("creates preview decorations for wiki links and aliases", () => {
  const decorations = previewDecorationsForLine("See [[projects/alpha|Alpha]] and [[Beta]]");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 4, to: 21 },
      { from: 21, to: 26 },
      { from: 26, to: 28 },
      { from: 33, to: 35 },
      { from: 35, to: 39 },
      { from: 39, to: 41 },
    ],
  );
});

test("does not create preview decorations for round-delimited text", () => {
  const decorations = previewDecorationsForLine("See ((projects/alpha|Alpha)) and ((Beta))");

  assert.deepEqual(decorations, []);
});

test("creates preview decorations for compact links", () => {
  const decorations = previewDecorationsForLine("See #projects/alpha");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [{ from: 4, to: 19 }],
  );
});

test("creates preview decorations for task keywords and strong text", () => {
  const decorations = previewDecorationsForLine("- TODO Finish **report**");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 2, to: 6 },
      { from: 14, to: 16 },
      { from: 16, to: 22 },
      { from: 22, to: 24 },
    ],
  );
});

test("creates preview decorations for numbered task list items", () => {
  const decorations = previewDecorationsForLine("1. TODO Finish report");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [{ from: 3, to: 7 }],
  );
});

test("creates preview decorations for task priority cookies", () => {
  const decorations = previewDecorationsForLine("- TODO [#A] Finish report");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 2, to: 6 },
      { from: 7, to: 11 },
    ],
  );
});

test("creates preview decorations for attached task priority cookies", () => {
  const decorations = previewDecorationsForLine("- TODO[#A] Finish report");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 2, to: 6 },
      { from: 6, to: 10 },
    ],
  );
});

test("finds task keyword when document position is on priority cookie", () => {
  const state = EditorState.create({
    doc: "- TODO [#A] Finish report",
  });

  assert.deepEqual(taskKeywordAtDocumentPosition(state, 9), {
    from: 2,
    to: 6,
    status: "TODO",
  });
});

test("creates preview decorations for checkbox list markers", () => {
  const decorations = previewDecorationsForLine("- [ ] Finish report\n");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [{ from: 2, to: 5 }],
  );
});

test("renders checked live preview checkboxes with a positioned check mark element", () => {
  assert.equal(liveCheckboxCheckClass(), "cm-live-checkbox-check");
});

test("finds checkbox markers at document positions", () => {
  const state = EditorState.create({
    doc: "- [ ] Open\n- [x] Done",
  });

  assert.deepEqual(checkboxAtDocumentPosition(state, 3), {
    from: 2,
    to: 5,
    checked: false,
  });
  assert.deepEqual(checkboxAtDocumentPosition(state, 14), {
    from: 13,
    to: 16,
    checked: true,
  });
  assert.equal(checkboxAtDocumentPosition(state, 8), null);
});

test("creates preview decorations for emphasis text", () => {
  const decorations = previewDecorationsForLine("This is *important* and _urgent_");

  assert.deepEqual(
    decorations.map(({ from, to }) => ({ from, to })),
    [
      { from: 8, to: 9 },
      { from: 9, to: 18 },
      { from: 18, to: 19 },
      { from: 24, to: 25 },
      { from: 25, to: 31 },
      { from: 31, to: 32 },
    ],
  );
});

test("detects emphasis spans without treating list markers as emphasis", () => {
  assert.deepEqual(emphasisSpans("This is *important* and _urgent_"), [
    { start: 8, end: 18 },
    { start: 24, end: 31 },
  ]);
  assert.deepEqual(emphasisSpans("* Bewerbungsgespraech **Hans** fuer"), []);
});

test("does not create live preview decorations inside table rows", () => {
  assert.deepEqual(previewDecorationsForLine("| [[Alpha]] | **Owner** |"), []);
});

test("finds wiki links at document positions", () => {
  assert.deepEqual(wikiLinkAtPosition("See [[projects/alpha|Alpha]]", 10, 32), {
    from: 14,
    to: 38,
    target: "projects/alpha",
    label: "Alpha",
  });

  assert.deepEqual(wikiLinkAtPosition("[[Beta]]", 0, 3), {
    from: 0,
    to: 8,
    target: "Beta",
    label: "Beta",
  });

  assert.equal(wikiLinkAtPosition("((Beta))", 0, 3), null);

  assert.deepEqual(wikiLinkAtPosition("See #projects/alpha", 0, 8), {
    from: 4,
    to: 19,
    target: "projects/alpha",
    label: "#projects/alpha",
  });
});

test("ignores positions outside wiki links", () => {
  assert.equal(wikiLinkAtPosition("See [[Alpha]]", 0, 1), null);
  assert.equal(wikiLinkAtPosition("See [[Alpha]] now", 0, 15), null);
});

test("ignores wiki links inside fenced code blocks", () => {
  const state = EditorState.create({
    doc: "```md\n[[Alpha]]\n```\n[[Beta]]",
  });

  assert.equal(wikiLinkAtDocumentPosition(state, 8), null);
  assert.deepEqual(wikiLinkAtDocumentPosition(state, 20), {
    from: 20,
    to: 28,
    target: "Beta",
    label: "Beta",
  });
});

test("ignores compact links inside inline and fenced code", () => {
  const state = EditorState.create({
    doc: "Use `#Alpha` here\n```md\n#Beta\n```\n#Gamma",
  });

  assert.equal(wikiLinkAtDocumentPosition(state, 6), null);
  assert.equal(wikiLinkAtDocumentPosition(state, 28), null);
  assert.deepEqual(wikiLinkAtDocumentPosition(state, 36), {
    from: 34,
    to: 40,
    target: "Gamma",
    label: "#Gamma",
  });
});

test("keeps only the child list item active while editing it", () => {
  const state = EditorState.create({
    doc: "- Parent\n  - Child\n\nPlain",
    selection: { anchor: 11 },
  });

  assert.deepEqual([...activeBlockLineNumbers(state)], [2]);
});

test("keeps only the current list item active while editing one item", () => {
  const state = EditorState.create({
    doc: "- [[Alpha]]\n- [[Beta]]\n- [[Gamma]]",
    selection: { anchor: 14 },
  });

  assert.deepEqual([...activeBlockLineNumbers(state)], [2]);
});

test("keeps child list items rendered while editing a parent item", () => {
  const state = EditorState.create({
    doc: "- [[Alpha]]\n  - [[Alpha child]]\n- [[Beta]]",
    selection: { anchor: 3 },
  });

  assert.deepEqual([...activeBlockLineNumbers(state)], [1]);
});

test("keeps only the nested task line active while editing it", () => {
  const state = EditorState.create({
    doc: "- TODO Parent\n  - TODO Child\n- TODO Sibling",
    selection: { anchor: 18 },
  });

  assert.deepEqual([...activeBlockLineNumbers(state)], [2]);
});
