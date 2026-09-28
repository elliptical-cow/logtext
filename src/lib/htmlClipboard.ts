import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

turndown.remove(["head", "script", "style"]);

function hasInlineFormatting(element: HTMLElement) {
  const style = element.getAttribute("style") ?? "";
  return /font-weight\s*:\s*(?:bold|[6-9]00)\b/i.test(style)
    || /font-style\s*:\s*italic\b/i.test(style)
    || /text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(style);
}

function wrapInlineStyle(content: string, element: HTMLElement) {
  const style = element.getAttribute("style") ?? "";
  const fontWeight = /font-weight\s*:\s*(?:bold|[6-9]00)\b/i.test(style);
  const fontStyle = /font-style\s*:\s*italic\b/i.test(style);
  const struck = /text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(style);

  let markdown = content;
  if (fontWeight) markdown = `**${markdown}**`;
  if (fontStyle) markdown = `*${markdown}*`;
  if (struck) markdown = `~~${markdown}~~`;
  return markdown;
}

turndown.addRule("outlookInlineStyles", {
  filter(node) {
    return node.nodeName === "SPAN" && hasInlineFormatting(node);
  },
  replacement(content, node) {
    return wrapInlineStyle(content, node);
  },
});

turndown.addRule("strikethrough", {
  filter(node) {
    return ["DEL", "S", "STRIKE"].includes(node.nodeName);
  },
  replacement(content) {
    return content.trim() ? `~~${content}~~` : "";
  },
});

turndown.addRule("outlookListParagraph", {
  filter(node) {
    if (node.nodeName !== "P") return false;
    const className = node.getAttribute("class") ?? "";
    const style = node.getAttribute("style") ?? "";
    return /\bMsoListParagraph\w*\b/i.test(className) || /(?:^|;)\s*mso-list\s*:/i.test(style);
  },
  replacement(content, node) {
    const style = node.getAttribute("style") ?? "";
    const level = Number(/\blevel(\d+)\b/i.exec(style)?.[1] ?? "1");
    const indent = "    ".repeat(Math.max(0, level - 1));
    const normalized = content.replaceAll("\u00a0", " ").trim();
    const ordered = /^(\d+|[A-Za-z]+)[.)](?=\s)/.exec(normalized);
    const unordered = /^(?:[•·▪◦‣⁃-]|[oO])(?=\s)/.exec(normalized);
    const markerLength = ordered?.[0].length ?? unordered?.[0].length ?? 0;
    const item = normalized.slice(markerLength).trim();
    if (!item) return "";

    const marker = ordered
      ? `${/^\d+$/.test(ordered[1]) ? ordered[1] : "1"}.`
      : "-";
    return `\n${indent}${marker} ${item}\n`;
  },
});

turndown.addRule("portableImages", {
  filter: "img",
  replacement(_content, node) {
    const alt = (node.getAttribute("alt") ?? "").trim().replaceAll("]", "\\]");
    return alt ? `[Image: ${alt}]` : "[Image]";
  },
});

function normalizeMarkdown(markdown: string) {
  let normalized = markdown
    .replaceAll("\u00a0", " ")
    .replace(/^(\s*)-\s{3}/gm, "$1- ")
    .replace(/^(\s*\d+\.)\s{3}/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n");

  let previous = "";
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized.replace(
      /(^[\t ]*(?:-|\d+\.) .+)\n\n(?=[\t ]*(?:-|\d+\.) )/gm,
      "$1\n",
    );
  }
  return normalized.trim();
}

export function htmlClipboardToMarkdown(html: string, textFallback = "") {
  if (!html.trim()) return textFallback;

  const markdown = normalizeMarkdown(turndown.turndown(html));
  return markdown || textFallback;
}

export function containsOnlyClipboardImageLabels(markdown: string) {
  const withoutImageLabels = markdown.replace(
    /\[Image(?:: (?:\\.|[^\]])*)?\]/g,
    "",
  );
  return withoutImageLabels.trim() === "" && withoutImageLabels !== markdown;
}
