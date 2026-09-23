import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createMarkdownRenderer,
  markdownCodeLineNumbers,
} from "../src/lib/markdownRenderer.js";
import { markBlockAttributesForRendering } from "../src/lib/blockAttributes.js";
import {
  installMermaidCssStyleSheetCompatibility,
  mermaidConfiguration,
  mermaidRenderErrorMessage,
  type MermaidCssStyleSheetEnvironment,
} from "../src/lib/mermaidRendering.js";

const root = process.cwd();

test("renders continuation lines as visible breaks in the right pane", () => {
  const markdownView = readFileSync(
    join(root, "src/lib/components/MarkdownView.svelte"),
    "utf8",
  );

  assert.match(markdownView, /breaks: true/);
  assert.match(
    createMarkdownRenderer({ breaks: true }).render("- First line\n  Continuation"),
    /First line<br>\nContinuation/,
  );
});

test("renders inline and block LaTeX formulas with KaTeX", () => {
  const markdown = createMarkdownRenderer({ breaks: true });
  const inline = markdown.render(String.raw`Energy is $E = mc^2$.`);
  const block = markdown.render(String.raw`$$
\int_0^1 x^2 \, dx
$$`);

  assert.match(inline, /<span class="katex">/);
  assert.match(inline, /Energy is/);
  assert.match(block, /class=['"]katex-block['"]/);
  assert.match(block, /class="katex-display"/);
});

test("resolves workspace images from the workspace root", () => {
  const markdown = createMarkdownRenderer({ breaks: true, workspaceImages: true });

  assert.match(
    markdown.render("![Screenshot](media/My%20image.png)", {
      sourcePath: "projects/Roadmap.md",
    }),
    /src="logtext-media:\/\/localhost\/media\/My%20image\.png"/,
  );
  assert.match(
    markdown.render("![Screenshot](media/image.png)", { sourcePath: "Notes.md" }),
    /data-workspace-image="true"/,
  );
  assert.match(
    markdown.render("![Screenshot](media/image.png)", { sourcePath: "Notes.md" }),
    /crossorigin="anonymous"/,
  );
  assert.equal(
    /data-workspace-image/.test(
      markdown.render("![Remote](https://example.test/image.png)", {
        sourcePath: "Notes.md",
      }),
    ),
    false,
  );
});

test("applies persisted image widths while keeping images within the pane", () => {
  const markdown = createMarkdownRenderer({ breaks: true, workspaceImages: true });
  const rendered = markdown.render(
    '![Diagram](media/diagram.png "Overview | logtext-width=640px")',
    { sourcePath: "Notes.md" },
  );
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(rendered, /style="width: 640px"/);
  assert.match(rendered, /title="Overview"/);
  assert.equal(/logtext-width/.test(rendered), false);
  assert.match(styles, /\.workspace-image\s*\{[^}]*max-width: 100%;/s);
  assert.match(styles, /\.cm-live-image\s*\{[^}]*max-width: 100%;[^}]*height: auto;/s);
  assert.match(
    styles,
    /\.cm-live-image-controls\s*\{[^}]*top: 6px;[^}]*left: 6px;/s,
  );
});

test("keeps wide rendered Markdown tables horizontally scrollable", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(
    styles,
    /\.markdown-view table\s*\{[^}]*display: block;[^}]*max-width: 100%;[^}]*overflow-x: auto;/s,
  );
});

test("uses the same reduced size for complete block attribute lines", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");
  const livePreview = readFileSync(join(root, "src/lib/editorLivePreview.ts"), "utf8");

  assert.match(styles, /\.markdown-view \.block-attribute\s*\{[^}]*font-size: 0\.88em;/s);
  assert.match(
    livePreview,
    /"\.cm-live-block-attribute"\s*:\s*\{[^}]*fontSize: "0\.88em"/s,
  );
  assert.equal(
    /\.markdown-view \.block-attribute-key\s*\{[^}]*font-size:/s.test(styles),
    false,
  );
});

test("keeps compact wiki-link attribute values outside rendering markers", () => {
  const content = "- related:: #Project";
  const markdown = createMarkdownRenderer({ breaks: true, logtextWikiLinks: true });
  const attributes = markBlockAttributesForRendering(
    content,
    markdownCodeLineNumbers(markdown, content),
  );
  const rendered = markdown.render(attributes.markdown, {
    pages: [{ path: "Project.md", key: "project", title: "Project" }],
  });

  assert.match(rendered, /<a href="logtext:Project\.md">#Project<\/a>/);
  assert.doesNotMatch(rendered, /href="[^"]*LOGTEXT_BLOCK_ATTRIBUTE/);
});

test("keeps rendering after malformed LaTeX and ignores formulas in Markdown code", () => {
  const markdown = createMarkdownRenderer({ breaks: true });
  const malformed = markdown.render(String.raw`Before $\notacommand{$ after **still here**.`);
  const code = markdown.render(
    ["Inline code: `$E = mc^2$`", "", "```text", "$$x^2$$", "```"].join("\n"),
  );

  assert.match(malformed, /class="katex-error"/);
  assert.match(malformed, /<strong>still here<\/strong>/);
  assert.equal(/class="katex"/.test(code), false);
  assert.match(code, /<code>\$E = mc\^2\$<\/code>/);
  assert.match(code, /\$\$x\^2\$\$/);
});

test("uses CommonMark escape behavior for emphasis delimiters", () => {
  const markdown = createMarkdownRenderer({ breaks: true });

  assert.equal(
    markdown.render(String.raw`\**Nicht fett**`),
    "<p>*<em>Nicht fett</em>*</p>\n",
  );
  assert.equal(
    markdown.render(String.raw`\*\*Nicht fett\*\*`),
    "<p>**Nicht fett**</p>\n",
  );
});

test("renders Logtext wiki links as Markdown-it inline tokens", () => {
  const markdown = createMarkdownRenderer({ breaks: true, logtextWikiLinks: true });
  const pages = [
    {
      exists: true,
      key: "projects/forecasts",
      path: "Projects/Forecasts.md",
      title: "Forecasts",
    },
  ];
  const rendered = markdown.render(
    "See [[projects/forecasts|Forecast]] and #projects/forecasts.",
    { pages },
  );

  assert.match(rendered, /href="logtext:Projects%2FForecasts\.md">Forecast<\/a>/);
  assert.match(rendered, /href="logtext:Projects%2FForecasts\.md">#Forecasts<\/a>/);
});

test("does not render wiki links in protected Markdown contexts", () => {
  const markdown = createMarkdownRenderer({ breaks: true, logtextWikiLinks: true });
  const source = [
    "`[[Inline code]]`",
    "",
    "    [[Indented code]]",
    "",
    String.raw`$\text{[[Formula]]}$`,
    "",
    "[See [[Label content]]](https://example.test)",
    "",
    String.raw`\[[Escaped]]`,
  ].join("\n");
  const rendered = markdown.render(source, { pages: [] });

  assert.equal(rendered.includes("logtext:"), false);
  assert.match(rendered, /<code>\[\[Inline code\]\]<\/code>/);
  assert.match(rendered, /<pre><code>\[\[Indented code\]\]/);
  assert.match(rendered, /\\text\{\[\[Formula\]\]\}/);
  assert.match(rendered, /href="https:\/\/example\.test">See \[\[Label content\]\]<\/a>/);
  assert.match(rendered, /\[\[Escaped\]\]/);
});

test("marks Mermaid fences only when rendered-diagram support is enabled", () => {
  const source = ["```Mermaid", "flowchart TD", "  A[<unsafe>] --> B", "```"].join("\n");
  const regular = createMarkdownRenderer({ breaks: true }).render(source);
  const mermaid = createMarkdownRenderer({ breaks: true, mermaidCodeBlocks: true }).render(
    source,
    { sourceLineNumbers: [17] },
  );

  assert.equal(/data-mermaid-diagram/.test(regular), false);
  assert.match(regular, /<pre><code class="language-Mermaid">/);
  assert.match(mermaid, /data-mermaid-diagram data-source-line="17"/);
  assert.match(mermaid, /class="mermaid-diagram-source"/);
  assert.match(mermaid, /class="mermaid-diagram-output" hidden/);
  assert.match(mermaid, /A\[&lt;unsafe&gt;\] --&gt; B/);
});

test("keeps non-Mermaid fences unchanged when diagram rendering is enabled", () => {
  const markdown = createMarkdownRenderer({ breaks: true, mermaidCodeBlocks: true });
  const rendered = markdown.render(["```typescript", "const value = 1;", "```"].join("\n"));

  assert.equal(/data-mermaid-diagram/.test(rendered), false);
  assert.match(rendered, /<pre><code class="language-typescript">/);
});

test("identifies fenced and indented code lines before Logtext preprocessing", () => {
  const markdown = createMarkdownRenderer({ breaks: true });
  const source = [
    "```md",
    "- TODO fenced",
    "```",
    "",
    "    - TODO indented",
    "",
    "- TODO real task",
  ].join("\n");

  assert.deepEqual([...markdownCodeLineNumbers(markdown, source)], [1, 2, 3, 5]);
});

test("uses bounded strict Mermaid rendering for both application themes", () => {
  assert.deepEqual(mermaidConfiguration("light"), {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    maxEdges: 500,
    theme: "default",
  });
  assert.equal(mermaidConfiguration("dark").theme, "dark");
  assert.equal(
    mermaidRenderErrorMessage(new Error("Parse error on line 2\nDetails")),
    "Mermaid diagram could not be rendered: Parse error on line 2",
  );
});

test("provides and restores a stylesheet fallback for older WebKit webviews", () => {
  class IllegalCssStyleSheet {
    constructor() {
      throw new TypeError("Illegal constructor");
    }
  }

  const rules: Array<{ cssText: string }> = [];
  let appended = false;
  let removed = false;
  let styleText: string | null = null;
  const nativeStyleSheet = {
    cssRules: rules,
    insertRule(rule: string, index = rules.length) {
      rules.splice(index, 0, { cssText: rule });
      return index;
    },
  };
  const styleElement = {
    media: "",
    get textContent() {
      return styleText;
    },
    set textContent(value: string | null) {
      styleText = value;
    },
    sheet: nativeStyleSheet,
    remove() {
      removed = true;
    },
  };
  const environment: MermaidCssStyleSheetEnvironment = {
    CSSStyleSheet:
      IllegalCssStyleSheet as unknown as NonNullable<
        MermaidCssStyleSheetEnvironment["CSSStyleSheet"]
      >,
    document: {
      head: {
        appendChild(element) {
          appended = element === styleElement;
        },
      },
      createElement() {
        return styleElement;
      },
    },
  };
  const restore = installMermaidCssStyleSheetCompatibility(environment);
  const CompatibleCssStyleSheet = environment.CSSStyleSheet;
  if (!CompatibleCssStyleSheet) {
    throw new Error("Expected the compatibility stylesheet constructor to be installed.");
  }
  const styleSheet = new CompatibleCssStyleSheet();

  assert.equal(styleSheet.insertRule(".node { color: red; }"), 0);
  assert.equal(styleSheet.insertRule(".edge { color: blue; }"), 1);
  assert.deepEqual(
    Array.from(styleSheet.cssRules, (rule) => rule.cssText),
    [".node { color: red; }", ".edge { color: blue; }"],
  );
  styleSheet.replaceSync?.(".theme { color: green; }");
  assert.equal(styleText, ".theme { color: green; }");
  assert.equal(appended, true);
  assert.equal(styleElement.media, "not all");

  restore();
  assert.equal(removed, true);
  assert.equal(environment.CSSStyleSheet, IllegalCssStyleSheet);
});

test("enables lazy Mermaid rendering only in the right pane", () => {
  const markdownView = readFileSync(
    join(root, "src/lib/components/MarkdownView.svelte"),
    "utf8",
  );
  const rightPane = readFileSync(join(root, "src/lib/components/RightPane.svelte"), "utf8");
  const journalFeed = readFileSync(join(root, "src/lib/components/JournalFeed.svelte"), "utf8");
  const linkedReferences = readFileSync(
    join(root, "src/lib/components/LinkedReferences.svelte"),
    "utf8",
  );
  const editorPane = readFileSync(join(root, "src/lib/components/EditorPane.svelte"), "utf8");

  assert.match(markdownView, /new IntersectionObserver/);
  assert.match(markdownView, /rootMargin: "240px 0px"/);
  assert.match(markdownView, /renderMermaidDiagram\(sourceElement\.textContent \?\? "", theme\)/);
  assert.match(rightPane, /<MarkdownView[\s\S]*?enableMermaid/);
  assert.match(rightPane, /<LinkedReferences[\s\S]*?enableMermaid/);
  assert.match(journalFeed, /<MarkdownView[\s\S]*?enableMermaid/);
  assert.match(journalFeed, /<LinkedReferences[\s\S]*?enableMermaid/);
  assert.match(linkedReferences, /\{enableMermaid\}/);
  assert.equal(/enableMermaid/.test(editorPane), false);
});

test("constrains rendered Mermaid SVGs to the right-pane width", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(
    styles,
    /\.right-pane \.mermaid-diagram-output svg\s*\{[^}]*max-width: 100%;[^}]*height: auto;/s,
  );
  assert.match(styles, /\.right-pane \.mermaid-diagram-error\s*\{[^}]*color: var\(--error-text/s);
});

test("scales rendered Markdown headings with the application font size", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  for (const [heading, fontSize] of [
    ["h1", "1.714em"],
    ["h2", "1.286em"],
    ["h3", "1.071em"],
  ]) {
    assert.match(
      styles,
      new RegExp(`\\.markdown-view ${heading}\\s*\\{[^}]*font-size: ${fontSize};`, "s"),
    );
  }
});

test("keeps rendered formulas readable in light and dark themes", () => {
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");

  assert.match(styles, /\.markdown-view \.katex,[\s\S]*?color: inherit;/);
  assert.match(styles, /\.cm-live-latex \.katex[\s\S]*?color: inherit;/);
  assert.match(
    styles,
    /\.markdown-view \.katex \.katex-mathml,[\s\S]*?clip-path: inset\(50%\);/,
  );
  assert.match(
    styles,
    /\.cm-live-latex \.katex-mathml[\s\S]*?clip-path: inset\(50%\);/,
  );
  assert.match(
    styles,
    /:root\[data-theme="dark"\] \.markdown-view \.katex-error,[\s\S]*?color: #ffb4b4 !important;/,
  );
  assert.match(
    styles,
    /:root\[data-theme="dark"\] \.cm-live-latex \.katex-error[\s\S]*?color: #ffb4b4 !important;/,
  );
});
