import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWikiLinkColorStyles,
  compactPageFolderLabel,
  compactPageLabel,
  markdownInlineLinksInText,
  renderWikiLinks,
  resolveWikiTarget,
  wikiLinksInText,
  wikiLinkDisplayLabel,
  wikiLinkHref,
} from "../src/lib/wikiLinks.js";
import type { PageSummary } from "../src/lib/types.js";

const pages: PageSummary[] = [
  {
    exists: true,
    key: "projects/forecasts",
    path: "Projects/Forecasts.md",
    title: "Forecasts",
    modifiedAt: 0,
  },
];

const collidingPages: PageSummary[] = [
  { exists: true, key: "projects/prognose", path: "projects/prognose.md", title: "prognose", modifiedAt: 0 },
  { exists: true, key: "processes/prognose", path: "processes/prognose.md", title: "prognose", modifiedAt: 0 },
  { exists: true, key: "archive/alpha/report", path: "archive/alpha/report.md", title: "report", modifiedAt: 0 },
  { exists: true, key: "active/alpha/report", path: "active/alpha/report.md", title: "report", modifiedAt: 0 },
];

test("renders wiki links with markdown extensions to the existing page path", () => {
  assert.equal(
    renderWikiLinks("[[projects/forecasts.md]]", pages),
    "[Forecasts](logtext:Projects%2FForecasts.md)",
  );
});

test("keeps explicit wiki link aliases", () => {
  assert.equal(
    renderWikiLinks("[[projects/forecasts.md|Forecast]]", pages),
    "[Forecast](logtext:Projects%2FForecasts.md)",
  );
});

test("keeps additional pipe characters in wiki link aliases", () => {
  assert.deepEqual(wikiLinksInText("[[projects/forecasts|Forecast | Q4]]")[0], {
    from: 0,
    to: 36,
    raw: "[[projects/forecasts|Forecast | Q4]]",
    target: "projects/forecasts",
    alias: "Forecast | Q4",
    syntax: "square",
  });
});

test("ignores escaped wiki links and wiki syntax inside Markdown links", () => {
  const source = [
    String.raw`\[[Escaped]]`,
    "[See [[Alpha]]](https://example.test)",
    "[Example](https://example.test/[[Alpha]])",
  ].join("\n");

  assert.deepEqual(wikiLinksInText(source), []);
  assert.equal(renderWikiLinks(source, pages), source);
});

test("finds inline Markdown links with wiki-like text in labels and targets", () => {
  assert.deepEqual(
    markdownInlineLinksInText(
      "[Standardlink mit [[verschachteltem Wiki-Link]]](https://example.test)",
    ),
    [{ from: 0, to: 70, labelFrom: 1, labelTo: 47 }],
  );
  assert.deepEqual(
    markdownInlineLinksInText(
      "[Link mit problematischem Ziel](https://example.test/[[WikiTarget]])",
    ),
    [{ from: 0, to: 68, labelFrom: 1, labelTo: 30 }],
  );
});

test("does not treat images, escaped labels, code, or LaTeX as inline Markdown links", () => {
  const source = [
    "![Image](media/image.png)",
    String.raw`\[Escaped](https://example.test)`,
    "`[Code](https://example.test)`",
    String.raw`$\text{[Formula](https://example.test)}$`,
  ];

  for (const line of source) {
    assert.deepEqual(markdownInlineLinksInText(line), []);
  }
});

test("ignores wiki links inside inline and block LaTeX", () => {
  const source = [
    String.raw`$\text{[[Inline formula]]}$`,
    "$$",
    String.raw`\text{[[Block formula]]}`,
    "$$",
    "[[Real link]]",
  ].join("\n");

  assert.deepEqual(
    wikiLinksInText(source).map((link) => link.target),
    ["Real link"],
  );
});

test("keeps round-delimited text unchanged", () => {
  const source = "((projects/forecasts.md|Forecast))";

  assert.deepEqual(wikiLinksInText(source), []);
  assert.equal(renderWikiLinks(source, pages), source);
});

test("renders compact links with a visible hash marker", () => {
  assert.equal(
    renderWikiLinks("See #projects/forecasts today", pages),
    "See [#Forecasts](logtext:Projects%2FForecasts.md) today",
  );
});

test("renders missing compact links with the existing creation workflow", () => {
  assert.equal(
    renderWikiLinks("See #Missing/Page", pages),
    "See [#Missing/Page](logtext-missing:Missing%2FPage.md)",
  );
});

test("ignores compact link lookalikes and Markdown code", () => {
  const source =
    "# Heading [#A] word#Alpha https://example.test/#Alpha `#Alpha` [Label #Alpha](https://example.test)\n```md\n#Alpha\n```";

  assert.deepEqual(wikiLinksInText(source), []);
  assert.equal(renderWikiLinks(source, pages), source);
});

test("marks missing wiki targets with a non-navigating scheme", () => {
  assert.equal(wikiLinkHref("Missing/Page", pages), "logtext-missing:Missing%2FPage.md");
});

test("resolves wiki targets case insensitively", () => {
  assert.deepEqual(resolveWikiTarget("projects/FORECASTS", pages), {
    exists: true,
    key: "projects/forecasts",
    path: "Projects/Forecasts.md",
  });
});

test("adds folder color styles to rendered wiki link anchors", () => {
  const html = '<p><a href="logtext:Projects%2FForecasts.md">Forecast</a></p>';

  assert.equal(
    applyWikiLinkColorStyles(html, pages, { Projects: "orange" }),
    '<p><a href="logtext:Projects%2FForecasts.md" class="wiki-link-chip" style="background-color: var(--folder-color-orange-chip-bg); color: var(--folder-color-orange-chip-text); border-bottom-color: var(--folder-color-orange-chip-border);">Forecast</a></p>',
  );
});

test("uses only the page name for unique wiki link labels", () => {
  assert.equal(wikiLinkDisplayLabel("projects/forecasts", pages), "Forecasts");
});

test("uses the shortest distinguishing path for colliding page names", () => {
  assert.equal(compactPageLabel("projects/prognose.md", collidingPages), "projects/prognose");
  assert.equal(compactPageLabel("processes/prognose.md", collidingPages), "processes/prognose");
  assert.equal(compactPageLabel("archive/alpha/report.md", collidingPages), "archive/alpha/report");
  assert.equal(compactPageLabel("active/alpha/report.md", collidingPages), "active/alpha/report");
});

test("uses only distinguishing folders for page source labels", () => {
  assert.equal(compactPageFolderLabel("Projects/Forecasts.md", pages), "");
  assert.equal(compactPageFolderLabel("projects/prognose.md", collidingPages), "projects");
  assert.equal(compactPageFolderLabel("archive/alpha/report.md", collidingPages), "archive/alpha");
});
