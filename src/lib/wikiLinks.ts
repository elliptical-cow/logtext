import type { FolderColors, PageSummary } from "./types";
import { wikiLinkColorStyle } from "./folderColors.js";

export type ResolvedWikiTarget =
  | {
      exists: true;
      path: string;
      key: string;
    }
  | {
      exists: false;
      path: string;
      key: string;
    };

export type WikiLinkSyntax = "square" | "compact";

export type WikiLinkMatch = {
  from: number;
  to: number;
  raw: string;
  target: string;
  alias: string | null;
  syntax: WikiLinkSyntax;
};

export type MarkdownInlineLinkMatch = {
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
};

const compactSegmentPattern = String.raw`[\p{L}\p{N}_](?:[\p{L}\p{N}_-]|\.(?=[\p{L}\p{N}_]))*`;
const compactTargetPattern = `${compactSegmentPattern}(?:/${compactSegmentPattern})*`;
const wikiLinkPattern = new RegExp(
  String.raw`\[\[([^\]\n]+)\]\]|#(${compactTargetPattern})`,
  "gu",
);
const compactTargetPatternExact = new RegExp(`^${compactTargetPattern}$`, "u");
const compactSegmentCharacter = /^[\p{L}\p{N}_-]$/u;

export function normalizeWikiTargetKey(target: string): string | null {
  const withoutExtension = stripMarkdownExtension(target.trim());

  if (!isValidWikiTarget(withoutExtension)) {
    return null;
  }

  return withoutExtension.toLowerCase();
}

export function wikiTargetToMarkdownPath(target: string): string | null {
  const withoutExtension = stripMarkdownExtension(target.trim());

  if (!isValidWikiTarget(withoutExtension)) {
    return null;
  }

  return `${withoutExtension}.md`;
}

export function resolveWikiTarget(target: string, pages: PageSummary[]): ResolvedWikiTarget | null {
  const key = normalizeWikiTargetKey(target);
  const fallbackPath = wikiTargetToMarkdownPath(target);

  if (!key || !fallbackPath) {
    return null;
  }

  const page = pages.find((candidate) => candidate.key === key);

  if (page) {
    return {
      exists: true,
      key,
      path: page.path,
    };
  }

  return {
    exists: false,
    key,
    path: fallbackPath,
  };
}

export function wikiLinkHref(target: string, pages: PageSummary[]): string | null {
  const resolved = resolveWikiTarget(target, pages);

  if (!resolved) {
    return null;
  }

  const scheme = resolved.exists || pages.length === 0 ? "logtext" : "logtext-missing";
  return `${scheme}:${encodeURIComponent(resolved.path)}`;
}

export function renderWikiLinks(source: string, pages: PageSummary[] = []) {
  let rendered = "";
  let cursor = 0;

  for (const match of wikiLinksInText(source)) {
    rendered += source.slice(cursor, match.from);
    const target = match.target;
    const href = wikiLinkHref(target, pages);

    if (!href) {
      rendered += match.raw;
      cursor = match.to;
      continue;
    }

    const displayLabel = match.alias || wikiLinkDisplayLabel(target, pages);
    const label = match.syntax === "compact" ? `#${displayLabel}` : displayLabel;
    rendered += `[${escapeMarkdownLabel(label)}](${href})`;
    cursor = match.to;
  }

  return rendered + source.slice(cursor);
}

export function wikiLinksInText(source: string): WikiLinkMatch[] {
  const links: WikiLinkMatch[] = [];

  for (const match of source.matchAll(wikiLinkPattern)) {
    const from = match.index ?? 0;
    const raw = match[0];
    const compactTarget = match[2];
    const syntax: WikiLinkSyntax = compactTarget ? "compact" : "square";

    if (
      isEscapedMarkdownPosition(source, from) ||
      isMarkdownCodePosition(source, from) ||
      isMarkdownLatexPosition(source, from) ||
      isMarkdownLinkPosition(source, from) ||
      (syntax === "compact" && !isCompactWikiLinkStart(source, from))
    ) {
      continue;
    }

    const inner = compactTarget ?? match[1];
    const aliasSeparator = inner.indexOf("|");
    const rawTarget = aliasSeparator === -1 ? inner : inner.slice(0, aliasSeparator);
    const rawAlias = aliasSeparator === -1 ? undefined : inner.slice(aliasSeparator + 1);
    const target = rawTarget.trim();
    if (!isValidWikiTarget(target)) {
      continue;
    }

    links.push({
      from,
      to: from + raw.length,
      raw,
      target,
      alias: syntax === "compact" ? null : rawAlias?.trim() || null,
      syntax,
    });
  }

  return links;
}

export function markdownInlineLinksInText(source: string): MarkdownInlineLinkMatch[] {
  const links: MarkdownInlineLinkMatch[] = [];

  for (let open = 0; open < source.length; open += 1) {
    if (
      source[open] !== "[" ||
      source[open + 1] === "[" ||
      (source[open - 1] === "!" && !isEscapedMarkdownPosition(source, open - 1)) ||
      isEscapedMarkdownPosition(source, open) ||
      isMarkdownCodePosition(source, open) ||
      isMarkdownLatexPosition(source, open)
    ) {
      continue;
    }

    const labelClose = matchingMarkdownLabelClose(source, open);
    const targetOpen = labelClose + 1;
    if (labelClose === -1 || source[targetOpen] !== "(") {
      continue;
    }

    const targetClose = closingMarkdownLinkTarget(source, targetOpen);
    if (targetClose >= source.length || source[targetClose] !== ")") {
      continue;
    }

    links.push({
      from: open,
      to: targetClose + 1,
      labelFrom: open + 1,
      labelTo: labelClose,
    });
    open = targetClose;
  }

  return links;
}

export function isValidCompactWikiTarget(target: string) {
  return compactTargetPatternExact.test(target) && isValidWikiTarget(target);
}

export function wikiLinkDisplayLabel(target: string, pages: PageSummary[] = []) {
  const resolved = resolveWikiTarget(target, pages);
  if (!resolved?.exists) {
    return stripMarkdownExtension(target.trim());
  }

  return compactPageLabel(resolved.path, pages);
}

export function compactPageLabel(path: string, pages: PageSummary[] = []) {
  const normalizedPath = stripMarkdownExtension(path.trim()).replace(/\\/g, "/");
  const targetSegments = normalizedPath.split("/").filter(Boolean);
  const targetLeaf = targetSegments.at(-1) ?? normalizedPath;
  const matchingPages = pages
    .map((page) => stripMarkdownExtension(page.path).replace(/\\/g, "/"))
    .filter((candidate) => {
      const candidateLeaf = candidate.split("/").filter(Boolean).at(-1) ?? candidate;
      return candidateLeaf.toLowerCase() === targetLeaf.toLowerCase();
    });

  if (matchingPages.length <= 1) {
    return targetLeaf;
  }

  for (let segmentCount = 2; segmentCount <= targetSegments.length; segmentCount += 1) {
    const suffix = targetSegments.slice(-segmentCount).join("/");
    const sameSuffixCount = matchingPages.filter((candidate) =>
      candidate.toLowerCase().endsWith(suffix.toLowerCase()),
    ).length;

    if (sameSuffixCount === 1) {
      return suffix;
    }
  }

  return normalizedPath;
}

export function compactPageFolderLabel(path: string, pages: PageSummary[] = []) {
  const label = compactPageLabel(path, pages);
  const slash = label.lastIndexOf("/");
  return slash === -1 ? "" : label.slice(0, slash);
}

export function applyWikiLinkColorStyles(
  html: string,
  pages: PageSummary[] = [],
  folderColors: FolderColors = {},
) {
  return html.replace(
    /<a href="(logtext:[^"]+)"([^>]*)>/g,
    (match, href: string, rest: string) => {
      const target = decodeURIComponent(href.slice("logtext:".length));
      const style = wikiLinkColorStyle(target, pages, folderColors);

      if (rest.includes("style=")) {
        return match;
      }

      return `<a href="${href}"${rest} class="wiki-link-chip" style="${style}">`;
    },
  );
}

function stripMarkdownExtension(value: string) {
  return value.endsWith(".md") ? value.slice(0, -".md".length) : value;
}

function isValidWikiTarget(target: string) {
  return (
    target.length > 0 &&
    !target.startsWith("/") &&
    target.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function escapeMarkdownLabel(label: string) {
  return label.replace(/([\\\]])/g, "\\$1");
}

export function isCompactWikiLinkStart(source: string, from: number) {
  if (from === 0) {
    return true;
  }

  const previous = [...source.slice(0, from)].at(-1);
  return Boolean(
    previous &&
      !compactSegmentCharacter.test(previous) &&
      !["#", "[", "/", "\\", ":", "@", "="].includes(previous),
  );
}

function isMarkdownCodePosition(source: string, position: number) {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  let fence: { marker: string; length: number } | null = null;

  for (const line of source.slice(0, lineStart).split("\n")) {
    const marker = markdownFenceMarker(line);
    if (!marker) {
      continue;
    }

    if (fence?.marker === marker.marker && marker.length >= fence.length) {
      fence = null;
    } else if (!fence) {
      fence = marker;
    }
  }

  const linePrefix = source.slice(lineStart, position);
  return Boolean(fence || markdownFenceMarker(linePrefix) || hasUnclosedInlineCode(linePrefix));
}

function isMarkdownLinkPosition(source: string, position: number) {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = source.indexOf("\n", position);
  const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
  const relativePosition = position - lineStart;

  if (
    markdownInlineLinksInText(line).some(
      (link) => relativePosition > link.from && relativePosition < link.to,
    )
  ) {
    return true;
  }

  for (let index = 0; index < relativePosition; index += 1) {
    if (line[index] !== "]" || (line[index + 1] !== "(" && line[index + 1] !== "[")) {
      continue;
    }

    const close = closingMarkdownLinkTarget(line, index + 1);
    if (relativePosition > index + 1 && relativePosition < close) {
      return true;
    }
  }

  for (let open = 0; open < relativePosition; open += 1) {
    if (line[open] !== "[" || line[open + 1] === "[" || isEscapedMarkdownPosition(line, open)) {
      continue;
    }

    const close = matchingMarkdownLabelClose(line, open);
    if (
      close > relativePosition &&
      (line[close + 1] === "(" || line[close + 1] === "[")
    ) {
      return true;
    }
  }

  return false;
}

function matchingMarkdownLabelClose(line: string, open: number) {
  let depth = 1;

  for (let index = open + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line.slice(index, index + 2) === "[[") {
      const wikiClose = line.indexOf("]]", index + 2);
      if (wikiClose === -1) {
        return -1;
      }
      index = wikiClose + 1;
      continue;
    }
    if (line[index] === "[") {
      depth += 1;
    } else if (line[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function closingMarkdownLinkTarget(line: string, delimiter: number) {
  const open = line[delimiter];
  const close = open === "(" ? ")" : "]";
  let depth = 1;

  for (let index = delimiter + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === open) {
      depth += 1;
    } else if (line[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return line.length;
}

function isEscapedMarkdownPosition(source: string, position: number) {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isMarkdownLatexPosition(source: string, position: number) {
  let blockOpen: number | null = null;
  for (let index = 0; index < source.length - 1; index += 1) {
    if (
      source.slice(index, index + 2) !== "$$" ||
      isEscapedMarkdownPosition(source, index) ||
      isMarkdownCodePosition(source, index)
    ) {
      continue;
    }

    if (blockOpen === null) {
      blockOpen = index;
    } else {
      if (position > blockOpen && position < index + 2) {
        return true;
      }
      blockOpen = null;
    }
    index += 1;
  }

  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = source.indexOf("\n", position);
  const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
  const relativePosition = position - lineStart;
  let inlineOpen: number | null = null;

  for (let index = 0; index < line.length; index += 1) {
    if (
      line[index] !== "$" ||
      line[index - 1] === "$" ||
      line[index + 1] === "$" ||
      isEscapedMarkdownPosition(line, index)
    ) {
      continue;
    }

    if (inlineOpen === null) {
      inlineOpen = index;
    } else {
      if (relativePosition > inlineOpen && relativePosition < index) {
        return true;
      }
      inlineOpen = null;
    }
  }

  return false;
}

function markdownFenceMarker(line: string) {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function hasUnclosedInlineCode(linePrefix: string) {
  let openLength: number | null = null;

  for (let index = 0; index < linePrefix.length; ) {
    if (linePrefix[index] !== "`" || (index > 0 && linePrefix[index - 1] === "\\")) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (linePrefix[end] === "`") {
      end += 1;
    }
    const runLength = end - index;
    openLength = openLength === runLength ? null : openLength ?? runLength;
    index = end;
  }

  return openLength !== null;
}
