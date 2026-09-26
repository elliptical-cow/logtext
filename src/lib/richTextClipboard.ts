import { createMarkdownRenderer } from "./markdownRenderer.js";
import type { PageSummary } from "./types.js";

export type RichTextClipboardPayload = {
  html: string;
  text: string;
};

const markdown = createMarkdownRenderer({
  breaks: true,
  latex: false,
  logtextWikiLinks: true,
});

markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const alt = renderer.renderInlineAsText(tokens[index].children ?? [], options, env).trim();
  const label = alt ? `Image: ${alt}` : "Image";
  const escapedLabel = markdown.utils.escapeHtml(label);
  return `<span style="color: #69727d; font-style: italic;">[${escapedLabel}]</span>`;
};

const tagStyles: ReadonlyArray<readonly [string, string]> = [
  ["p", "margin: 0 0 8px;"],
  ["h1", "font-size: 1.6em; margin: 0 0 12px;"],
  ["h2", "font-size: 1.4em; margin: 0 0 10px;"],
  ["h3", "font-size: 1.2em; margin: 0 0 8px;"],
  ["h4", "font-size: 1.1em; margin: 0 0 8px;"],
  ["h5", "font-size: 1em; margin: 0 0 8px;"],
  ["h6", "font-size: 1em; margin: 0 0 8px; color: #69727d;"],
  [
    "ul",
    "margin: 0 0 8px 24px; padding-left: 24px; list-style-type: disc; list-style-position: outside;",
  ],
  [
    "ol",
    "margin: 0 0 8px 24px; padding-left: 24px; list-style-type: decimal; list-style-position: outside;",
  ],
  ["li", "display: list-item; margin: 0 0 2px;"],
  [
    "blockquote",
    "margin: 0 0 8px; padding-left: 12px; border-left: 3px solid #c7cdd4; color: #3f4952;",
  ],
  [
    "pre",
    "margin: 0 0 8px; padding: 8px; background: #f6f7f8; border: 1px solid #d8dde3; white-space: pre-wrap;",
  ],
  ["code", "font-family: Consolas, Menlo, monospace; background: #f6f7f8;"],
  ["table", "margin: 0 0 8px; border-collapse: collapse;"],
  ["th", "padding: 4px 8px; border: 1px solid #c7cdd4; text-align: left;"],
  ["td", "padding: 4px 8px; border: 1px solid #c7cdd4;"],
  ["hr", "border: 0; border-top: 1px solid #c7cdd4;"],
];

const containerStyle =
  "font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #202124;";

function addInlineStyle(attributes: string, style: string) {
  const styleAttribute = /\sstyle=(['"])([\s\S]*?)\1/i;
  if (styleAttribute.test(attributes)) {
    return attributes.replace(styleAttribute, (_match, quote: string, current: string) => {
      const separator = current.trimEnd().endsWith(";") ? " " : "; ";
      return ` style=${quote}${current}${separator}${style}${quote}`;
    });
  }

  return ` style="${style}"${attributes}`;
}

export function portableRichTextHtml(rendered: string) {
  const withoutInternalLinks = rendered.replace(
    /<a\b[^>]*\bhref=(['"])logtext(?:-missing)?:[^'"]*\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, content: string) => content,
  );
  const styled = tagStyles.reduce(
    (html, [tag, style]) =>
      html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, "gi"), (_match, attributes = "") =>
        `<${tag}${addInlineStyle(attributes, style)}>`
      ),
    withoutInternalLinks,
  ).replace(
    /<a(\s[^>]*)?>/gi,
    (_match, attributes = "") =>
      `<a${addInlineStyle(attributes, "color: #1259a7; text-decoration: underline;")}>`,
  );

  return `<div style="${containerStyle}">${styled}</div>`;
}

export function richTextClipboardPayloadFromHtml(
  rendered: string,
  text: string,
): RichTextClipboardPayload {
  return {
    html: portableRichTextHtml(rendered),
    text,
  };
}

export function richTextClipboardPayload(
  source: string,
  pages: PageSummary[] = [],
): RichTextClipboardPayload {
  const rendered = markdown.render(source, { pages });
  return richTextClipboardPayloadFromHtml(rendered, source);
}
