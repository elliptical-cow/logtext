import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

const listPrefixPattern = /^(?:(?:\d+|[A-Za-z]+)[.)]|[•·▪◦‣⁃-]|[oO])(?=\s)/;
const pixelsPerCssUnit: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  em: 16,
  rem: 16,
};

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

function cssLengthPixels(value: string) {
  const normalized = value.trim().replace(/\s*!important\s*$/i, "");
  const match = /^(-?\d*\.?\d+)\s*(px|pt|in|cm|mm|em|rem)$/i.exec(normalized);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return Math.max(0, amount * pixelsPerCssUnit[unit]);
}

function inlineIndentPixels(element: HTMLElement) {
  const style = element.getAttribute("style") ?? "";
  const explicit = /(?:margin|padding)-left\s*:\s*([^;]+)/i.exec(style)?.[1];
  if (explicit) return cssLengthPixels(explicit);

  for (const property of ["margin", "padding"]) {
    const shorthand = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style)?.[1];
    if (!shorthand) continue;
    const values = shorthand.trim().split(/\s+/);
    const left = values.length === 4 ? values[3] : values.length >= 2 ? values[1] : values[0];
    const pixels = cssLengthPixels(left);
    if (pixels !== null) return pixels;
  }
  return null;
}

function hasDirectList(element: HTMLElement) {
  return Array.from(element.children).some((child) => ["UL", "OL"].includes(child.nodeName));
}

function looksLikeListBlock(element: HTMLElement) {
  if (["UL", "OL"].includes(element.nodeName)) return true;
  if (hasDirectList(element)) return true;

  const className = element.getAttribute("class") ?? "";
  const style = element.getAttribute("style") ?? "";
  const text = (element.textContent ?? "").replaceAll("\u00a0", " ").trim();
  return /\bMsoListParagraph\w*\b/i.test(className)
    || /(?:^|;)\s*mso-list\s*:/i.test(style)
    || listPrefixPattern.test(text);
}

function inferredListDepth(element: HTMLElement) {
  const indent = inlineIndentPixels(element);
  if (indent === null) return 0;

  const siblings = (Array.from(element.parentElement?.children ?? []) as HTMLElement[])
    .filter(looksLikeListBlock);
  const indents = siblings
    .map((sibling) => inlineIndentPixels(sibling) ?? 0)
    .sort((left, right) => left - right);
  const distinctIndents = indents.filter((value, index) => index === 0 || value !== indents[index - 1]);
  const differences = distinctIndents
    .slice(1)
    .map((value, index) => value - distinctIndents[index])
    .filter((difference) => difference >= 12);
  const baseIndent = distinctIndents[0] ?? 0;
  const indentStep = differences.length > 0 ? Math.min(...differences) : 40;
  return Math.max(0, Math.round((indent - baseIndent) / indentStep));
}

function listItemMarkdown(content: string, depth: number) {
  const normalized = content.replaceAll("\u00a0", " ").trim();
  const ordered = /^(\d+|[A-Za-z]+)[.)](?=\s)/.exec(normalized);
  const unordered = /^(?:[•·▪◦‣⁃-]|[oO])(?=\s)/.exec(normalized);
  const markerLength = ordered?.[0].length ?? unordered?.[0].length ?? 0;
  const item = normalized.slice(markerLength).trim();
  if (!item) return "";

  const marker = ordered
    ? `${/^\d+$/.test(ordered[1]) ? ordered[1] : "1"}.`
    : "-";
  return `\n${"    ".repeat(depth)}${marker} ${item}\n`;
}

function indentMarkdown(content: string, depth: number) {
  const indent = "    ".repeat(depth);
  return content
    .trim()
    .split("\n")
    .map((line) => line ? `${indent}${line}` : line)
    .join("\n");
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

turndown.addRule("visuallyIndentedListParagraph", {
  filter(node) {
    if (!["P", "DIV"].includes(node.nodeName) || inlineIndentPixels(node) === null) return false;
    const className = node.getAttribute("class") ?? "";
    const style = node.getAttribute("style") ?? "";
    return !/\bMsoListParagraph\w*\b/i.test(className)
      && !/(?:^|;)\s*mso-list\s*:/i.test(style)
      && listPrefixPattern.test(
        (node.textContent ?? "").replaceAll("\u00a0", " ").trim(),
      );
  },
  replacement(content, node) {
    return listItemMarkdown(content, inferredListDepth(node));
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
    const explicitLevel = /\blevel(\d+)\b/i.exec(style)?.[1]
      ?? node.getAttribute("data-list-level")
      ?? node.getAttribute("aria-level");
    const numericLevel = Number(explicitLevel);
    const depth = explicitLevel && Number.isFinite(numericLevel)
      ? Math.max(0, numericLevel - 1)
      : inferredListDepth(node);
    return listItemMarkdown(content, depth);
  },
});

turndown.addRule("visuallyIndentedList", {
  filter(node) {
    return ["UL", "OL"].includes(node.nodeName) && inferredListDepth(node) > 0;
  },
  replacement(content, node) {
    return `\n\n${indentMarkdown(content, inferredListDepth(node))}\n\n`;
  },
});

turndown.addRule("visuallyIndentedListWrapper", {
  filter(node) {
    return node.nodeName === "DIV" && hasDirectList(node) && inferredListDepth(node) > 0;
  },
  replacement(content, node) {
    return `\n\n${indentMarkdown(content, inferredListDepth(node))}\n\n`;
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
    .replace(/^(\s*\d+\.)\s{2,3}/gm, "$1 ")
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
